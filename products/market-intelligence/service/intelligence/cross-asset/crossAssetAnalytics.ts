import { crossAssetPolicy } from './crossAssetPolicy'
import { crossAssetContractPolicy } from '../../../contracts/crossAssetObservationContracts'

/** Five-minute intervals per plotted point: the short ranges plot every bar, the long ones sample. */
const hourStride = 12

// Market Intelligence design 126 owns these closed-bar policies; changes require PM acceptance.
export const crossAssetAnalyticsPolicy = Object.freeze({
  // `7d` is the number of five-minute intervals in seven days (7 × 24 × 12), not 2016: at 2016 the
  // "seven-day" return was really seven days minus one bar, and its anchor bar fell outside the
  // admission horizon — which is why the 7d column had no value even with a month of history stored.
  /**
   * How many intervals back each *printed return* divides against. `7d` is 2017 rather than 2016 on
   * purpose: the newer close of a seven-day return is the last admitted bar, one interval behind the
   * analysis instant, so the older one has to be a further 2016 bars back to be seven days from it.
   *
   * It is **not** the chart's window length. The window is the wire contract's own coverage
   * (`coveragePoints`, endpoints inclusive) and the two must agree to the interval, or the renderer's
   * fail-closed parser refuses the whole snapshot — which is what a 7d chart did: the window opened five
   * minutes early, every snapshot was refused, and the block read 行情暂不可用.
   */
  // 每个窗口都是"跨度 + 1 个间隔"：一次收益率要除以更早的那个收盘，而更新的那个收盘本就在分析时刻之前
  // 一个间隔。7 天即 7 × 288 + 1。
  intervals: Object.freeze({ '5m': 1, '15m': 3, '1h': 12, '4h': 48, '24h': 288, '7d': 2017 }),
  hourStride,
  /**
   * How a range finds the close for an instant: the five-minute bar at that instant must be there, and a
   * strided point additionally requires every interval inside its stride, so a value never skips a hole.
   *
   * 只有这一条规则：每个准入窗口都落在保留策略的热层（8 天）以内，所以精确同一时刻永远取得到。
   * 「就近携带」那套（跨冷层窗口用的）随 30d 一起删掉了——没有窗口需要它。
   */
  curveStride: Object.freeze({ '1h': 1, '24h': 1, '7d': hourStride }),
  percentFactor: 100, minimumPairs: crossAssetContractPolicy.minimumPairs,
  minimumVariance: 1e-16, correlationRoundingTolerance: 1e-12, missingGraceMs: 90_000
})
/**
 * The band a leg has to clear to count as having moved.
 *
 * Written for **one hour** — that is the window the observation key reads — and scaled to any other window
 * by `crossAssetFlatBand`, because one set of numbers cannot serve every window: measured on this machine,
 * a 24-hour move is 9–20 times the 1-hour median (BTC 0.25→2.29%, QQQ 0.14→2.77%, DXY 0.06→0.25%,
 * XAU 0.16→0.82%), so applying the 1h band at 24h would call every leg significant and make "no change"
 * unreachable — which is what the crypto-only scenario is made of.
 *
 * Every band is that leg's **typical one-hour move** (the measured 1h median of |return|), which is where the
 * three existing bands already sit (index 0.14 → .10, BTC 0.25 → .30, ETH 0.40 → its own median), and the
 * two macro legs were added with the cross-market reading (design 142 §3.4) on that same reading of the
 * data: the dollar's typical 1h move is 0.06% and gold's is 0.16%.
 *
 * An earlier version of this comment put the dollar at 0.10 (~p75) and gold at 0.15. The 24-hour reading then
 * required a 0.49% dollar move — above the dollar's own 24h *median* of 0.25% — so the three dollar-driven
 * scenarios would have been unreachable in an ordinary tape, and the case the reader approved on the
 * prototype (dollar +0.42% over 24h) would have read as "no match". Typical-move bands keep "flat" at
 * roughly half the time, which is what a three-state direction needs.
 */
export const crossAssetObservationPolicy = Object.freeze({
  flatPercent: Object.freeze({ index: .10, btc: .30, eth: .40, dxy: .06, gold: .16 })
})

/** Hours per window, for scaling the 1h bands. */
const windowHours = Object.freeze({ '1h': 1, '24h': 24, '7d': 7 * 24 })

/** The band for a leg over a window: the owned 1h band scaled by the square root of the window's hours. */
export function crossAssetFlatBand(leg: keyof typeof crossAssetObservationPolicy.flatPercent, window: keyof typeof windowHours): number {
  return crossAssetObservationPolicy.flatPercent[leg] * Math.sqrt(windowHours[window])
}

