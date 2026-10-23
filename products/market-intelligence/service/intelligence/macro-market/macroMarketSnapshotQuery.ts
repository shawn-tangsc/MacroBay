import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { goldLivePriceOf } from './goldLivePolicy'
import { macroMarketPolicy } from './macroMarketPolicy'
import { macroMarketReturn, macroMarketWindows, type MacroMarketWindow } from './macroMarketReturns'
import type { MacroMarketStore } from './macroMarketStore'

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
    return Object.freeze({
      seriesId, level: latest.value, atMs: latest.atMs, returns: Object.freeze(returns),
      ...(synthetic ? { synthetic: true as const } : {}), ...(liveReading ? { live: liveReading } : {})
    })
  }

  /**
   * The dollar row: the licensed index whenever it has a point, the synthesis only while the synthesis
   * is *newer* than it.
   *
   * 「超过 freshness 就换一条」是错的（读者 2026-10-17 的实况）：周末 FX 收盘，真实那条的最后一根是
   * 周五 20:55，而篮子那条两天前就停了（`twelve-data-market` 已被关掉），于是旧规则把**两天前**的
   * 合成值显示出来、还挂着「合成」标签——换掉的不是一条旧值，而是另一件东西。
   *
   * 所以只有一条规矩：**兜底不能比被替换的那条更旧**。真实那条旧了就叫旧了——`macroMarketReturn`
   * 已经按"最新一根"算窗口，新鲜度由行的最近更新时间与来源状态分别说明，不需要靠换仪器表达。
   * 合成值仍然带 `synthetic` 标记，所以标签永远跟着它描述的那个数走。
   */
  function dollarReading(): MacroMarketReading | undefined {
    const real = deps.store.latest(macroMarketSnapshotPublicPolicy.series.dollarIndexReal)
    if (real) {
      const synthetic = deps.store.latest(macroMarketSnapshotPublicPolicy.series.dollarIndex)
      if (!synthetic || synthetic.atMs <= real.atMs) return readReading(macroMarketSnapshotPublicPolicy.series.dollarIndexReal)
    }
    return readReading(macroMarketSnapshotPublicPolicy.series.dollarIndex, true)
  }

  function snapshot(): MacroMarketSnapshot {
    const nowMs = (deps.now ?? Date.now)()
    const readings: MacroMarketReading[] = []
    const dollar = dollarReading()
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
