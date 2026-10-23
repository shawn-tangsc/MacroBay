import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  type AgentFact
} from '../../../contracts/marketAnalysisContracts'
import {
  macroRatesSnapshotPublicPolicy,
  type MacroRatesReading
} from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesSnapshot } from '../macro-rates/macroRatesSnapshotQuery'
import {
  mergeDomainObservation,
  observation,
  type MarketAnalysisDomainObservation
} from './domainObservationMerge'
import { fact } from './marketAnalysisContextProjection'

export const MACRO_RATES_FACT_METRICS = Object.freeze({
  us10y: 'us-10y-yield',
  realRate: 'us-10y-real-yield',
  us2y: 'us-2y-yield',
  breakevenInflation: 'us-10y-breakeven-inflation',
  /**
   * The daily panel's own extra: the 10-year minus the 2-year, in basis points. It is computed here
   * because both legs are FRED's own levels for the *same* trading day, and the panel already reads
   * the same difference; when the two legs disagree about the day it is not stated at all.
   */
  termSpread10y2y: 'us-10y-2y-term-spread'
} as const)

/** Every fact from this source is an official trading-day close, and says so. */
export const MACRO_RATES_READ_CAVEAT = macroRatesSnapshotPublicPolicy.caveats.officialDailyClose

/** The two legs the term spread needs, and the day they must agree on. */
const TERM_SPREAD_LEGS = Object.freeze({
  long: macroRatesSnapshotPublicPolicy.series.us10y,
  short: macroRatesSnapshotPublicPolicy.series.us2y
})

type Projection = Readonly<{
  asOf: string
  facts: AgentFact[]
  caveats: Set<string>
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
}>

/**
 * Projects FRED's daily rate readings into analysis facts.
 *
 * A reading is a *trading-day close*, not an instant: the observation date travels in the metric's
 * identity and in `observedAt` (midnight UTC of that date), and `official-daily-close` rides with
 * every fact so no conclusion reads a daily series as the explanation of an intraday move. FRED's
 * `.` missing marker never reaches here as a number — the query drops a level that fails its own
 * bounds — and a period the analysis clock has not reached is dropped rather than shown as current.
 *
 * No arithmetic beyond the panel's own term spread and day-over-day change: a rate is a level, a
 * change is quoted in basis points, and nothing is annualised, averaged or compounded.
 */
export function projectMacroRates(
  snapshot: MacroRatesSnapshot | undefined,
  asOf: string,
  facts: AgentFact[],
  caveats: Set<string>,
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
): void {
  const projection: Projection = { asOf, facts, caveats, observations }
  const view = readableView(snapshot, asOf)
  if (!view) {
    observations.macro = mergeDomainObservation(observations.macro,
      observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable]))
    return
  }
  if (view.readings.length === 0) {
    observations.macro = mergeDomainObservation(observations.macro,
      observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty]))
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
    return
  }

  const bySeries = new Map(view.readings.map(reading => [reading.seriesId, reading] as const))
  let factCount = 0
  const add = (metric: string, value: number, unit: string, reading: MacroRatesReading, suffix: string): void => {
    projection.facts.push(fact(
      'macro', 'us-treasury', metric, value, unit, macroRatesSnapshotPublicPolicy.sourceId,
      `${reading.period}T00:00:00.000Z`, projection.asOf, 'comparable', suffix
    ))
    factCount += 1
  }
  // The four series the block reads, in its order: the 10-year headline, its real counterpart, and
  // the two legs of the extras. A series the store cannot answer contributes nothing at all.
  for (const [seriesId, metric, unit, suffix] of [
    [macroRatesSnapshotPublicPolicy.series.us10y, MACRO_RATES_FACT_METRICS.us10y, '%', 'level'],
    [macroRatesSnapshotPublicPolicy.series.realRate, MACRO_RATES_FACT_METRICS.realRate, '%', 'level'],
    [macroRatesSnapshotPublicPolicy.series.us2y, MACRO_RATES_FACT_METRICS.us2y, '%', 'level'],
    [macroRatesSnapshotPublicPolicy.series.breakevenInflation, MACRO_RATES_FACT_METRICS.breakevenInflation, '%', 'level']
  ] as const) {
    const reading = bySeries.get(seriesId)
    if (reading) add(metric, reading.actual, unit, reading, suffix)
    // The day-over-day change the daily block prints beside the level, in basis points: a yield
    // difference is never stated as a percent, and it is rounded to the basis point the reader sees
    // (`basisPointsText` in the panel) so the fact and the cell cannot state two different numbers.
    if (reading && reading.previous !== undefined) add(`${metric}-change-1d`, basisPoints(reading.actual - reading.previous), 'bp', reading, `${suffix}-change-1d`)
  }
  const long = bySeries.get(TERM_SPREAD_LEGS.long)
  const short = bySeries.get(TERM_SPREAD_LEGS.short)
  if (long && short) {
    if (long.period === short.period) add(MACRO_RATES_FACT_METRICS.termSpread10y2y, basisPoints(long.actual - short.actual), 'bp', long, 'term-spread')
    else caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroRatesMixedPeriods)
  }
  caveats.add(MACRO_RATES_READ_CAVEAT)
  observations.macro = mergeDomainObservation(observations.macro, observation(
    factCount > 0 ? 'available' : 'empty', factCount > 0 ? 'fresh' : 'missing', factCount, 0,
    factCount > 0 ? [MACRO_RATES_READ_CAVEAT] : [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty]
  ))
  if (factCount === 0) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
}

/**
 * The snapshot as this projection may read it: a reading is a day the analysis clock has reached.
 *
 * A reading whose observation date is ahead of `asOf` is a look-ahead — the value is genuine but it
 * did not exist at the analysis boundary — so it is dropped rather than restated as current.
 */
function readableView(
  snapshot: MacroRatesSnapshot | undefined,
  asOf: string
): Readonly<{ readings: readonly MacroRatesReading[] }> | undefined {
  if (!snapshot || snapshot.state === 'unavailable') return undefined
  if (!Array.isArray(snapshot.readings)) return undefined
  const cutoff = asOf.slice(0, 10)
  return {
    readings: snapshot.readings.filter(reading =>
      isReading(reading) && macroRatesSnapshotPublicPolicy.seriesIds.includes(reading.seriesId) && reading.period <= cutoff)
  }
}

/**
 * A yield difference in basis points, rounded to the basis point.
 *
 * Binary floating point turns `4.15 - 4.0` into `0.15000000000000036`; the panel prints the rounded
 * figure, and a fact carrying the raw product would state a number the reader cannot see anywhere.
 */
function basisPoints(delta: number): number {
  return Math.round(delta * 100)
}

function isReading(value: MacroRatesReading | undefined): value is MacroRatesReading {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<MacroRatesReading>
  return typeof record.seriesId === 'string' && typeof record.metricKey === 'string' &&
    typeof record.actual === 'number' && Number.isFinite(record.actual) &&
    (record.previous === undefined || (typeof record.previous === 'number' && Number.isFinite(record.previous))) &&
    typeof record.period === 'string' && macroRatesSnapshotPublicPolicy.observationDatePattern.test(record.period)
}
