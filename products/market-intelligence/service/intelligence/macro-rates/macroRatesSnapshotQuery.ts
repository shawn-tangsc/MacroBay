import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type {
  MacroRatesReading, MacroRatesSpread, MacroRatesSpreadKey, MacroRatesWindowPoint
} from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroMarketStore } from '../macro-market/macroMarketStore'
import { macroMarketRatesSeries } from '../macro-market/macroMarketSeries'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

export type MacroRatesSnapshot =
  | Readonly<{
      state: 'available' | 'empty'
      asOf: string
      readings: readonly MacroRatesReading[]
      spreads: readonly MacroRatesSpread[]
      caveats: readonly string[]
    }>
  | Readonly<{ state: 'unavailable' }>

export type MacroRatesSnapshotQueryDeps = Readonly<{
  /**
   * 序列本身：日频收盘落在一张与美元指数、金价共用的表里（`macro_market_points`）。
   * 窗口就是这张表里的点，所以「有没有走势」和「这一档有没有数」在同一个读法里回答。
   */
  store?: Pick<MacroMarketStore, 'series'>
  /**
   * 迁移期兜底：库里还没有这条序列时（刚升级、还没到下一次采集），退回到 metric 事件里的单日读数。
   * 它只有一天，所以窗口只有一个点——面板据此说「还看不出走势」，而不是编一条线。
   */
  listMetricEvents?: () => MetricIntelligenceEvent[]
  now?: () => number
}>

/**
 * The daily rate block's read path.
 *
 * It publishes only what the store actually holds: a series with no stored observation is absent from
 * `readings` (the row then says 未接入), a level that fails its own bounds is dropped rather than
 * clamped, a series whose newest event contradicts itself is dropped entirely rather than resolved by
 * pick order, and a day the market was closed is a gap rather than a zero.
 *
 * The two spreads are computed here, from the windows, and only on days both legs have a close for.
 * A leg the store does not hold produces no spread at all — never a difference against nothing.
 */
export function createMacroRatesSnapshotQuery(deps: MacroRatesSnapshotQueryDeps) {
  const policy = macroRatesSnapshotPublicPolicy
  const seriesByMetricKey = new Map<string, string>(
    Object.entries(policy.metricKeys).map(([seriesId, metricKey]) => [metricKey, seriesId])
  )

  function snapshot(): MacroRatesSnapshot {
    const asOf = new Date((deps.now ?? Date.now)()).toISOString()

    let stored: ReadonlyMap<string, readonly MacroRatesWindowPoint[]>
    try {
      stored = readStoredWindows()
    } catch {
      // A store that cannot be read is not an empty store: the panel must not read it as "no data yet".
      return unavailable()
    }

    let metrics: MetricIntelligenceEvent[] | undefined
    // Events are the fallback, not a second source of the same number: they are read only for the
    // series the store has no window for, which is the first run after the window landed.
    const needsFallback = policy.seriesIds.some(seriesId => !stored.has(seriesId))
    if (needsFallback) {
      if (!deps.listMetricEvents) return unavailable()
      try {
        metrics = deps.listMetricEvents()
        if (!Array.isArray(metrics)) return unavailable()
      } catch {
        return unavailable()
      }
    }

    const readings: MacroRatesReading[] = []
    // The order the block reads, not the order the store happened to return.
    for (const seriesId of policy.seriesIds) {
      const window = stored.get(seriesId)
      const reading = window ? readingFromWindow(seriesId, window) : readingFromEvents(seriesId, metrics ?? [], asOf)
      if (reading) readings.push(reading)
    }

    const bySeries = new Map(readings.map(reading => [reading.seriesId, reading] as const))
    const spreads: MacroRatesSpread[] = []
    for (const spread of policy.spreads) {
      const stated = spreadBetween(spread.key, bySeries.get(spread.long), bySeries.get(spread.short))
      if (stated) spreads.push(stated)
    }

    return Object.freeze({
      state: readings.length > 0 ? 'available' as const : 'empty' as const,
      asOf,
      readings: Object.freeze(readings),
      spreads: Object.freeze(spreads),
      caveats: Object.freeze([policy.caveats.officialDailyClose])
    })
  }

  /** Every admitted series that the store holds, newest `windowPoints` trading days, oldest first. */
  function readStoredWindows(): ReadonlyMap<string, readonly MacroRatesWindowPoint[]> {
    const windows = new Map<string, readonly MacroRatesWindowPoint[]>()
    if (!deps.store) return windows
    for (const seriesId of policy.seriesIds) {
      // 契约按供应商序列指认（DGS10），存储按品种名（ust-10y）：这一行是两者的唯一换算。
      const storedSeries = macroMarketRatesSeries[seriesId]
      if (!storedSeries) continue
      const points: MacroRatesWindowPoint[] = []
      for (const point of deps.store.series(storedSeries, 0, Number.MAX_SAFE_INTEGER)) {
        if (!level(point.value)) continue
        const period = observationDay(point.atMs)
        if (!period) continue
        points.push(Object.freeze({ period, value: point.value }))
      }
      if (!points.length) continue
      // One point per trading day by construction (the store's key is `(series, at_ms)`), so the tail
      // is the newest window and no day is dropped in the middle.
      windows.set(seriesId, Object.freeze(points.slice(-policy.windowPoints)))
    }
    return windows
  }

  function readingFromWindow(seriesId: string, window: readonly MacroRatesWindowPoint[]): MacroRatesReading | undefined {
    const head = window[window.length - 1]
    if (!head) return undefined
    const previous = window.length > 1 ? window[window.length - 2]!.value : undefined
    return Object.freeze({
      seriesId, metricKey: metricKeyFor(seriesId) ?? '', actual: head.value, period: head.period,
      window, ...(previous === undefined ? {} : { previous })
    })
  }

  function readingFromEvents(seriesId: string, metrics: readonly MetricIntelligenceEvent[], asOf: string): MacroRatesReading | undefined {
    const candidates: Candidate[] = []
    for (const metric of metrics) {
      const evidence = readEvidence(metric, asOf, seriesByMetricKey)
      if (evidence?.seriesId === seriesId) candidates.push(evidence)
    }
    const newest = newestUnambiguous(candidates)
    if (!newest) return undefined
    // A single-day window is the truth here: this series has no stored history yet.
    return Object.freeze({
      seriesId: newest.seriesId, metricKey: newest.metricKey, actual: newest.actual, period: newest.period,
      window: Object.freeze([Object.freeze({ period: newest.period, value: newest.actual })]),
      ...(newest.previous === undefined ? {} : { previous: newest.previous })
    })
  }

  return { snapshot }
}

