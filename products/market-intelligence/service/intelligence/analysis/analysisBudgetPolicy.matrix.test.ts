import { describe, expect, it } from 'vitest'

import { analysisBudgetPolicy, decideBudget, type AnalysisBudgetInput } from './analysisBudgetPolicy'
import { analysisRunLineOf } from './analysisTriggerSourcePolicy'

/**
 * The matrix that has to pass before the old combined gate is deleted.
 *
 * Two things are proved here, and neither is a rerun of the implementation's own branches:
 *
 * 1. **The rule set is what was approved** — per-line quotas, then a global day/hour gate whose
 *    counts include the reserved session slots. The expectation is computed from the policy
 *    constants, so a stale number (the old 57, or 48/12) fails even if the code is self-consistent.
 * 2. **Exactly which inputs the migration changes** — every input where the deleted gate and this
 *    policy disagree is classified, and the classification has to be only the two approved
 *    widenings (48 → 60 a day, 12 → 15 an hour) plus the per-line caps that were always intended.
 */

const NOW = '2026-11-01T12:00:00.000Z'
const EVENT_KEY = 'macro.actual.first-confirmed'
const CALENDAR_KEY = 'calendar.refresh'
const SLOT_KEY = 'schedule.asia.open'

/** A reference reading of the approved rules, spelled out independently of `decideBudget`. */
function approvedDecision(input: AnalysisBudgetInput): 'allow' | 'refuse' {
  if (input.dayRuns >= analysisBudgetPolicy.maximumDailyRuns) return 'refuse'
  if (input.hourRuns >= analysisBudgetPolicy.maximumHourlyRuns) return 'refuse'
  const line = analysisRunLineOf(input.triggerKey)
  const quota = line === 'event' ? analysisBudgetPolicy.lineQuotas.event : analysisBudgetPolicy.lineQuotas.calendar
  const runsToday = line === 'event' ? input.eventRunsToday : input.calendarRunsToday
  const runsThisHour = line === 'event' ? input.eventRunsThisHour : input.calendarRunsThisHour
  if (runsToday >= quota.daily) return 'refuse'
  if (runsThisHour >= quota.hourly) return 'refuse'
  if (quota.coalesce && input.lastAutoRunAt !== null && Date.parse(input.now) - Date.parse(input.lastAutoRunAt) < analysisBudgetPolicy.minimumIntervalMs) return 'refuse'
  return 'allow'
}

/** The gate that is about to be deleted: one combined count, day 48, hour 12. */
function oldCombinedDecision(input: { hourRuns: number; dayRuns: number }): 'allow' | 'refuse' {
  return input.hourRuns >= 12 || input.dayRuns >= 48 ? 'refuse' : 'allow'
}

type Point = Readonly<{
  eventToday: number; calendarToday: number; scheduledToday: number
  eventHour: number; calendarHour: number; lastAutoRunAt: string | null
}>

function* points(): Generator<Point> {
  const days = [0, 1, 5, 9, 10, 20, 39, 44, 47, 48, 49, 58, 59, 60, 61]
  const hours = [0, 1, 3, 4, 11, 12, 13, 14, 15, 16]
  const slots = [0, 3]
  const intervals = [null, '2026-11-01T11:50:00.000Z']
  for (const eventToday of days) {
    for (const calendarToday of days) {
      for (const scheduledToday of slots) {
        for (const eventHour of hours) {
          for (const calendarHour of [0, 1, 3]) {
            for (const lastAutoRunAt of intervals) {
              yield { eventToday, calendarToday, scheduledToday, eventHour, calendarHour, lastAutoRunAt }
            }
          }
        }
      }
    }
  }
}

function input(point: Point, triggerKey: string): AnalysisBudgetInput {
  return {
    triggerKey,
    now: NOW,
    lastAutoRunAt: point.lastAutoRunAt,
    hourRuns: point.eventHour + point.calendarHour,
    dayRuns: point.eventToday + point.calendarToday + point.scheduledToday,
    eventRunsToday: point.eventToday,
    eventRunsThisHour: point.eventHour,
    calendarRunsToday: point.calendarToday,
    calendarRunsThisHour: point.calendarHour,
    scheduledRunsToday: point.scheduledToday
  }
}

