import { describe, expect, it } from 'vitest'

import {
  changeInPp, decisionInstant, leadingOutcome, normalizeOutcomes, phaseAt, stalenessOf, thinSeries,
  valueAtOrBefore, verdictOf, type PolicyPathObservation
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

/** A December meeting is on standard time, so 14:00 in New York is 19:00Z. */
const WINTER_DECISION = '2026-12-09T19:00:00.000Z'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const at = (offsetMs: number): string => new Date(Date.parse(WINTER_DECISION) + offsetMs).toISOString()

describe('policy path decision instant', () => {
  it('reads 14:00 New York from the zone, not a fixed UTC hour', () => {
    // The same 14:00 is 18:00Z under daylight time and 19:00Z under standard time.
    expect(decisionInstant('2026-06-17')).toBe('2026-06-17T18:00:00.000Z')
    expect(decisionInstant('2026-12-09')).toBe(WINTER_DECISION)
    // The November meeting sits on the far side of the change and must follow it.
    expect(decisionInstant('2026-11-04')).toBe('2026-11-04T19:00:00.000Z')
  })

  it('rejects anything that is not a meeting date', () => {
    expect(decisionInstant('2026-13-01')).toBeUndefined()
    expect(decisionInstant('12-09')).toBeUndefined()
    expect(decisionInstant('')).toBeUndefined()
  })
})

describe('policy path phase boundaries', () => {
  it('stays normal until exactly T0-14d, boundary included in pre-meeting', () => {
    expect(phaseAt(WINTER_DECISION, at(-14 * DAY - 1))).toEqual({ kind: 'normal' })
    expect(phaseAt(WINTER_DECISION, at(-14 * DAY))).toEqual({ kind: 'pre-meeting', daysLeft: 14 })
    expect(phaseAt(WINTER_DECISION, at(-6 * DAY - 4 * HOUR))).toEqual({ kind: 'pre-meeting', daysLeft: 7 })
    expect(phaseAt(WINTER_DECISION, at(-1))).toEqual({ kind: 'pre-meeting', daysLeft: 1 })
  })

  it('opens the settlement strip at exactly T0 and keeps it for 24 hours', () => {
    expect(phaseAt(WINTER_DECISION, WINTER_DECISION)).toEqual({ kind: 'settlement', minutesSinceDecision: 0 })
    expect(phaseAt(WINTER_DECISION, at(42 * MINUTE))).toEqual({ kind: 'settlement', minutesSinceDecision: 42 })
    expect(phaseAt(WINTER_DECISION, at(24 * HOUR - 1))).toEqual({ kind: 'settlement', minutesSinceDecision: 1439 })
  })

  it('turns into a verdict at exactly T0+24h and back to normal at exactly T0+3d', () => {
    expect(phaseAt(WINTER_DECISION, at(24 * HOUR))).toEqual({ kind: 'verdict', daysSinceDecision: 1 })
    expect(phaseAt(WINTER_DECISION, at(3 * DAY - 1))).toEqual({ kind: 'verdict', daysSinceDecision: 2 })
    expect(phaseAt(WINTER_DECISION, at(3 * DAY))).toEqual({ kind: 'normal' })
  })

  it('degrades to normal when either instant is unreadable', () => {
    expect(phaseAt('not-a-date', WINTER_DECISION)).toEqual({ kind: 'normal' })
    expect(phaseAt(WINTER_DECISION, 'not-a-date')).toEqual({ kind: 'normal' })
  })
})
