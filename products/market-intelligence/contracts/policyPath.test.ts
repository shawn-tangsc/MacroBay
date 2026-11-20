import { describe, expect, it } from 'vitest'

import {
  changeInBp, changeInPp, decisionInstant, expectationBp, expectationEventMoves, leadingOutcome, normalizeOutcomes, outcomeFromRangeChange, phaseAt,
  POLICY_PATH_OUTCOME_ORDER, namedOutcomes, repricingMarkers, settlementConclusion, stalenessOf, thinSeries,
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

describe('policy path repricing markers', () => {
  it('marks a daily move of eight points or more as strong repricing', () => {
    expect(repricingMarkers({ change24hPp: 8.4, change6hPp: -9 })).toEqual([
      { kind: 'repricing', level: 'strong', changeInPp: 8.4 }
    ])
    expect(repricingMarkers({ change24hPp: -8 })).toEqual([{ kind: 'repricing', level: 'strong', changeInPp: -8 }])
  })

  it('marks a five-to-eight point daily move as ordinary repricing', () => {
    expect(repricingMarkers({ change24hPp: 6.2 })).toEqual([{ kind: 'repricing', level: 'normal', changeInPp: 6.2 }])
    expect(repricingMarkers({ change24hPp: 5 })).toEqual([{ kind: 'repricing', level: 'normal', changeInPp: 5 }])
  })

  it('falls back to the intraday move only when the day stayed under five points', () => {
    expect(repricingMarkers({ change24hPp: 4.9, change6hPp: 3.4 })).toEqual([{ kind: 'intraday', level: 'normal', changeInPp: 3.4 }])
    // A day that did clear five points owns the chip even if the last six hours moved further.
    expect(repricingMarkers({ change24hPp: 5.2, change6hPp: 9 })).toEqual([{ kind: 'repricing', level: 'normal', changeInPp: 5.2 }])
    expect(repricingMarkers({ change6hPp: 3.4 })).toEqual([{ kind: 'intraday', level: 'normal', changeInPp: 3.4 }])
  })

  it('reports nothing when no window clears its threshold', () => {
    expect(repricingMarkers({})).toEqual([])
    expect(repricingMarkers({ change24hPp: 4.9 })).toEqual([])
    expect(repricingMarkers({ change24hPp: 1, change6hPp: 2.9 })).toEqual([])
  })
})

describe('policy path settlement', () => {
  const range = (lowerPercent: number, upperPercent: number) => ({ lowerPercent, upperPercent })

  it('reads the realised band from the range change, in 25bp steps', () => {
    expect(outcomeFromRangeChange({ previous: range(3.75, 4), current: range(3.75, 4) })).toBe('no-change')
    expect(outcomeFromRangeChange({ previous: range(3.75, 4), current: range(4, 4.25) })).toBe('hike-25')
    expect(outcomeFromRangeChange({ previous: range(3.75, 4), current: range(4.25, 4.5) })).toBe('hike-50-plus')
    expect(outcomeFromRangeChange({ previous: range(3.75, 4), current: range(4.25, 4.75) })).toBe('hike-50-plus')
    expect(outcomeFromRangeChange({ previous: range(4, 4.25), current: range(3.75, 4) })).toBe('cut-25')
    expect(outcomeFromRangeChange({ previous: range(4.25, 4.5), current: range(3.75, 4) })).toBe('cut-50-plus')
  })

  it('orders the bands from the easiest to the tightest', () => {
    expect(POLICY_PATH_OUTCOME_ORDER).toEqual(['cut-50-plus', 'cut-25', 'no-change', 'hike-25', 'hike-50-plus'])
  })

  it('calls a band the market already led with priced', () => {
    expect(settlementConclusion({ actual: 'no-change', pricedOutcome: 'no-change', pricedShare: 0.71 }))
      .toEqual({ kind: 'priced' })
  })

  it('measures the unpriced share and signs it by the band order', () => {
    expect(settlementConclusion({ actual: 'hike-25', pricedOutcome: 'no-change', pricedShare: 0.38 }))
      .toEqual({ kind: 'relative', direction: 'hawkish', surprisePp: 62 })
    expect(settlementConclusion({ actual: 'cut-25', pricedOutcome: 'no-change', pricedShare: 0.29 }))
      .toEqual({ kind: 'relative', direction: 'dovish', surprisePp: 71 })
    expect(settlementConclusion({ actual: 'hike-50-plus', pricedOutcome: 'hike-25', pricedShare: 0.14 }))
      .toEqual({ kind: 'relative', direction: 'hawkish', surprisePp: 86 })
  })
})

describe('share floor', () => {
  it('names only the buckets above five percent', () => {
    const values = { 'no-change': 0.282, 'hike-25': 0.689, 'hike-50-plus': 0.017, 'cut-25': 0.007, 'cut-50-plus': 0.004 }
    expect(namedOutcomes(values)).toEqual(['no-change', 'hike-25'])
  })

  it('treats exactly five percent as not worth naming', () => {
    const values = { 'no-change': 0.05, 'hike-25': 0.9, 'hike-50-plus': 0.02, 'cut-25': 0.02, 'cut-50-plus': 0.01 }
    expect(namedOutcomes(values)).toEqual(['hike-25'])
  })
})

describe('weighted expectation', () => {
  it('is the five buckets weighted by +25/+50/0/−25/−50', () => {
    // 25×0.6 + 50×0.1 + 0×0.2 − 25×0.08 − 50×0.02 = 15 + 5 − 2 − 1 = 17bp
    expect(expectationBp({ 'no-change': 0.2, 'hike-25': 0.6, 'hike-50-plus': 0.1, 'cut-25': 0.08, 'cut-50-plus': 0.02 }))
      .toBeCloseTo(17, 10)
  })

  it('uses the lower bound for the open-ended buckets — a documented understatement, not a midpoint guess', () => {
    expect(expectationBp({ 'no-change': 0, 'hike-25': 0, 'hike-50-plus': 1, 'cut-25': 0, 'cut-50-plus': 0 })).toBe(50)
    expect(expectationBp({ 'no-change': 0, 'hike-25': 0, 'hike-50-plus': 0, 'cut-25': 0, 'cut-50-plus': 1 })).toBe(-50)
  })

  it('counts a bucket under five percent: folding it away for display must not drop it from the sum', () => {
    const withSmallCut = { 'no-change': 0.67, 'hike-25': 0.3, 'hike-50-plus': 0, 'cut-25': 0.03, 'cut-50-plus': 0 }
    const withoutSmallCut = { ...withSmallCut, 'cut-25': 0, 'no-change': 0.7 }
    expect(expectationBp(withoutSmallCut) - expectationBp(withSmallCut)).toBeCloseTo(0.75, 10)
  })

  it('does not normalise again on read: a distribution summing to 1.1 is weighted as it stands', () => {
    // Re-dividing by the sum would yield 17 instead of 18.7 — that is the bug this pins down.
    const overround = { 'no-change': 0.22, 'hike-25': 0.66, 'hike-50-plus': 0.11, 'cut-25': 0.088, 'cut-50-plus': 0.022 }
    expect(expectationBp(overround)).toBeCloseTo(18.7, 10)
  })

  it('reports a bp change at one decimal, and a non-finite input as not-a-number rather than zero', () => {
    expect(changeInBp(26.93, 26.54)).toBe(0.4)
    expect(changeInBp(26.93, 26.93)).toBe(0)
    expect(Number.isNaN(expectationBp({ 'no-change': Number.NaN, 'hike-25': 1, 'hike-50-plus': 0, 'cut-25': 0, 'cut-50-plus': 0 })))
      .toBe(true)
  })
})

describe('event attribution on the curve', () => {
  const at = (minute: number): string => new Date(Date.UTC(2026, 9, 30, 12, minute)).toISOString()
  const cpi = (minute: number, label = 'CPI 年率') => ({
    at: at(minute), label, eventNameKey: 'US.CPI.NSA.YOY', measureKeys: ['US.CPI.NSA.YOY']
  })

  it('marks an event when the curve moved at least half a point, with the move and the dot height', () => {
    // E = 25×hike25 − 0.25：0.60 → 14.75bp，0.70 → 17.25bp，差 2.5bp。
    const series = [observation(at(55), 0.2, 0.6), observation(at(65), 0.2, 0.7)]
    expect(expectationEventMoves(series, [cpi(60)]))
      .toEqual([{ at: at(60), label: 'CPI 年率', changeBp: 2.5, bp: 14.75 }])
  })

  it('ignores a move under half a point — the reader cannot see it', () => {
    const series = [observation(at(55), 0.2, 0.6), observation(at(65), 0.2, 0.61)]
    expect(expectationEventMoves(series, [cpi(60)])).toEqual([])
  })

  it('never marks an indicator that is not on the list, however large the move', () => {
    // EIA 天然气库存在旧源里是 importance: high，但它动的是气价，不是加息预期。
    const series = [observation(at(55), 0.2, 0.4), observation(at(65), 0.2, 0.6)]
    expect(expectationEventMoves(series, [{ at: at(60), label: '上周EIA天然气库存变化', measureKeys: ['US.EIA.NATURAL_GAS.STOCKS'] }]))
      .toEqual([])
  })

  it('never falls back to the name: a row with no identity is not marked', () => {
    const series = [observation(at(55), 0.2, 0.4), observation(at(65), 0.2, 0.6)]
    expect(expectationEventMoves(series, [{ at: at(60), label: 'FOMC 决议' }])).toEqual([])
  })

  it('marks one release once: two measures at the same instant collapse to the higher-priority one', () => {
    const series = [observation(at(55), 0.2, 0.4), observation(at(65), 0.2, 0.6)]
    const marks = expectationEventMoves(series, [
      { at: at(60), label: '核心 CPI', eventNameKey: 'US.CORE_CPI.NSA.YOY', measureKeys: ['US.CORE_CPI.NSA.YOY'] },
      cpi(60)
    ])
    expect(marks).toHaveLength(1)
    expect(marks[0]?.label).toBe('CPI 年率')
    // 两条都进「同窗多条」的话会被整组丢掉——那正是归组要避免的结果。
    expect(marks[0]?.changeBp).toBe(5)
  })

  it('marks a central-bank decision and its minutes, but not the statement or a speech', () => {
    const series = [
      observation(at(50), 0.2, 0.5), observation(at(60), 0.2, 0.7),
      observation(at(160), 0.2, 0.7), observation(at(170), 0.2, 0.9)
    ]
    const marks = expectationEventMoves(series, [
      { at: at(55), label: '议息决议', seriesId: 'usa-policy-rate-decision' },
      { at: at(55), label: '政策声明', seriesId: 'usa-monetary-policy-statement' },
      { at: at(55), label: '点阵图', seriesId: 'usa-monetary-policy-projections' },
      { at: at(165), label: '票委讲话', seriesId: 'usa-central-bank-speech' },
      { at: at(165), label: '会议纪要', seriesId: 'usa-monetary-policy-minutes' }
    ])
    expect(marks.map((mark) => mark.label)).toEqual(['议息决议', '会议纪要'])
  })

  it('marks a release whose measure list covers a required key, even when its primary measure does not', () => {
    // 写入端一行只存得下主 measure（这里是核心 CPI 月率）；资格要看这次发布覆盖的全部 measure。
    const series = [observation(at(55), 0.2, 0.4), observation(at(65), 0.2, 0.6)]
    const marks = expectationEventMoves(series, [{
      at: at(60),
      label: 'Consumer prices',
      eventNameKey: 'US.CORE_CPI.SA.MOM',
      measureKeys: ['US.CORE_CPI.SA.MOM', 'US.CPI.NSA.YOY']
    }])
    expect(marks).toHaveLength(1)
  })

  it('never marks a release whose measure list holds none of the required keys, whatever the move', () => {
    const series = [observation(at(55), 0.2, 0.4), observation(at(65), 0.2, 0.6)]
    expect(expectationEventMoves(series, [{
      at: at(60),
      label: 'Consumer prices',
      eventNameKey: 'US.CORE_CPI.SA.MOM',
      measureKeys: ['US.CORE_CPI.SA.MOM']
    }])).toEqual([])
  })

  it('attributes neither event when two windows overlap', () => {
    const series = [observation(at(50), 0.2, 0.5), observation(at(60), 0.2, 0.7), observation(at(75), 0.2, 0.9)]
    expect(expectationEventMoves(series, [cpi(55), cpi(65)])).toEqual([])
  })

  it('keeps two events whose windows do not overlap', () => {
    const series = [
      observation(at(50), 0.2, 0.5), observation(at(60), 0.2, 0.7),
      observation(at(100), 0.2, 0.7), observation(at(110), 0.2, 0.9)
    ]
    expect(expectationEventMoves(series, [cpi(55), cpi(105)]).map((mark) => mark.label)).toEqual(['CPI 年率', 'CPI 年率'])
  })

  it('keeps at most five marks, the largest moves first, then back in time order', () => {
    const series: PolicyPathObservation[] = []
    const events: Array<{ at: string; label: string; measureKeys: string[] }> = []
    for (let index = 0; index < 6; index += 1) {
      const base = index * 60
      series.push(observation(at(base + 50), 0.2, 0.5))
      // 每一步 hike 0.02 → 0.5bp 起，第 6 个是 1.5bp。
      series.push(observation(at(base + 70), 0.2, 0.5 + (index + 1) * 0.02))
      events.push({ at: at(base + 60), label: `e${index}`, measureKeys: ['US.NONFARM.SA.CHANGE'] })
    }
    expect(expectationEventMoves(series, events).map((mark) => mark.label)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
  })

  it('does not mark when one side of the window has no observation', () => {
    // 事件前 10 分钟有一条，事件后 20 分钟才有下一条——超出 ±15 分钟，不标。
    const series = [observation(at(50), 0.2, 0.5), observation(at(80), 0.2, 0.9)]
    expect(expectationEventMoves(series, [cpi(60)])).toEqual([])
  })

  /**
   * 概念化（M4）的行为判据：库里还留着未季调的核心 PCE 行，事件只带那个旧码时**照样要标**。
   * 按码建表时，换码就等于丢掉这批旧事件——那正是这一笔要消灭的。
   */
  it('matches a retired variant of the same concept, so old rows are still annotated', () => {
    const series = [observation(at(55), 0.2, 0.6), observation(at(65), 0.2, 0.7)]
    const retired = { at: at(60), label: '核心 PCE', measureKeys: ['US.CORE_PCE.NSA.YOY'] }
    expect(expectationEventMoves(series, [retired]).map((mark) => mark.label)).toEqual(['核心 PCE'])
  })
})