export type MacroRatesSnapshotQuery = ReturnType<typeof createMacroRatesSnapshotQuery>

type Candidate = Readonly<{
  seriesId: string
  metricKey: string
  actual: number
  previous?: number
  period: string
  releaseTime: string
}>

/** `YYYY-MM-DD` for the trading day a stored instant belongs to, or nothing when it is not a date. */
function observationDay(atMs: number): string | undefined {
  const date = new Date(atMs)
  if (Number.isNaN(date.getTime())) return undefined
  const period = date.toISOString().slice(0, 10)
  return macroRatesSnapshotPublicPolicy.observationDatePattern.test(period) ? period : undefined
}

function metricKeyFor(seriesId: string): string | undefined {
  return (macroRatesSnapshotPublicPolicy.metricKeys as Record<string, string>)[seriesId]
}

/**
 * A difference between two closes on the same trading day, in percentage points.
 *
 * Only shared days survive: the 10-year may have a close the 2-year does not (a holiday one market
 * skipped), and a difference between two different days describes no day at all. Rounded to 0.1bp
 * because the subtraction of two decimals is otherwise a binary artifact (`5.24 - 4.8`), and the
 * display side rounds to the basis point anyway.
 */
function spreadBetween(
  key: MacroRatesSpreadKey,
  long: MacroRatesReading | undefined,
  short: MacroRatesReading | undefined
): MacroRatesSpread | undefined {
  if (!long || !short) return undefined
  const shortByDay = new Map(short.window.map(point => [point.period, point.value] as const))
  const window = long.window
    .filter(point => shortByDay.has(point.period))
    .map(point => Object.freeze({ period: point.period, value: roundBasisArtifact(point.value - shortByDay.get(point.period)!) }))
  const head = window[window.length - 1]
  if (!head) return undefined
  const previous = window.length > 1 ? window[window.length - 2]!.value : undefined
  return Object.freeze({
    key, actual: head.value, period: head.period, window: Object.freeze(window),
    ...(previous === undefined ? {} : { previous })
  })
}

function roundBasisArtifact(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function readEvidence(
  metric: MetricIntelligenceEvent | undefined,
  asOf: string,
  seriesByMetricKey: ReadonlyMap<string, string>
): Candidate | undefined {
  if (!metric || typeof metric !== 'object') return undefined
  if (metric.sourceId !== macroRatesSnapshotPublicPolicy.sourceId) return undefined
  const seriesId = seriesByMetricKey.get(metric.metricKey)
  if (!seriesId) return undefined
  if (typeof metric.releaseTime !== 'string' || !macroRatesSnapshotPublicPolicy.canonicalUtcPattern.test(metric.releaseTime)) return undefined
  // Visibility: an observation the store holds but the clock has not reached is not a reading yet.
  if (metric.releaseTime > asOf) return undefined
  if (!level(metric.actual)) return undefined
  if (typeof metric.period !== 'string' || !macroRatesSnapshotPublicPolicy.observationDatePattern.test(metric.period)) return undefined
  // A malformed prior day costs the change, never the level: the field is absent, not invented.
  const previous = level(metric.previous) ? metric.previous : undefined
  return Object.freeze({
    seriesId, metricKey: metric.metricKey, actual: metric.actual, period: metric.period, releaseTime: metric.releaseTime,
    ...(previous === undefined ? {} : { previous })
  })
}

/** The newest observation, or nothing at all when the newest instant carries two different readings. */
function newestUnambiguous(bucket: readonly Candidate[] | undefined): Candidate | undefined {
  if (!bucket || bucket.length === 0) return undefined
  const newest = bucket.reduce((latest, candidate) => candidate.releaseTime > latest.releaseTime ? candidate : latest)
  const tied = bucket.filter((candidate) => candidate.releaseTime === newest.releaseTime)
  const agreed = tied.every((candidate) => candidate.actual === newest.actual && candidate.previous === newest.previous && candidate.period === newest.period)
  if (!agreed) return undefined
  return newest
}

function level(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= macroRatesSnapshotPublicPolicy.maximumLevelAbs
}

function unavailable(): MacroRatesSnapshot {
  return Object.freeze({ state: 'unavailable' as const })
}
