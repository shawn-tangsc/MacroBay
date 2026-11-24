import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketSourceFailure } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { goldLivePriceOf } from './goldLivePolicy'
import { macroMarketPolicy } from './macroMarketPolicy'
import { macroMarketReturn, macroMarketWindows, type MacroMarketWindow } from './macroMarketReturns'
import { realMarketApiPolicy } from './realMarketApiPolicy'
import type { MacroMarketStore } from './macroMarketStore'
import { isPermanentRefusal } from './sourceRefusalNotifier'

export type MacroMarketReading = Readonly<{
  seriesId: string
  level: number
  atMs: number
  /** Windows the series cannot answer are absent rather than zero: a hole is not a flat market. */
  returns: Partial<Record<MacroMarketWindow, number>>
  /** Set for the dollar index, which this product computes rather than licenses. */
  synthetic?: true
  /**
   * The unclosed stream price, present only on gold. It is carried *beside* the collected level and
   * is read by no window: `returns` above is computed from stored points alone, so a live tick can
   * never move a percentage.
   */
  live?: MacroMarketLiveReading
  /**
   * 供应商**永久**拒绝了这个品种：这条水平是它最后一次给的值，重试不会更新。
   * 与"这次没读到"分成两个字段，卡片才说得清要不要读者动手（换套餐/换源）。
   */
  sourceFailure?: MacroMarketSourceFailure
}>

export type MacroMarketLiveReading = Readonly<{
  state: 'disabled' | 'connecting' | 'live' | 'stale' | 'unavailable'
  price: string
  atMs: number
}>

/** What the gold stream can say about itself. Missing means no stream is wired at all. */
export type MacroMarketLiveSource = Readonly<{
  state: 'disabled' | 'connecting' | 'live' | 'stale' | 'unavailable'
  /**
   * A price in whichever shape the source really has it: the socket names it as a JSON number, the
   * REST endpoints as a decimal string. It is normalised below, before the wire contract sees it.
   */
  tick?: Readonly<{ price: string | number; atMs: number }>
}>

export type MacroMarketSnapshot = Readonly<{
  state: 'available' | 'empty' | 'unavailable'
  asOf: string
  readings: readonly MacroMarketReading[]
  lastRunAtMs?: number
  lastPlan?: string
  caveats: readonly string[]
}>

/** The series after the dollar row, in reading order. The dollar is resolved separately, below. */
const macroSeriesOrder: readonly string[] = Object.freeze([
  macroMarketPolicy.series.gold, macroMarketPolicy.series.offshoreYuan, macroMarketPolicy.series.stablecoinPeg
])

/**
 * The snapshot the dashboard and the analysis both read. Levels come from the stored points; every
 * return comes from `macroMarketReturn`, so a window with a hole in it is reported as unanswered
 * rather than as the change since whenever the last point happened to land.
 */
