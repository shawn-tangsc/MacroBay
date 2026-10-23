import { macroRatesSnapshotPublicPolicy, type MacroRatesReading } from '../../../../contracts/macro/macroRatesSnapshotContracts'

/**
 * The two extras a daily rate row carries: the 10Y−2Y term spread, and the inflation expectation.
 *
 * Both are read from series that were published *per trading day*, so both have to answer "which day
 * is this number about?" before they are stated:
 *
 * - **The spread needs one day.** It is a difference between two daily closes, and a difference
 *   between two days describes no day at all. The analysis side already refuses that arithmetic
 *   (`projectMacroRates` states `us-10y-2y-term-spread` only while both legs share a period, and
 *   otherwise raises `macro-rates-mixed-observation-dates`); the table follows the same rule rather
 *   than being the looser of the two readers. A leg the store does not hold is *absent*, not a
 *   disagreement: nothing is withheld and nothing is claimed.
 * - **The expectation carries its own day.** T10YIE is its own series and can be a day ahead of the
 *   yields — on 2026-10-15 it was (10-14 while DGS10/DFII10/DGS2 were 10-13). The date therefore
 *   travels with the value instead of being inherited from the row.
 *
 * The rule lives here, pure and testable, rather than inside the row's render: the numbers are what
 * the reader checks, and "which day" is the part that was silently wrong.
 */
export type CrossAssetRatesDailyExtras = Readonly<{
  /** The 10Y−2Y difference in percentage points, present only while both legs share a trading day. */
  termSpreadDelta?: number
  /** The inflation expectation with the observation date it belongs to. */
  breakeven?: Readonly<{ value: number; date: string }>
  /** True when the spread was withheld because its two legs disagree about the trading day. */
  mixedObservationDates: boolean
}>

export function crossAssetRatesDailyExtras(input: Readonly<{
  id: 'us10y' | 'realRate'
  reading: MacroRatesReading
  rates: ReadonlyMap<string, MacroRatesReading>
}>): CrossAssetRatesDailyExtras {
  const { id, reading, rates } = input
  const twoYear = rates.get(macroRatesSnapshotPublicPolicy.series.us2y)
  const spreadIsAboutOneDay = id === 'us10y' && twoYear !== undefined
  const mixedObservationDates = spreadIsAboutOneDay && twoYear.period !== reading.period
  const breakeven = rates.get(macroRatesSnapshotPublicPolicy.series.breakevenInflation)
  return Object.freeze({
    ...(spreadIsAboutOneDay && !mixedObservationDates ? { termSpreadDelta: reading.actual - twoYear.actual } : {}),
    ...(breakeven ? { breakeven: Object.freeze({ value: breakeven.actual, date: breakeven.period }) } : {}),
    mixedObservationDates
  })
}

/**
 * `+2bp` / `−2bp` / `0bp`: a yield difference is read in basis points, never as a percentage.
 *
 * Rounded to the basis point the reader sees, which is also what the analysis side's `basisPoints`
 * does for its change and spread facts — so the cell and the fact a conclusion quotes cannot state
 * two different numbers for one move.
 */
export function basisPointsText(delta: number): string {
  const bp = Math.round(delta * 100)
  if (bp === 0) return '0'
  return bp > 0 ? `+${bp}` : `−${Math.abs(bp)}`
}
