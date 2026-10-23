import {
  crossAssetContractPolicy, crossAssetCurveStrideMs, crossAssetMethods, parseCrossAssetInput,
  type CrossAssetId, type CrossAssetMacroProxyId, type CrossAssetQueryInput, type CrossAssetRange
} from '../../../contracts/crossAssetObservationContracts'
import { analyzeCrossAssetHistory, crossAssetAnalyticsPolicy, crossAssetObservationPolicy } from './crossAssetAnalytics'
import { crossAssetMacroCurvePolicy, crossAssetMacroCurves, type CrossAssetMacroCandidate } from './crossAssetMacroCurves'
import type { ClosedBar, StoredSymbol } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'
import { resolveCrossAssetReading, type CrossAssetReadingLegValue } from './crossAssetReading'
import { crossAssetRowMarketState, type CrossAssetMarketState } from './crossAssetIndexSession'
import {
  crossAssetIndexHasLiveQuote, crossAssetIndexSymbol, selectCrossAssetIndexSource,
  type CrossAssetIndexFeedState, type CrossAssetIndexSource
} from './crossAssetIndexSource'

type LiveQuote = { state: 'live' | 'stale'; price: string; tradedAtMs: number; receivedAtMs: number } | { state: 'missing' }
type Live = { state: 'disabled' | 'connecting' | 'live' | 'stale' | 'limited' | 'unavailable'; quotes: Record<CrossAssetId, LiveQuote>; priceDecimals?: Partial<Record<CrossAssetId, number>> }
type Analysis = ReturnType<typeof analyzeCrossAssetHistory>
type ClosePoint = Readonly<{ atMs: number; close: string }>
type Presence = Readonly<{ real: boolean; proxy: boolean }>
type Snapshot = {
  schemaVersion: 1; mode: 'current' | 'historical'; servedAt: string; asOf: string; range: CrossAssetRange
  analysisEnd: string; windowStart: string; historyCoverage: Analysis['historyCoverage']
  curves: Record<CrossAssetId, { at: string; returnPercent: number | null }[]>
  /** Written only when this build has a macro store to read, exactly as the wire contract says. */
  macroCurves?: Record<CrossAssetMacroProxyId, { at: string; returnPercent: number | null }[]>
  /** The cross-market reading (design 142), stated only in `current` mode and never for a past instant. */
  reading?: ReturnType<typeof resolveCrossAssetReading>
  closedReturns: Analysis['closedReturns']; correlations: Analysis['correlations']; relativeReturns: Analysis['relativeReturns']
  indexSource: CrossAssetIndexSource
  sourceState?: Live['state']; quotes?: Live['quotes']
  marketState?: Record<CrossAssetId, CrossAssetMarketState>
  lastClosed?: Record<CrossAssetId, { at: string; close: string } | null>
  forming?: Record<CrossAssetId, { at: string; returnPercent: number } | null>
  observationKey: { indexBtc: 'up' | 'down' | 'diverging' | 'mixed' | 'unavailable'; ethBtc: 'stronger' | 'weaker' | 'flat' | 'unavailable' }
}
const assets = Object.keys(crossAssetPolicy.assets) as CrossAssetId[]
const iso = (value: number) => new Date(value).toISOString()

/**
 * How much history a snapshot needs, independent of the range the chart is showing.
 *
 * The featured 7d window needs its endpoint and the bar seven days before it, and the store admits a
 * bar only at or after `analysisEnd - 7d`. That span is wider than the product's own single-read cap
 * of `historyMaxPoints`, so it is read in contiguous slices — the alternative, reading only what the
 * selected range needs, is what made the 7d column permanently 无数据 on a 24h chart.
 *
 * The span carries a small margin at each end, because the store answers on **bar end** times:
 * `analysisEnd - interval` is the newest admitted close and `analysisEnd - 7d` is the oldest, and both
 * have to fall strictly inside a read rather than exactly on its edge.
 */
/**
 * How much history a read asks for: the longer of the longest printed window (the table's 7d column) and
 * this range's own window. A thirty-day curve needs thirty days of closes, and the short ranges still need
 * seven days so the 7d column beside them stays answerable from one analysis.
 */