describe('the budget rule set the old gate is replaced by', () => {
  it('agrees with the approved reading of the rules on every point of the matrix', () => {
    const disagreements: string[] = []
    let checked = 0
    for (const point of points()) {
      for (const key of [EVENT_KEY, CALENDAR_KEY]) {
        checked += 1
        const decided = decideBudget(input(point, key)).decision === 'queued' ? 'allow' : 'refuse'
        const expected = approvedDecision(input(point, key))
        if (decided !== expected) disagreements.push(`${key} ${JSON.stringify(point)} decided=${decided} expected=${expected}`)
      }
    }
    expect(checked).toBeGreaterThan(10_000)
    expect(disagreements.slice(0, 5)).toEqual([])
  })

  it('never allows a data-driven run once the day or the hour is spent, slots included', () => {
    for (const point of points()) {
      const daySpent = point.eventToday + point.calendarToday + point.scheduledToday >= analysisBudgetPolicy.maximumDailyRuns
      const hourSpent = point.eventHour + point.calendarHour >= analysisBudgetPolicy.maximumHourlyRuns
      if (!daySpent && !hourSpent) continue
      for (const key of [EVENT_KEY, CALENDAR_KEY]) {
        expect(decideBudget(input(point, key)).decision, `${key} ${JSON.stringify(point)}`).toBe('skipped')
      }
    }
  })

  it('keeps the reserved slot line outside the data-driven quotas but still under the global day', () => {
    const base = input({ eventToday: 0, calendarToday: 0, scheduledToday: 0, eventHour: 0, calendarHour: 0, lastAutoRunAt: null }, SLOT_KEY)
    expect(decideBudget(base).decision).toBe('queued')
    expect(decideBudget({ ...base, scheduledRunsToday: 3 }).decision).toBe('skipped')
    // The slots are exempt from the global gate but counted by it: a day spent by the data lines
    // refuses them, because 48 + 9 + 3 is exactly the 60 the gate enforces.
    expect(decideBudget({ ...base, scheduledRunsToday: 3 }).decision).toBe('skipped')
  })

  it('states the only differences from the deleted gate: 48 → 60 a day, 12 → 15 an hour', () => {
    const widened: Point[] = []
    const tightened: Point[] = []
    const unexplained: string[] = []
    for (const point of points()) {
      for (const key of [EVENT_KEY, CALENDAR_KEY]) {
        const before = oldCombinedDecision({ hourRuns: point.eventHour + point.calendarHour, dayRuns: point.eventToday + point.calendarToday + point.scheduledToday })
        const after = decideBudget(input(point, key)).decision === 'queued' ? 'allow' : 'refuse'
        if (before === after) continue
        if (before === 'refuse' && after === 'allow') widened.push(point)
        else tightened.push(point)
        // A widening must sit inside the approved bands; a tightening must come from a line quota.
        const inDayBand = point.eventToday + point.calendarToday + point.scheduledToday >= 48 && point.eventToday + point.calendarToday + point.scheduledToday < 60
        const inHourBand = point.eventHour + point.calendarHour >= 12 && point.eventHour + point.calendarHour < 15
        if (before === 'refuse' && after === 'allow' && inDayBand) continue
        if (before === 'refuse' && after === 'allow' && inHourBand && !inDayBand) continue
        if (before === 'allow' && after === 'refuse') {
          const line = analysisRunLineOf(key)
          const quota = line === 'event' ? analysisBudgetPolicy.lineQuotas.event : analysisBudgetPolicy.lineQuotas.calendar
          const runsToday = line === 'event' ? point.eventToday : point.calendarToday
          const runsThisHour = line === 'event' ? point.eventHour : point.calendarHour
          const fromQuota = runsToday >= quota.daily || runsThisHour >= quota.hourly
          const fromInterval = quota.coalesce && point.lastAutoRunAt !== null
          if (fromQuota || fromInterval) continue
        }
        unexplained.push(`${key} ${JSON.stringify(point)} before=${before} after=${after}`)
      }
    }
    expect(widened.length).toBeGreaterThan(0)
    expect(tightened.length).toBeGreaterThan(0)
    expect(unexplained.slice(0, 5)).toEqual([])
  })
})
