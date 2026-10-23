import { describe, expect, it } from 'vitest'
import { basisPointsText, crossAssetRatesDailyExtras } from './crossAssetRatesDaily'
import type { MacroRatesReading } from '../../../../contracts/macro/macroRatesSnapshotContracts'

/**
 * 日频行的两个附注（美债 10Y 的期限利差、两行的通胀预期）。
 *
 * 两条规则来自分析侧已有的口径（`macroRatesFactProjection.ts`）：**只在两条腿描述同一个交易日时才
 * 算差值**，否则连数都不给，并挂上 `macro-rates-mixed-observation-dates`；而通胀预期是**自己一条序列**，
 * 所以永远带自己的观察日，不能借用这一行的日子。2026-10-15 那次核对就是这个场景：10Y/实际利率/2Y
 * 都在 10-13，T10YIE 已经到 10-14。
 */
const reading = (overrides: Partial<MacroRatesReading> = {}): MacroRatesReading => ({
  seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.21, previous: 5.24, period: '2026-10-13', ...overrides
})
const rates = (...readings: readonly MacroRatesReading[]) => new Map(readings.map(entry => [entry.seriesId, entry]))
const twoYear = (period: string) => reading({ seriesId: 'DGS2', metricKey: 'US_2Y_YIELD', actual: 4.79, previous: 4.8, period })
const breakeven = (period: string) => reading({ seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.35, period, previous: undefined })

describe('the daily rate row\'s extras', () => {
  it('states the term spread when both legs describe one trading day', () => {
    const extras = crossAssetRatesDailyExtras({ id: 'us10y', reading: reading(), rates: rates(twoYear('2026-10-13')) })
    // 5.21 − 4.79, read in basis points — the same rounding the analysis side's facts use.
    expect(basisPointsText(extras.termSpreadDelta!)).toBe('+42')
    expect(extras.mixedObservationDates).toBe(false)
  })

  it('withholds the spread when the two legs disagree about the day, and says why', () => {
    // A difference between two days describes no day at all: the analysis side refuses the same
    // arithmetic rather than stating a number no single close can support.
    const extras = crossAssetRatesDailyExtras({ id: 'us10y', reading: reading(), rates: rates(twoYear('2026-10-09')) })
    expect(extras.termSpreadDelta).toBeUndefined()
    expect(extras.mixedObservationDates).toBe(true)
  })

  it('treats a missing leg as absent, not as a disagreement', () => {
    const extras = crossAssetRatesDailyExtras({ id: 'us10y', reading: reading(), rates: rates() })
    // No leg at all: nothing is stated and nothing is withheld, so there is no caveat to show either.
    expect('termSpreadDelta' in extras).toBe(false)
    expect(extras.mixedObservationDates).toBe(false)
  })

  it('never states a spread on the real-rate row, whatever the 2-year holds', () => {
    const extras = crossAssetRatesDailyExtras({ id: 'realRate', reading: reading({ seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y' }), rates: rates(twoYear('2026-10-09')) })
    expect(extras.termSpreadDelta).toBeUndefined()
    expect(extras.mixedObservationDates).toBe(false)
  })

  it('carries the inflation expectation with its own observation date', () => {
    // The row is 10-13 and this value is 10-14: printing it under the row's date would attribute one
    // trading day's number to another.
    expect(crossAssetRatesDailyExtras({ id: 'us10y', reading: reading(), rates: rates(breakeven('2026-10-14')) }).breakeven)
      .toEqual({ value: 2.35, date: '2026-10-14' })
    expect(crossAssetRatesDailyExtras({ id: 'us10y', reading: reading(), rates: rates() }).breakeven).toBeUndefined()
  })
})
