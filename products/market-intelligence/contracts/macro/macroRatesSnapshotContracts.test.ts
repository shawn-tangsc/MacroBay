import { describe, expect, it } from 'vitest'

import {
  macroRatesSnapshotPublicPolicy,
  parseMacroRatesSnapshot,
  type MacroRatesSnapshotView
} from './macroRatesSnapshotContracts'

const asOf = '2026-10-14T12:00:00.000Z'

const window = (pairs: readonly (readonly [string, number])[]) => pairs.map(([period, value]) => ({ period, value }))

/** The real reading pair the panel's 美债 10Y row shows: 5.24 on 10-09 after 5.22 on 10-08. */
const us10y = {
  seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09',
  window: window([['2026-10-08', 5.22], ['2026-10-09', 5.24]])
}
const realRate = {
  seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 2.91, previous: 2.87, period: '2026-10-09',
  window: window([['2026-10-08', 2.87], ['2026-10-09', 2.91]])
}
/** The 10Y−2Y difference over the same two trading days. */
const termSpread = {
  key: 'us10y-minus-us2y', actual: 0.44, previous: 0.5, period: '2026-10-09',
  window: window([['2026-10-08', 0.5], ['2026-10-09', 0.44]])
}

function available(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'available', asOf, readings: [us10y, realRate], spreads: [termSpread],
    caveats: ['official-daily-close'], ...overrides
  }
}

function published(view: MacroRatesSnapshotView | undefined) {
  if (view === undefined) throw new Error('expected a parsed snapshot')
  if (view.state === 'unavailable') throw new Error('expected readings')
  return view
}

