import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { macroMarketPolicy } from '../macro-market/macroMarketPolicy'
import { realMarketApiPolicy } from '../macro-market/realMarketApiPolicy'
import type { MacroMarketStore } from '../macro-market/macroMarketStore'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

/**
 * The dollar, gold and the two 10-year yields as they stood at an instant.
 *
 * This is the product's only historical read of those four series, and it exists because a briefing
 * is frozen at its cutoff but generated hours later: the 21:00 snapshot is not the 08:00 market, and
 * a backfill that filled the gap with it would be the masquerade it is here to prevent.
 *
 * Where the numbers come from — no collection is triggered, and nothing here touches the network:
 *
 * - **dxy / gold**: the macro-market store already keeps a point per five-minute bar. The projection
 *   reads the newest point at or before the instant, through `latestAt`, so a stored bar stamped
 *   after the instant can never be read as if it had existed. The dollar follows the same instrument
 *   preference the panel applies, applied to the truncated series: the licensed index answers while
 *   it exists, and this product's own basket synthesis answers only while it is *newer* than the
 *   licensed series it replaces — labelled `synthetic`, never presented as the official index.
 * - **us10y / us10y-real**: FRED's daily closes, already parsed into the pipeline's metric events.
 *   An observation for day D is visible once D has ended in UTC, the same rule the daily brief
 *   applies to the current snapshot, so the day a cutoff falls in is dropped rather than restated.
 *
 * How far back each store reaches, stated rather than assumed:
 *
 * - the macro-market store keeps five-minute points for the newest eight days, one point per hour
 *   from there to thirty days, and nothing older (`barRetentionPolicy`);
 * - the FRED metric events are never pruned, but the collector stores only the newest observation of
 *   each fetch, so the history is one event per *collected* trading day. A day on which this app did
 *   not run is absent rather than back-filled, and this projection reports that absence instead of
 *   reaching for the newest close.
 */

const DAY_MS = 24 * 60 * 60 * 1_000

export type MacroHistoryAsOfSeries = 'dxy' | 'gold' | 'us10y' | 'us10y-real'

export type MacroHistoryAsOfRequest = Readonly<{ series: MacroHistoryAsOfSeries; asOf: string }>

export type MacroHistoryAsOfGapCode =
  | 'invalid-as-of'
  | 'future-as-of'
  | 'unknown-series'
  /** No stored history answers this instant: an unwired reader, or no observation at or before it. */
  | 'historical-as-of-unavailable'
  | 'query-unavailable'

export type MacroHistoryAsOfReading = Readonly<{
  state: 'available'
  series: MacroHistoryAsOfSeries
  /** What actually answered: `dxy-real`, `dxy-synthetic`, `xau-usd`, `DGS10` or `DFII10`. */
  seriesId: string
  asOf: string
  value: number
  /** The observation instant of the point that answered, always at or before `asOf`. */
  observedAt: string
  method: string
  sourceUrl: string
  /** Set only when the dollar row is answered by this product's own basket rather than ICE's index. */
  synthetic?: true
  /** A daily series carries the day it closes: `YYYY-MM-DD`. Absent for an intraday point. */
  period?: string
}>

export type MacroHistoryAsOfGap = Readonly<{
  state: 'unavailable'
  series: string
  asOf: string
  gapCode: MacroHistoryAsOfGapCode
  detail: string
}>

export type MacroHistoryAsOfResult = MacroHistoryAsOfReading | MacroHistoryAsOfGap

