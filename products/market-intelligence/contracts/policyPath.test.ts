import { describe, expect, it } from 'vitest'

import {
  changeInPp, leadingOutcome, normalizeOutcomes, stalenessOf, thinSeries, valueAtOrBefore, verdictOf,
  type PolicyPathObservation
} from './policyPath'

const observation = (at: string, noChange: number, hike25: number): PolicyPathObservation => ({
  at,
  values: { 'no-change': noChange, 'hike-25': hike25, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
})

describe('policy path reading', () => {
  it('normalises away the venue overround instead of reporting 100.65%', () => {
    const values = normalizeOutcomes({ 'no-change': 0.215, 'hike-25': 0.765, 'hike-50-plus': 0.0195, 'cut-25': 0.0045, 'cut-50-plus': 0.0025 })!
    expect(Object.values(values).reduce((total, value) => total + value, 0)).toBeCloseTo(1, 10)
    expect(values['hike-25']).toBeCloseTo(0.760, 3)
  })

  it('rejects a payload that is not a distribution', () => {
    expect(normalizeOutcomes({ 'hike-25': 0.4 })).toBeUndefined()
    expect(normalizeOutcomes({ 'hike-25': Number.NaN, 'no-change': 1 })).toBeUndefined()
    expect(normalizeOutcomes({ 'hike-25': 1.4, 'no-change': -0.4 })).toBeUndefined()
  })

  it('reports percent-point change at one decimal', () => {
    expect(changeInPp(0.765, 0.775)).toBe(-1)
    expect(changeInPp(0.81, 0.786)).toBe(2.4)
    expect(changeInPp(0.765, 0.765)).toBe(0)
  })

  it('reads the leading bucket', () => {
    expect(leadingOutcome({ 'no-change': 0.2, 'hike-25': 0.77, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01 }))
      .toEqual({ outcome: 'hike-25', probability: 0.77 })
  })

  it('grades how much of the outcome was already priced', () => {
    expect(verdictOf(0.76)).toBe('priced')
    expect(verdictOf(0.45)).toBe('partially-priced')
    expect(verdictOf(0.12)).toBe('not-priced')
  })

  it('ages a quote in minutes, not days', () => {
    expect(stalenessOf('2026-10-30T02:00:00.000Z', '2026-10-30T02:10:00.000Z')).toBe('live')
    expect(stalenessOf('2026-10-30T02:00:00.000Z', '2026-10-30T03:30:00.000Z')).toBe('delayed')
    expect(stalenessOf('2026-10-30T02:00:00.000Z', '2026-11-02T02:00:00.000Z')).toBe('stale')
    expect(stalenessOf('2026-10-30T02:00:00.000Z', '2026-11-30T02:00:00.000Z')).toBe('unavailable')
    expect(stalenessOf('not-a-date', '2026-10-30T02:00:00.000Z')).toBe('unavailable')
  })

  it('thins the series but keeps the newest point', () => {
    const series = Array.from({ length: 100 }, (_unused, index) => observation(`2026-10-${String(1 + (index % 28)).padStart(2, '0')}T00:${String(index % 60).padStart(2, '0')}:00.000Z`, 0.2, 0.77))
    const thinned = thinSeries(series, 12)
    expect(thinned.length).toBeLessThanOrEqual(12)
    expect(thinned.at(-1)?.at).toBe(series.at(-1)?.at)
  })

  it('finds the value in force before a window', () => {
    const series = [
      observation('2026-10-29T00:00:00.000Z', 0.24, 0.76),
      observation('2026-10-30T00:00:00.000Z', 0.2, 0.8)
    ]
    expect(valueAtOrBefore(series, 'hike-25', 24 * 60)).toBe(0.76)
    expect(valueAtOrBefore(series, 'hike-25', 0)).toBe(0.8)
    expect(valueAtOrBefore([], 'hike-25', 60)).toBeUndefined()
  })
})