type Asset = keyof typeof crossAssetPolicy.assets
type Range = '1h' | '24h' | '7d'
type Reason = 'missing' | 'insufficient' | 'zero-variance' | 'stale'
type Metric = { state: 'available'; value: number } | { state: 'unavailable'; reason: Reason }
type ClosePoint = Readonly<{ atMs: number; close: string }>
/** The newest stored close at or before the analysis instant: what a closed row still has to show. */
type LatestClosed = Readonly<{ atMs: number; close: string }>
type Correlation = Metric & { sampleCount: number; expectedCount: number }
const assets = Object.keys(crossAssetPolicy.assets) as Asset[]
const policy = crossAssetAnalyticsPolicy
const step = crossAssetPolicy.intervalMs
const unavailable = (reason: Reason): Metric => ({ state: 'unavailable', reason })
const metric = (value: number): Metric => Number.isFinite(value) ? { state: 'available', value: Object.is(value, -0) ? 0 : value } : unavailable('insufficient')

export function analyzeCrossAssetHistory(input: {
  history: Record<Asset, readonly ClosePoint[]>; range: Range; asOfMs: number; mode: 'current' | 'historical'
}) {
  const analysisEndMs = Math.floor(input.asOfMs / step) * step
  /** The wire's own window, endpoints inclusive — the same arithmetic the snapshot parser checks. */
  const gridPoints = crossAssetContractPolicy.coveragePoints[input.range]
  const windowStartMs = analysisEndMs - (gridPoints - 1) * step
  /**
   * The admission horizon, in milliseconds. It is one interval **wider** than the longest printed
   * window, because a seven-day return is the ratio of two closes seven days apart: the newer one is
   * `analysisEnd - interval` and the older one is `analysisEnd - 7d`, so a horizon of exactly `7d`
   * would cut off the very bar the window divides against and quietly shorten it by one bar.
   */
  // Wide enough for both the longest *printed* window (7d, beside every range) and this range's own.
  const horizonMs = (Math.max(policy.intervals['7d'], gridPoints) + 1) * step
  /** A bar is admitted only if it is a readable decimal on the grid, at or before the analysis instant. */
  const admittedClose = (point: ClosePoint): number | undefined => {
    const close = Number(point.close)
    if (point.atMs > analysisEndMs || point.atMs < analysisEndMs - horizonMs || !Number.isSafeInteger(point.atMs) ||
      point.atMs % step !== 0 || !crossAssetPolicy.decimalPattern.test(point.close) ||
      !Number.isFinite(close) || close <= 0) return undefined
    return close
  }
  const prices = Object.fromEntries(assets.map(asset => {
    const points = new Map<number, number>()
    for (const point of input.history[asset]) {
      const close = admittedClose(point)
      if (close !== undefined) points.set(point.atMs, close)
    }
    return [asset, points]
  })) as Record<Asset, Map<number, number>>
  /** 锚点：窗口起点那一根收盘，必须精确命中——每个准入窗口都在热层，取点一律是精确同一时刻。 */
  const anchorClose = (asset: Asset): number | undefined => prices[asset].get(windowStartMs)
  /**
   * The newest admitted close per asset. A session-limited instrument has nothing at the analysis
   * instant while its market is shut, and this is what the row still has to show: the last bar that
   * actually closed — never an interpolated or repeated value pretending to be the current one.
   */
  const latestClosed = Object.fromEntries(assets.map(asset => {
    let newest: number | undefined
    let close: string | undefined
    for (const point of input.history[asset]) {
      if (admittedClose(point) === undefined) continue
      if (newest === undefined || point.atMs > newest) { newest = point.atMs; close = point.close }
    }
    return [asset, newest === undefined || close === undefined ? null : Object.freeze({ atMs: newest, close }) as LatestClosed]
  })) as Record<Asset, LatestClosed | null>

  function missingReason(pair: readonly Asset[]): Reason {
    return input.mode === 'current' && input.asOfMs - analysisEndMs > policy.missingGraceMs &&
      pair.some(asset => !prices[asset].has(analysisEndMs)) ? 'stale' : 'missing'
  }

  function closedReturn(asset: Asset, intervals: number): Metric {
    const start = prices[asset].get(analysisEndMs - intervals * step)
    const end = prices[asset].get(analysisEndMs)
    return start === undefined || end === undefined ? unavailable(missingReason([asset])) : metric(policy.percentFactor * (end / start - 1))
  }

  function correlation(left: Asset, right: Asset): Correlation {
    const pairs: [number, number][] = []
    const expectedCount = policy.intervals['24h']
    for (let index = 0; index < expectedCount; index++) {
      const at = analysisEndMs - index * step
      const a = prices[left].get(at); const previousA = prices[left].get(at - step)
      const b = prices[right].get(at); const previousB = prices[right].get(at - step)
      if (a !== undefined && previousA !== undefined && b !== undefined && previousB !== undefined) {
        pairs.push([Math.log(a) - Math.log(previousA), Math.log(b) - Math.log(previousB)])
      }
    }
    const coverage = { sampleCount: pairs.length, expectedCount }
    if ([left, right].some(asset => !prices[asset].has(analysisEndMs) || !prices[asset].has(analysisEndMs - step))) {
      return { ...unavailable(missingReason([left, right])), ...coverage }
    }
    if (pairs.length < policy.minimumPairs) return { ...unavailable('insufficient'), ...coverage }
    const meanA = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length
    const meanB = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length
    let xx = 0; let yy = 0; let xy = 0
    for (const [a, b] of pairs) { xx += (a - meanA) ** 2; yy += (b - meanB) ** 2; xy += (a - meanA) * (b - meanB) }
    if (xx / pairs.length <= policy.minimumVariance || yy / pairs.length <= policy.minimumVariance) {
      return { ...unavailable('zero-variance'), ...coverage }
    }
    const rho = xy / Math.sqrt(xx * yy)
    if (!Number.isFinite(rho) || Math.abs(rho) > 1 + policy.correlationRoundingTolerance) return { ...unavailable('insufficient'), ...coverage }
    return { ...metric(Math.max(-1, Math.min(1, rho))), ...coverage }
  }

  const curves = Object.fromEntries(assets.map(asset => {
    const anchor = anchorClose(asset)
    const stride = policy.curveStride[input.range]
    const points = Array.from({ length: (gridPoints - 1) / stride + 1 }, (_, index) => {
      const atMs = windowStartMs + index * stride * step
      let complete = anchor !== undefined && prices[asset].has(atMs)
      if (stride > 1 && index > 0) {
        for (let offset = 0; offset <= stride; offset++) complete &&= prices[asset].has(atMs - offset * step)
      }
      const close: number | undefined = complete ? prices[asset].get(atMs) : undefined
      const result = close !== undefined && anchor !== undefined && anchor > 0
        ? metric(policy.percentFactor * (close / anchor - 1)) : unavailable('missing')
      return { atMs, returnPercent: result.state === 'available' ? result.value : null }
    })
    return [asset, points]
  })) as Record<Asset, { atMs: number; returnPercent: number | null }[]>
  const historyCoverage = Object.fromEntries(assets.map(asset => {
    // The contract's own counting rule per range: the hot ranges count five-minute instants (they differ
    // by one from the return anchor's interval count on `7d`, and a coverage that disagreed with the wire
    // refused every seven-day snapshot); a cold-reaching range counts the points of the curve above.
    const counting = crossAssetContractPolicy.coverageCounting[input.range]
    const expectedCount = counting.expected
    let count = 0
    if (counting.mode === 'instants') {
      for (let index = 0; index < expectedCount; index++) if (prices[asset].has(windowStartMs + index * step)) count++
    } else count = curves[asset].filter(point => point.returnPercent !== null).length
    return [asset, { count, expectedCount, complete: count === expectedCount }]
  })) as Record<Asset, { count: number; expectedCount: number; complete: boolean }>
  // Every window the panel prints, read the same way: the ratio of two closes that actually exist.
  // Nothing here is anchored to the chart's window start, which is why a cash index can answer its
  // intraday windows during a session even when the 24h window opens in a closed stretch.
  const closedReturns = Object.fromEntries(assets.map(asset => [asset, {
    '5m': closedReturn(asset, policy.intervals['5m']), '15m': closedReturn(asset, policy.intervals['15m']),
    '1h': closedReturn(asset, policy.intervals['1h']), '4h': closedReturn(asset, policy.intervals['4h']),
    '24h': closedReturn(asset, policy.intervals['24h']), '7d': closedReturn(asset, policy.intervals['7d'])
  }])) as Record<Asset, Record<'5m' | '15m' | '1h' | '4h' | '24h' | '7d', Metric>>
  function relative(left: Asset, right: Asset): Metric {
    const a = closedReturns[left]['1h']; const b = closedReturns[right]['1h']
    if (a.state === 'unavailable') return a
    if (b.state === 'unavailable') return b
    return metric(a.value - b.value)
  }
  return {
    analysisEndMs, windowStartMs, curves, historyCoverage, closedReturns, latestClosed,
    anchorPrices: Object.fromEntries(assets.map(asset => [asset, anchorClose(asset) ?? null])) as Record<Asset, number | null>,
    latestClosedPresent: Object.fromEntries(assets.map(asset => [asset, prices[asset].has(analysisEndMs)])) as Record<Asset, boolean>,
    observationCoverage: Object.fromEntries(assets.map(asset => [asset,
      Array.from({ length: policy.intervals['1h'] + 1 }, (_, index) => analysisEndMs - index * step).every(at => prices[asset].has(at))
    ])) as Record<Asset, boolean>,
    correlations: { indexBtc: correlation('index', 'btc'), indexEth: correlation('index', 'eth') },
    relativeReturns: { btcMinusIndex: relative('btc', 'index'), ethMinusBtc: relative('eth', 'btc') }
  }
}