/** The read path names, in one place, so a fact's `method` and its reader cannot disagree. */
export const macroHistoryAsOfPolicy = Object.freeze({
  method: Object.freeze({
    dollarIndex: 'dxy-store-as-of',
    dollarIndexSynthetic: 'dxy-basket-synthesis-as-of',
    gold: 'gold-store-as-of',
    fredDailyClose: 'fred-daily-close-as-of'
  } as const),
  sourceUrl: Object.freeze({
    dollarIndex: `${realMarketApiPolicy.baseUrl}/api/v1/price`,
    /** The basket the synthesis is computed from, which is a different source from the licensed index. */
    dollarIndexSynthetic: macroMarketPolicy.baseUrl,
    gold: `${realMarketApiPolicy.baseUrl}/api/v1/price`,
    fredDailyClose: 'https://fred.stlouisfed.org/series'
  } as const),
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type MacroHistoryAsOfDeps = Readonly<{
  /** The macro-market store, or `undefined` when it is not part of this build. */
  macroMarket?: Pick<MacroMarketStore, 'latestAt'>
  /** The pipeline's stored metric events, or `undefined` when that store is not wired. */
  listMetricEvents?: () => readonly MetricIntelligenceEvent[]
  now?: () => number
}>

export function createMacroHistoryAsOfQuery(deps: MacroHistoryAsOfDeps) {
  function read(request: MacroHistoryAsOfRequest): MacroHistoryAsOfResult {
    const asOf = typeof request?.asOf === 'string' ? request.asOf.trim() : ''
    const series = request?.series
    if (!isCanonicalInstant(asOf)) {
      return gap(series, asOf, 'invalid-as-of', 'asOf must be a canonical UTC instant, for example 2026-10-30T00:00:00.000Z.')
    }
    const asOfMs = Date.parse(asOf)
    if (asOfMs > (deps.now ?? Date.now)()) {
      return gap(series, asOf, 'future-as-of', 'asOf is after the current time; a historical read may not answer the future.')
    }
    try {
      if (series === 'dxy') return dollarReading(deps, asOf, asOfMs)
      if (series === 'gold') return goldReading(deps, asOf, asOfMs)
      if (series === 'us10y' || series === 'us10y-real') return rateReading(deps, series, asOf, asOfMs)
      return gap(series, asOf, 'unknown-series', `no historical read answers the series ${String(series)}.`)
    } catch {
      return gap(series, asOf, 'query-unavailable', 'the stored series could not be read.')
    }
  }
  return { read }
}

export type MacroHistoryAsOfQuery = ReturnType<typeof createMacroHistoryAsOfQuery>

function dollarReading(deps: MacroHistoryAsOfDeps, asOf: string, asOfMs: number): MacroHistoryAsOfResult {
  const store = deps.macroMarket
  if (!store) return unwired('dxy', asOf, 'the macro-market store is not wired in this build.')
  const [licensedId, synthesizedId] = macroMarketSnapshotPublicPolicy.dollarIndexPreference
  const licensed = store.latestAt(licensedId, asOfMs)
  const synthesized = store.latestAt(synthesizedId, asOfMs)
  // The panel's rule, applied to what existed at the instant: the synthesis answers only while it is
  // newer than the licensed series it replaces, so an expired fallback never displaces a real one.
  if (licensed && (!synthesized || synthesized.atMs <= licensed.atMs)) {
    return pointReading('dxy', licensedId, asOf, licensed, macroHistoryAsOfPolicy.method.dollarIndex, macroHistoryAsOfPolicy.sourceUrl.dollarIndex)
  }
  if (synthesized) {
    return pointReading('dxy', synthesizedId, asOf, synthesized, macroHistoryAsOfPolicy.method.dollarIndexSynthetic, macroHistoryAsOfPolicy.sourceUrl.dollarIndexSynthetic, true)
  }
  return unwired('dxy', asOf, `the store holds no ${licensedId} or ${synthesizedId} point at or before this instant.`)
}

function goldReading(deps: MacroHistoryAsOfDeps, asOf: string, asOfMs: number): MacroHistoryAsOfResult {
  const store = deps.macroMarket
  if (!store) return unwired('gold', asOf, 'the macro-market store is not wired in this build.')
  const seriesId = macroMarketSnapshotPublicPolicy.series.gold
  const point = store.latestAt(seriesId, asOfMs)
  if (!point) return unwired('gold', asOf, `the store holds no ${seriesId} point at or before this instant.`)
  return pointReading('gold', seriesId, asOf, point, macroHistoryAsOfPolicy.method.gold, macroHistoryAsOfPolicy.sourceUrl.gold)
}

function rateReading(deps: MacroHistoryAsOfDeps, series: 'us10y' | 'us10y-real', asOf: string, asOfMs: number): MacroHistoryAsOfResult {
  const listMetricEvents = deps.listMetricEvents
  if (!listMetricEvents) return unwired(series, asOf, 'the metric-event store is not wired in this build.')
  const seriesId = series === 'us10y' ? macroRatesSnapshotPublicPolicy.series.us10y : macroRatesSnapshotPublicPolicy.series.realRate
  const metricKey = series === 'us10y' ? macroRatesSnapshotPublicPolicy.metricKeys.DGS10 : macroRatesSnapshotPublicPolicy.metricKeys.DFII10
  const events = listMetricEvents()
  if (!Array.isArray(events)) return gap(series, asOf, 'query-unavailable', 'the stored metric events could not be listed.')
  const levelsByPeriod = new Map<string, number[]>()
  for (const event of events) {
    const period = ratePeriod(event, metricKey, asOfMs)
    if (!period) continue
    const bucket = levelsByPeriod.get(period)
    if (bucket) bucket.push(event.actual)
    else levelsByPeriod.set(period, [event.actual])
  }
  // Newest visible day first. A day the store contradicts itself about is skipped rather than
  // resolved by row order, exactly as the current snapshot refuses an ambiguous reading.
  const periods = [...levelsByPeriod.keys()].sort()
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const levels = levelsByPeriod.get(periods[index])!
    if (!levels.every((level) => level === levels[0])) continue
    return Object.freeze({
      state: 'available' as const,
      series,
      seriesId,
      asOf,
      value: levels[0],
      observedAt: `${periods[index]}T00:00:00.000Z`,
      method: macroHistoryAsOfPolicy.method.fredDailyClose,
      sourceUrl: `${macroHistoryAsOfPolicy.sourceUrl.fredDailyClose}/${seriesId}`,
      period: periods[index]
    })
  }
  return unwired(series, asOf, `the store holds no ${seriesId} close for a day that had ended by this instant.`)
}

/**
 * The trade date a stored FRED event answers, or `undefined` when it answers nothing at this instant.
 *
 * Two visibility gates, both necessary: FRED's own release stamp may not be ahead of the instant, and
 * the observation day must have ended — a close for day D is the close of D, so it is known once D is
 * over in UTC and never before. The second gate is the one that matters for an 08:00 cutoff, because
 * the collector stamps `releaseTime` at midnight of the observation day rather than at publication.
 */
function ratePeriod(event: MetricIntelligenceEvent | undefined, metricKey: string, asOfMs: number): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  if (event.sourceId !== macroRatesSnapshotPublicPolicy.sourceId || event.metricKey !== metricKey) return undefined
  const period = event.period
  if (typeof period !== 'string' || !macroRatesSnapshotPublicPolicy.observationDatePattern.test(period)) return undefined
  const periodMs = Date.parse(`${period}T00:00:00.000Z`)
  if (!Number.isFinite(periodMs) || new Date(periodMs).toISOString().slice(0, 10) !== period) return undefined
  if (!Number.isFinite(event.actual) || Math.abs(event.actual) > macroRatesSnapshotPublicPolicy.maximumLevelAbs) return undefined
  if (typeof event.releaseTime !== 'string' || !macroHistoryAsOfPolicy.canonicalUtcMillisPattern.test(event.releaseTime)) return undefined
  const releaseMs = Date.parse(event.releaseTime)
  if (!Number.isFinite(releaseMs) || releaseMs > asOfMs) return undefined
  return periodMs + DAY_MS > asOfMs ? undefined : period
}