const historyIngestMs = (range: CrossAssetRange): number =>
  // 每个准入窗口都在热层内、都取精确同一时刻，所以不需要"锚点回看量"那一段（那是跨冷层窗口才要的，
  // 随 30d 一起删了）。
  (Math.max(crossAssetAnalyticsPolicy.intervals['7d'], crossAssetContractPolicy.coveragePoints[range]) + 4) * crossAssetPolicy.intervalMs

export function createCrossAssetSnapshotQuery(deps: {
  now: () => number
  store: { readonly revision: number; queryAt: (input: { symbol: ClosedBar['symbol']; fromMs: number; toMs: number; asOfMs: number }) => readonly ClosedBar[] }
  /**
   * The macro store's own series reader, for the dollar and gold lines.
   *
   * Optional: with no reader the snapshot carries no `macroCurves` at all and the panel draws the three
   * crypto lines, which keeps this query usable in tests and in any product that has not wired the macro
   * store into the cross-asset one.
   */
  macroSeries?: (seriesId: string, fromMs: number, toMs: number) => readonly { atMs: number; value: number }[]
  live: () => Live
  /** What the licensed index feed last managed to do. Absent means "no feed wired in this process". */
  indexFeed?: () => Readonly<{ state: CrossAssetIndexFeedState }>
}) {
  /**
   * The cache is keyed by what the answer depends on: the store revision, the analysis instant, and
   * the leg that answers the index row. The leg is part of the key because a source that goes from
   * answering to unanswerable moves the row between two instruments without a single bar changing.
   */
  const cache = new Map<CrossAssetRange, { revision: number; end: number; indexSource: CrossAssetIndexSource; presence: Presence; result: Analysis }>()
  /**
   * The stored closes over the whole ingested span. Read as contiguous, **non-overlapping** slices,
   * each strictly inside the store's single-read cap, because one read cannot reach from the
   * horizon's endpoint back to the bar that anchors its far end. A slice that overran the cap would
   * not degrade — the store throws and the whole snapshot turns unavailable — so the split is derived
   * from the cap rather than assumed to fit.
   */
  const readHistory = (fromMs: number, toMs: number, asOfMs: number): Record<string, ClosePoint[]> => {
    const span = toMs - fromMs
    // The cap is a **count** of bars, so it converts to milliseconds before it can bound a span.
    const capMs = crossAssetPolicy.historyMaxPoints * crossAssetPolicy.intervalMs
    const sliceCount = Math.ceil(span / capMs) + 1
    const evenSliceMs = Math.floor(span / sliceCount)
    const remainder = span - evenSliceMs * sliceCount
    const bounds: number[] = [fromMs]
    for (let index = 0; index < sliceCount; index++) {
      bounds.push((bounds[index] as number) + evenSliceMs + (index < remainder ? 1 : 0))
    }
    return Object.fromEntries(crossAssetPolicy.storedSymbols.map(symbol => [symbol,
      bounds.slice(0, -1).flatMap((start, index) => deps.store.queryAt({
        symbol: symbol as StoredSymbol, fromMs: start, toMs: bounds[index + 1] as number, asOfMs
      }) as readonly ClosedBar[]).map(bar => ({ atMs: bar.barEndMs, close: bar.close }))])) as Record<string, ClosePoint[]>
  }
  return {
    query(value: CrossAssetQueryInput): Snapshot {
      const now = deps.now()
      const parsed = parseCrossAssetInput(crossAssetMethods.query, value, now)
      if (!parsed || !('range' in parsed)) throw new Error('invalid-query')
      const input = parsed as CrossAssetQueryInput
      const mode = input.asOf ? 'historical' : 'current'
      const asOfMs = input.asOf ? Date.parse(input.asOf) : now
      const end = Math.floor(asOfMs / crossAssetPolicy.intervalMs) * crossAssetPolicy.intervalMs
      const feedState: CrossAssetIndexFeedState = deps.indexFeed?.().state ?? 'pending'
      // The live runtime state is read once, and only for a current snapshot: a historical observation
      // is judged by the bars that were stored for it, not by today's connection. The proxy leg is the
      // row's default, so its own switch and health decide whether it answers.
      const live = mode === 'current' ? deps.live() : undefined
      const liveState = live?.state ?? 'live'
      const cached = mode === 'current' ? cache.get(input.range) : undefined
      const reusable = cached !== undefined && cached.revision === deps.store.revision && cached.end === end
      let presence: Presence = reusable ? cached!.presence : { real: false, proxy: false }
      let indexSource = selectCrossAssetIndexSource({ feedState, liveState, realAvailable: presence.real, proxyAvailable: presence.proxy })
      let result = reusable && cached!.indexSource === indexSource ? cached!.result : undefined
      if (!result) {
        // The read span is the horizon, not the selected range: every window the table prints — the
        // 7d one included — has to be answerable from one analysis, whatever the chart is showing.
        // The upper bound is one interval **past** `end`, because the store answers bars that end at
        // or below `min(toMs, asOf - interval)`: asking for exactly `end` would drop the newest
        // admitted close (`end - interval`) instead of including it.
        const fromMs = end - historyIngestMs(input.range)
        const toMs = end + crossAssetPolicy.intervalMs
        const histories = readHistory(fromMs, toMs, asOfMs)
        presence = {
          real: (histories[crossAssetPolicy.index.symbol] ?? []).length > 0,
          proxy: (histories[crossAssetPolicy.index.proxySymbol] ?? []).length > 0
        }
        indexSource = selectCrossAssetIndexSource({ feedState, liveState, realAvailable: presence.real, proxyAvailable: presence.proxy })
        const selected = crossAssetIndexSymbol(indexSource)
        // Cached facts remain historical; current freshness is overlaid below, never cached across time.
        result = analyzeCrossAssetHistory({
          history: {
            index: selected === undefined ? [] : histories[selected] ?? [],
            btc: histories[crossAssetPolicy.assets.btc] ?? [], eth: histories[crossAssetPolicy.assets.eth] ?? []
          },
          range: input.range, asOfMs, mode: 'historical'
        })
        if (mode === 'current') cache.set(input.range, { revision: deps.store.revision, end, indexSource, presence, result })
      }
      const analysis = result
      const snapshot: Snapshot = {
        schemaVersion: 1, mode, servedAt: iso(now), asOf: iso(asOfMs), range: input.range,
        analysisEnd: iso(analysis.analysisEndMs), windowStart: iso(analysis.windowStartMs),
        historyCoverage: analysis.historyCoverage,
        curves: Object.fromEntries(assets.map(asset => [asset, analysis.curves[asset].map(point => ({ at: iso(point.atMs), returnPercent: point.returnPercent }))])) as Snapshot['curves'],
        closedReturns: analysis.closedReturns, correlations: analysis.correlations, relativeReturns: analysis.relativeReturns,
        indexSource,
        observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' }
      }
      /**
       * The macro lines, read on every query rather than cached with the analysis: they come from another
       * store on another cadence, so the cross-asset cache's revision says nothing about them. The read
       * starts before the window on purpose — the anchor is the last close *at or before* the window
       * start, which on a Sunday is Friday's.
       */
      if (deps.macroSeries) {
        const readSeries = deps.macroSeries
        const macroFromMs = analysis.windowStartMs - crossAssetMacroCurvePolicy.anchorLookbackMs
        const candidates = (proxy: CrossAssetMacroProxyId): CrossAssetMacroCandidate[] =>
          crossAssetMacroCurvePolicy.proxies[proxy].map(seriesId => Object.freeze({
            seriesId, points: readSeries(seriesId, macroFromMs, analysis.analysisEndMs)
          }))
        const curves = crossAssetMacroCurves({
          candidates: { dxy: candidates('dxy'), gold: candidates('gold') },
          windowStartMs: analysis.windowStartMs,
          count: crossAssetContractPolicy.points[input.range],
          strideMs: crossAssetCurveStrideMs(input.range)
        })
        const wire = (points: readonly { atMs: number; returnPercent: number | null }[]) =>
          points.map(point => ({ at: iso(point.atMs), returnPercent: point.returnPercent }))
        snapshot.macroCurves = { dxy: wire(curves.dxy), gold: wire(curves.gold) }
      }
      const safeCopy = structuredClone(snapshot)
      // `live` is read exactly once per query and only in current mode; the condition narrows it.
      if (mode === 'current' && live) {
        // The session of each row is stated, never inferred from a missing bar: the Nasdaq 100 row is
        // shut outside the US cash session while its feed is perfectly healthy, and the crypto rows
        // trade around the clock. What the row has to show in either case is its last closed bar.
        safeCopy.marketState = Object.fromEntries(assets.map(asset => [asset,
          crossAssetRowMarketState(asset, indexSource, asOfMs, analysis.latestClosed[asset] !== null)])) as Snapshot['marketState']
        safeCopy.lastClosed = Object.fromEntries(assets.map(asset => {
          const latest = analysis.latestClosed[asset]
          return [asset, latest === null ? null : { at: iso(latest.atMs), close: latest.close }]
        })) as Snapshot['lastClosed']
        if (now - end > crossAssetAnalyticsPolicy.missingGraceMs) {
          const missing = (asset: CrossAssetId) => !analysis.latestClosedPresent[asset]
          for (const asset of assets.filter(missing)) {
            for (const metric of Object.values(safeCopy.closedReturns[asset])) if (metric.state === 'unavailable') metric.reason = 'stale'
          }
          for (const [key, pair] of [['indexBtc', ['index', 'btc']], ['indexEth', ['index', 'eth']]] as const) {
            const metric = safeCopy.correlations[key]
            if (pair.some(missing) && metric.state === 'unavailable') metric.reason = 'stale'
          }
          for (const [key, pair] of [['btcMinusIndex', ['btc', 'index']], ['ethMinusBtc', ['eth', 'btc']]] as const) {
            const metric = safeCopy.relativeReturns[key]
            if (pair.some(missing) && metric.state === 'unavailable') metric.reason = 'stale'
          }
        }
        safeCopy.sourceState = live.state
        safeCopy.quotes = Object.fromEntries(assets.map(asset => {
          // Only the tokenised proxy trades continuously. While the real index answers the row there is
          // no live tick for it, and printing the proxy's price beside the index's value would put two
          // instruments in one cell.
          if (asset === crossAssetPolicy.index.row && !crossAssetIndexHasLiveQuote(indexSource)) return [asset, { state: 'missing' as const }]
          const quote = live.quotes[asset]
          const precision = live.priceDecimals?.[asset]
          if (quote.state !== 'missing' && (!crossAssetPolicy.decimalPattern.test(quote.price) || quote.price.length > crossAssetPolicy.decimalMaxLength ||
            !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0 ||
            ![quote.tradedAtMs, quote.receivedAtMs].every(value => Number.isSafeInteger(value) && value >= 0))) throw new Error('snapshot-unavailable')
          return [asset, quote.state === 'missing' ? { state: 'missing' as const } : {
            state: quote.state, price: Number.isSafeInteger(precision) && precision! >= 0 && precision! <= crossAssetPolicy.decimalMaxLength ? Number(quote.price).toFixed(precision) : quote.price,
            tradedAtMs: quote.tradedAtMs, receivedAtMs: quote.receivedAtMs
          }]
        })) as Live['quotes']
        const fresh = (asset: CrossAssetId) => {
          const quote = safeCopy.quotes![asset]
          return live.state === 'live' && quote.state === 'live' &&
            [quote.tradedAtMs, quote.receivedAtMs].every(at => at <= now + crossAssetPolicy.stream.futureToleranceMs &&
              Math.max(0, now - at) <= crossAssetPolicy.stream.freshnessMs)
        }
        safeCopy.forming = Object.fromEntries(assets.map(asset => {
          const quote = safeCopy.quotes![asset]
          const anchor = analysis.anchorPrices[asset]
          if (input.range === '7d' || !fresh(asset) || quote.state === 'missing' || !anchor ||
            !analysis.latestClosedPresent[asset] || quote.tradedAtMs <= end || quote.tradedAtMs > now) return [asset, null]
          const returnPercent = crossAssetAnalyticsPolicy.percentFactor * (Number(quote.price) / anchor - 1)
          return [asset, Number.isFinite(returnPercent) ? { at: iso(quote.tradedAtMs), returnPercent } : null]
        })) as Snapshot['forming']
        const eligible = (asset: CrossAssetId) => fresh(asset) && analysis.observationCoverage[asset]
        const index = analysis.closedReturns.index['1h']; const btc = analysis.closedReturns.btc['1h']
        if (eligible('index') && eligible('btc') && index.state === 'available' && btc.state === 'available') {
          const direction = (asset: CrossAssetId, value: number) => value > crossAssetObservationPolicy.flatPercent[asset] ? 1 :
            value < -crossAssetObservationPolicy.flatPercent[asset] ? -1 : 0
          const a = direction('index', index.value); const b = direction('btc', btc.value)
          safeCopy.observationKey.indexBtc = a === 1 && b === 1 ? 'up' : a === -1 && b === -1 ? 'down' : a * b < 0 ? 'diverging' : 'mixed'
        }
        const relative = analysis.relativeReturns.ethMinusBtc
        if (eligible('eth') && eligible('btc') && relative.state === 'available') {
          safeCopy.observationKey.ethBtc = relative.value > 0 ? 'stronger' : relative.value < 0 ? 'weaker' : 'flat'
        }
        /**
         * The cross-market reading (design 142).
         *
         * Computed last, on purpose: it reads the legs exactly as the panel will show them, `stale` overlays
         * included, so a leg the reader sees as stale cannot be judged as if it had moved.
         *
         * Only in `current` mode. A historical snapshot answers "what did the chart look like at T", and the
         * reading is a statement about *now*; stating one for a past instant from curves that may not have
         * been complete then would be inventing history. The field is optional, so its absence is legal.
         *
         * The four legs come from the two places the chart already draws from: the closed 24h returns for
         * the index and BTC, and the macro curves' own last point for the dollar and gold (a hole there is
         * a missing leg, not a flat one). The correlation is the 24h·5m one and travels with its horizon.
         */
        const legValue = (asset: 'index' | 'btc'): CrossAssetReadingLegValue => {
          const metric = safeCopy.closedReturns[asset]['24h']
          return metric.state === 'available' ? { state: 'available', returnPercent: metric.value } : { state: 'unavailable', reason: metric.reason }
        }
        const macroLeg = (proxy: 'dxy' | 'gold'): CrossAssetReadingLegValue => {
          const point = safeCopy.macroCurves?.[proxy]?.at(-1)
          return point && point.returnPercent !== null ? { state: 'available', returnPercent: point.returnPercent } : { state: 'unavailable', reason: 'missing' }
        }
        const asNumber = (metric: (typeof safeCopy.relativeReturns)['btcMinusIndex']): number | null =>
          metric.state === 'available' ? metric.value : null
        const correlation = safeCopy.correlations.indexBtc
        safeCopy.reading = resolveCrossAssetReading({
          window: input.range,
          legs: { dxy: macroLeg('dxy'), gold: macroLeg('gold'), index: legValue('index'), btc: legValue('btc') },
          correlation: correlation.state === 'available'
            ? { state: 'available', value: correlation.value, sampleCount: correlation.sampleCount, expectedCount: correlation.expectedCount }
            : { state: 'unavailable', reason: correlation.reason },
          relativeReturns: { btcMinusIndex: asNumber(safeCopy.relativeReturns.btcMinusIndex), ethMinusBtc: asNumber(safeCopy.relativeReturns.ethMinusBtc) },
          // The tokenised index is the product's own default leg, so it is said rather than refused; the
          // row already carries the 代理 tag, and a sentence that read the proxy silently would not.
          notices: indexSource === 'proxy' ? ['index-proxy'] : []
        })
      }
      return safeCopy
    }
  }
}