export function createMacroMarketSnapshotQuery(deps: Readonly<{
  store: MacroMarketStore
  now?: () => number
  /** Optional so every existing caller keeps working: no stream, no live field. */
  live?: () => MacroMarketLiveSource
}>) {
  /**
   * 这一次快照里被永久拒掉的序列。每个快照读一次 note，逐条读数共用同一份——同一份答案问四遍
   * 既浪费也不保证一致（两次读之间 note 可能被下一轮采集重写）。
   */
  let refusedThisSnapshot: ReadonlySet<string> = new Set()
  /**
   * 这一轮采集里被供应商**永久**拒掉的品种 → 它们各自的序列。
   *
   * 采集器每轮把 `DXY:symbol-not-supported` 这样的列表写回 note（成功那轮写空串），这里只认
   * 永久那一类：临时失败由来源状态与时间说明，不进读数（进了一格会一会儿说"读不到"一会儿说
   * "不提供"，读者没法判断要不要动手）。
   */
  function refusedSeries(): ReadonlySet<string> {
    const raw = deps.store.readNote(realMarketApiPolicy.notes.lastSymbolFailures)
    if (raw === undefined || raw.trim() === '') return new Set()
    const series = new Set<string>()
    for (const entry of raw.split(',')) {
      const [symbol, code] = entry.trim().split(':')
      if (symbol === undefined || code === undefined || !isPermanentRefusal(code)) continue
      const instrument = realMarketApiPolicy.symbols.find(candidate => candidate.symbolCode === symbol)
      if (instrument) series.add(realMarketApiPolicy.series[instrument.series])
    }
    return series
  }

  function readReading(seriesId: string, synthetic?: true): MacroMarketReading | undefined {
    const latest = deps.store.latest(seriesId)
    if (!latest) return undefined
    const returns: Partial<Record<MacroMarketWindow, number>> = {}
    for (const window of macroMarketWindows) {
      const value = macroMarketReturn(deps.store, seriesId, window)
      if (value.state === 'available') returns[window] = value.percent
    }
    // Read per request, never cached: the tick moves every second while the levels move every
    // fifteen minutes, and a cached live value would be exactly the stale figure the badge warns of.
    const liveReading = seriesId === macroMarketPolicy.series.gold ? readLive(deps.live?.()) : undefined
    const refused = refusedThisSnapshot.has(seriesId)
    return Object.freeze({
      seriesId, level: latest.value, atMs: latest.atMs, returns: Object.freeze(returns),
      ...(synthetic ? { synthetic: true as const } : {}), ...(liveReading ? { live: liveReading } : {}),
      ...(refused ? { sourceFailure: 'symbol-not-supported' as const } : {})
    })
  }

  /**
   * The dollar row: the series the reader chose while it can answer, the other one when it cannot.
   *
   * 「超过 freshness 就换一条」是错的（读者 2026-10-17 的实况）：周末 FX 收盘，真实那条的最后一根是
   * 周五 20:55，而篮子那条两天前就停了，于是旧规则把**两天前**的合成值显示出来、还挂着「合成」标签——
   * 换掉的不是一条旧值，而是另一件东西。所以停更、休市、偏旧都**不算**读不到：那由新鲜度与来源状态
   * 说明，不靠换仪器表达。
   *
   * 读者 2026-11-24 又补了另一半：「没有美元的数据源，就用兜底的合成美元指数；有数据源的时候再替换。」
   * 于是分三种：
   * - 选中的那条有可用读数 → 就用它（没选过时：真实那条有用，只有合成确实更新才回退，即上面那条老规矩）；
   * - 选中的那条**没有读数，或被供应商永久拒绝**（`sourceFailure`）→ 换另一条，标签跟着被展示的那条走
   *   （合成的数永远带 `synthetic`，界面写「美元为合成指数」）；
   * - 两条都拿不到 → 把选中的那条原样交出去：无点就是没有，被拒就带着 `sourceFailure` 让界面写「来源未提供」。
   */
  function dollarReading(dollarSourceId?: string): MacroMarketReading | undefined {
    const series = macroMarketSnapshotPublicPolicy.series
    const chosen = dollarSourceId === undefined
      ? undefined
      : (macroMarketSnapshotPublicPolicy.dollarIndexSeriesBySource as Readonly<Record<string, string>>)[dollarSourceId]
    const real = readReading(series.dollarIndexReal)
    const synthetic = readReading(series.dollarIndex, true)
    /** 可用的唯一判据是「不是永久拒绝」；没有读数时读数是 `undefined`，同样不可用。 */
    const usable = (reading: MacroMarketReading | undefined): reading is MacroMarketReading =>
      reading !== undefined && reading.sourceFailure === undefined
    // 读者钉的是合成那条：它有用就用它（哪怕真实那条更新——选 A 却看到 B 是撒谎）。
    if (chosen === series.dollarIndex) {
      if (usable(synthetic)) return synthetic
      return usable(real) ? real : synthetic
    }
    // 钉了真实那条，或没选过：真实优先，合成只在「读不到」或「确实更新」时顶上。
    if (usable(real)) {
      if (usable(synthetic) && synthetic.atMs > real.atMs) return synthetic
      return real
    }
    return usable(synthetic) ? synthetic : real
  }

  function snapshot(input?: { dollarSourceId?: string }): MacroMarketSnapshot {
    const nowMs = (deps.now ?? Date.now)()
    refusedThisSnapshot = refusedSeries()
    const readings: MacroMarketReading[] = []
    const dollar = dollarReading(input?.dollarSourceId)
    if (dollar) readings.push(dollar)
    for (const seriesId of macroSeriesOrder) {
      const reading = readReading(seriesId)
      if (reading) readings.push(reading)
    }
    const lastRunAtMs = deps.store.readNote('lastRunAtMs')
    const lastPlan = deps.store.readNote('lastPlan')
    const caveats = [
      ...(readings.some(reading => reading.synthetic) ? [macroMarketPolicy.caveats.syntheticDollarIndex] : []),
      macroMarketPolicy.caveats.providerTimeSeries
    ]
    return Object.freeze({
      state: readings.length > 0 ? 'available' as const : 'empty' as const,
      asOf: new Date(nowMs).toISOString(), readings: Object.freeze(readings),
      ...(lastRunAtMs ? { lastRunAtMs: Number(lastRunAtMs) } : {}),
      ...(lastPlan ? { lastPlan } : {}),
      caveats: Object.freeze(caveats)
    })
  }
  return { snapshot }
}

/**
 * The tick, admitted only if it is exactly the shape the wire is allowed to carry. A malformed tick
 * is dropped rather than repaired: the row keeps its stored level and loses the live badge, so the
 * dashboard can never show a figure that failed its own contract.
 */
function readLive(live: MacroMarketLiveSource | undefined): MacroMarketLiveReading | undefined {
  const tick = live?.tick
  if (!live || !tick) return undefined
  // The one normalisation point before the wire contract. The socket hands the price over as the
  // provider wrote it — a JSON number — while the contract admits decimals as strings only, so the
  // number becomes its canonical decimal string here and the contract's shape is unchanged. A tick
  // this layer cannot normalise is dropped rather than repaired: a snapshot the contract refused
  // would fail as a whole, which is a worse answer than the stored level without a live badge.
  const price = goldLivePriceOf(tick.price)
  if (price === undefined || !Number.isSafeInteger(tick.atMs) || tick.atMs < 0) return undefined
  return Object.freeze({ state: live.state, price, atMs: tick.atMs })
}
export type MacroMarketSnapshotQuery = ReturnType<typeof createMacroMarketSnapshotQuery>