function pointReading(
  series: MacroHistoryAsOfSeries,
  seriesId: string,
  asOf: string,
  point: Readonly<{ atMs: number; value: number }>,
  method: string,
  sourceUrl: string,
  synthetic = false
): MacroHistoryAsOfResult {
  if (!Number.isSafeInteger(point.atMs) || !Number.isFinite(point.value)) {
    return gap(series, asOf, 'historical-as-of-unavailable', `the stored ${seriesId} point is not a readable observation.`)
  }
  const observedAt = new Date(point.atMs).toISOString()
  if (observedAt > asOf) {
    return gap(series, asOf, 'historical-as-of-unavailable', `the stored ${seriesId} observation ${observedAt} is newer than the requested instant.`)
  }
  return Object.freeze({
    state: 'available' as const,
    series,
    seriesId,
    asOf,
    value: point.value,
    observedAt,
    method,
    sourceUrl,
    ...(synthetic ? { synthetic: true as const } : {})
  })
}

function unwired(series: MacroHistoryAsOfSeries, asOf: string, detail: string): MacroHistoryAsOfGap {
  return gap(series, asOf, 'historical-as-of-unavailable', detail)
}

function gap(series: unknown, asOf: string, gapCode: MacroHistoryAsOfGapCode, detail: string): MacroHistoryAsOfGap {
  return Object.freeze({ state: 'unavailable' as const, series: String(series ?? ''), asOf, gapCode, detail })
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && macroHistoryAsOfPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