describe('macro rates snapshot contract', () => {
  it('admits the whole curve and the two spreads', () => {
    expect(macroRatesSnapshotPublicPolicy.method).toBe('intelligence.macro.ratesSnapshot.query')
    // 名义曲线（1M → 30Y）→ 实际利率（5Y → 30Y）→ 通胀预期（5Y / 10Y / 5Y5Y）。
    expect(macroRatesSnapshotPublicPolicy.seriesIds).toEqual([
      'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
      'DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30', 'T5YIE', 'T10YIE', 'T5YIFR'
    ])
    expect(macroRatesSnapshotPublicPolicy.spreads.map((spread) => spread.key))
      .toEqual(['us10y-minus-us2y', 'us10y-minus-us3m'])
    expect(macroRatesSnapshotPublicPolicy.series).toMatchObject({
      us1m: 'DGS1MO', us1y: 'DGS1', us20y: 'DGS20', real5y: 'DFII5', real30y: 'DFII30',
      breakeven5y: 'T5YIE', forward5y5y: 'T5YIFR'
    })
    expect(macroRatesSnapshotPublicPolicy.maximumReadings).toBe(19)
    expect(macroRatesSnapshotPublicPolicy.maximumSpreads).toBe(2)
    expect(macroRatesSnapshotPublicPolicy.windowPoints).toBeGreaterThan(200)
    expect(macroRatesSnapshotPublicPolicy.caveatIds).toEqual(['official-daily-close'])
  })

  it('freezes an admitted reading with its window and without inventing a previous value', () => {
    const parsed = published(parseMacroRatesSnapshot(available({
      spreads: [],
      readings: [{
        seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.33, period: '2026-10-13',
        window: window([['2026-10-13', 2.33]])
      }]
    })))

    expect(parsed.readings).toEqual([{
      seriesId: 'T10YIE', metricKey: 'US_10Y_BREAKEVEN_INFLATION', actual: 2.33, period: '2026-10-13',
      window: [{ period: '2026-10-13', value: 2.33 }]
    }])
    expect(parsed.spreads).toEqual([])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.readings)).toBe(true)
    expect(Object.isFrozen(parsed.readings[0])).toBe(true)
    expect(Object.isFrozen(parsed.readings[0]?.window)).toBe(true)
    expect(parsed.readings[0]).not.toHaveProperty('previous')
  })

  it('carries the spread as its own series of differences, with the day it belongs to', () => {
    const parsed = published(parseMacroRatesSnapshot(available()))

    expect(parsed.spreads).toEqual([{
      key: 'us10y-minus-us2y', actual: 0.44, previous: 0.5, period: '2026-10-09',
      window: [{ period: '2026-10-08', value: 0.5 }, { period: '2026-10-09', value: 0.44 }]
    }])
    expect(Object.isFrozen(parsed.spreads[0])).toBe(true)
  })

  it('admits an empty answer only when it carries no reading and no spread', () => {
    expect(parseMacroRatesSnapshot({ state: 'empty', asOf, readings: [], spreads: [], caveats: ['official-daily-close'] }))
      .toEqual({ state: 'empty', asOf, readings: [], spreads: [], caveats: ['official-daily-close'] })
    expect(parseMacroRatesSnapshot({ state: 'empty', asOf, readings: [us10y], spreads: [], caveats: [] })).toBeUndefined()
    // 没有读数却有价差是矛盾答案：价差是从读数算出来的，不是独立事实。
    expect(parseMacroRatesSnapshot({ state: 'empty', asOf, readings: [], spreads: [termSpread], caveats: [] })).toBeUndefined()
    expect(parseMacroRatesSnapshot({ state: 'available', asOf, readings: [], spreads: [], caveats: [] })).toBeUndefined()
  })

  it('admits the unavailable answer alone', () => {
    expect(parseMacroRatesSnapshot({ state: 'unavailable' })).toEqual({ state: 'unavailable' })
    expect(parseMacroRatesSnapshot({ state: 'unavailable', readings: [] })).toBeUndefined()
  })

  it.each([
    ['a foreign series', available({ readings: [{ ...us10y, seriesId: 'DTWEXBGS' }] })],
    ['a metric key that is not that series', available({ readings: [{ ...us10y, metricKey: 'US_2Y_YIELD' }] })],
    ['a non-canonical observation date', available({ readings: [{ ...us10y, period: '2026/10/09' }] })],
    ['a missing observation date', available({ readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, window: [] }] })],
    ['a non-finite level', available({ readings: [{ ...us10y, actual: Number.NaN }] })],
    ['an absurd level', available({ readings: [{ ...us10y, actual: 1_000 }] })],
    ['an unknown caveat', available({ caveats: ['planned-source-unavailable'] })],
    ['an extra field', available({ extension: true })],
    ['a non-canonical asOf', available({ asOf: '2026-10-14' })],
    ['too many readings', available({ readings: Array.from({ length: macroRatesSnapshotPublicPolicy.maximumReadings + 1 }, () => ({ ...us10y })) })],
    ['a prototype that is not Object.prototype', Object.assign(Object.create(null), available())]
  ])('fails closed for %s', (_name, input) => {
    expect(parseMacroRatesSnapshot(input)).toBeUndefined()
  })

  it.each([
    ['a reading without a window', available({
      readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, period: '2026-10-09' }]
    })],
    ['a window whose last point disagrees with the level', available({
      readings: [{ ...us10y, actual: 5.3, window: window([['2026-10-08', 5.22], ['2026-10-09', 5.24]]) }]
    })],
    ['a window whose last point disagrees with the period', available({
      readings: [{ ...us10y, period: '2026-10-10', window: window([['2026-10-08', 5.22], ['2026-10-09', 5.24]]) }]
    })],
    ['a window point with a non-canonical date', available({
      readings: [{ ...us10y, window: window([['2026-10-08', 5.22], ['2026/10/09', 5.24]]) }]
    })],
    ['a window point with an absurd level', available({
      readings: [{ ...us10y, window: window([['2026-10-08', 900], ['2026-10-09', 5.24]]) }]
    })],
    ['a window that is not in date order', available({
      readings: [{ ...us10y, window: window([['2026-10-09', 5.22], ['2026-10-08', 5.24]]) }]
    })],
    ['a window longer than the cap', available({
      readings: [{
        ...us10y,
        window: Array.from({ length: macroRatesSnapshotPublicPolicy.windowPoints + 1 }, (_, index) => ({
          period: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10), value: 5
        }))
      }]
    })],
    ['an unknown spread', available({ spreads: [{ ...termSpread, key: 'us30y-minus-us3m' }] })],
    ['a spread without a window', available({ spreads: [{ key: 'us10y-minus-us2y', actual: 0.44, period: '2026-10-09' }] })],
    ['a spread whose window disagrees with its level', available({ spreads: [{ ...termSpread, actual: 0.4 }] })],
    ['too many spreads', available({ spreads: [termSpread, termSpread, termSpread] })]
  ])('fails closed for %s', (_name, input) => {
    expect(parseMacroRatesSnapshot(input)).toBeUndefined()
  })

  it('rejects an accessor before it is evaluated', () => {
    const value = available()
    Object.defineProperty(value, 'readings', { enumerable: true, get: () => { throw new Error('untrusted') } })
    expect(parseMacroRatesSnapshot(value)).toBeUndefined()
  })
})
