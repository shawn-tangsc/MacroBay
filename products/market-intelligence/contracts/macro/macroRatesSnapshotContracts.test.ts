import { describe, expect, it } from 'vitest'

import {
  macroRatesSnapshotPublicPolicy,
  parseMacroRatesSnapshot,
  type MacroRatesSnapshotView
} from './macroRatesSnapshotContracts'

const asOf = '2026-10-14T12:00:00.000Z'

/** The real reading pair the panel's 美债 10Y row shows: 5.24 on 10-09 after 5.22 on 10-08. */
const us10y = { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09' }
const realRate = { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.91, previous: 2.87, period: '2026-10-09' }

function available(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'available', asOf, readings: [us10y, realRate],
    caveats: ['official-daily-close'], ...overrides
  }
}

describe('macro rates snapshot contract', () => {
  it('admits the four FRED series and the daily-close caveat', () => {
    expect(macroRatesSnapshotPublicPolicy.method).toBe('intelligence.macro.ratesSnapshot.query')
    expect(macroRatesSnapshotPublicPolicy.seriesIds).toEqual(['DGS10', 'DFII10', 'DGS2', 'T10YIE'])
    expect(macroRatesSnapshotPublicPolicy.caveatIds).toEqual(['official-daily-close'])
  })

  it('freezes an admitted reading without inventing a previous value', () => {
    const parsed = parseMacroRatesSnapshot(available({
      readings: [{ seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.33, period: '2026-10-13' }]
    }))

    expect(parsed).toEqual({
      state: 'available', asOf, caveats: ['official-daily-close'],
      readings: [{ seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.33, period: '2026-10-13' }]
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    const readings = (parsed as Extract<MacroRatesSnapshotView, { state: 'available' }>).readings
    expect(Object.isFrozen(readings)).toBe(true)
    expect(readings[0]).not.toHaveProperty('previous')
  })

  it('admits an empty answer only when it carries no reading', () => {
    expect(parseMacroRatesSnapshot({ state: 'empty', asOf, readings: [], caveats: ['official-daily-close'] }))
      .toEqual({ state: 'empty', asOf, readings: [], caveats: ['official-daily-close'] })
    expect(parseMacroRatesSnapshot({ state: 'empty', asOf, readings: [us10y], caveats: [] })).toBeUndefined()
    expect(parseMacroRatesSnapshot({ state: 'available', asOf, readings: [], caveats: [] })).toBeUndefined()
  })

  it('admits the unavailable answer alone', () => {
    expect(parseMacroRatesSnapshot({ state: 'unavailable' })).toEqual({ state: 'unavailable' })
    expect(parseMacroRatesSnapshot({ state: 'unavailable', readings: [] })).toBeUndefined()
  })

  it.each([
    ['a foreign series', available({ readings: [{ ...us10y, seriesId: 'DTWEXBGS' }] })],
    ['a metric key that is not that series', available({ readings: [{ ...us10y, metricKey: 'US_2Y_YIELD' }] })],
    ['a non-canonical observation date', available({ readings: [{ ...us10y, period: '2026/10/09' }] })],
    ['a missing observation date', available({ readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24 }] })],
    ['a non-finite level', available({ readings: [{ ...us10y, actual: Number.NaN }] })],
    ['an absurd level', available({ readings: [{ ...us10y, actual: 1_000 }] })],
    ['an unknown caveat', available({ caveats: ['planned-source-unavailable'] })],
    ['an extra field', available({ extension: true })],
    ['a non-canonical asOf', available({ asOf: '2026-10-14' })],
    ['too many readings', available({ readings: Array.from({ length: 5 }, () => ({ ...us10y })) })],
    ['a prototype that is not Object.prototype', Object.assign(Object.create(null), available())]
  ])('fails closed for %s', (_name, input) => {
    expect(parseMacroRatesSnapshot(input)).toBeUndefined()
  })

  it('rejects an accessor before it is evaluated', () => {
    const value = available()
    Object.defineProperty(value, 'readings', { enumerable: true, get: () => { throw new Error('untrusted') } })
    expect(parseMacroRatesSnapshot(value)).toBeUndefined()
  })
})
