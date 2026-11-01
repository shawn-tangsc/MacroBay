import { expect, it } from 'vitest'
import { analysisBudgetPolicy, decideBudget, type AnalysisBudgetInput } from './analysisBudgetPolicy'

const now = '2026-10-09T12:00:00.000Z'
/** Enough headroom that only the rule under test can skip. */
const roomy: Omit<AnalysisBudgetInput, 'triggerKey'> = {
  now, lastAutoRunAt: null, hourRuns: 0, dayRuns: 0,
  eventRunsToday: 0, eventRunsThisHour: 0,
  calendarRunsToday: 0, calendarRunsThisHour: 0,
  scheduledRunsToday: 0
}
const calendar = (overrides: Partial<AnalysisBudgetInput> = {}) => decideBudget({ triggerKey: 'calendar.refresh', ...roomy, ...overrides })
const event = (overrides: Partial<AnalysisBudgetInput> = {}) => decideBudget({ triggerKey: 'macro.actual.first-confirmed', ...roomy, ...overrides })
const slot = (overrides: Partial<AnalysisBudgetInput> = {}) => decideBudget({ triggerKey: 'schedule.asia.open', ...roomy, ...overrides })

it('states every quota in one frozen policy, one line at a time', () => {
  expect(analysisBudgetPolicy.version).toBe('marketAnalysisBudgetPolicy.v3')
  expect(analysisBudgetPolicy.lineQuotas.event).toEqual({ daily: 48, hourly: 12, coalesce: false })
  expect(analysisBudgetPolicy.lineQuotas.calendar).toEqual({ daily: 9, hourly: 3, coalesce: true })
  expect(analysisBudgetPolicy.reservedScheduledRunsPerDay).toBe(3)
  // The global number is the sum of the two lines, not a third budget they compete for.
  expect(analysisBudgetPolicy.maximumDailyRuns)
    .toBe(analysisBudgetPolicy.lineQuotas.event.daily + analysisBudgetPolicy.lineQuotas.calendar.daily)
  expect(analysisBudgetPolicy.dayWindow).toBe('utc-calendar-day')
  expect(Object.isFrozen(analysisBudgetPolicy)).toBe(true)
  expect(Object.isFrozen(analysisBudgetPolicy.lineQuotas.event)).toBe(true)
})

it('gives each line its own daily quota, and lets neither spend the other', () => {
  expect(event({ eventRunsToday: 47 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(event({ eventRunsToday: 48 })).toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  expect(calendar({ calendarRunsToday: 8 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ calendarRunsToday: 9 })).toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  // The old arrangement counted the calendar line against the event line's total: a busy event day
  // ate all nine calendar calls. A full event day must not move the calendar line at all.
  expect(calendar({ eventRunsToday: 48, calendarRunsToday: 8 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(event({ eventRunsToday: 47, calendarRunsToday: 9 })).toEqual({ decision: 'queued', reasonCode: null })
})

it('gives each line its own hourly quota', () => {
  expect(event({ eventRunsThisHour: 11 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(event({ eventRunsThisHour: 12 })).toEqual({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
  expect(calendar({ calendarRunsThisHour: 2 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ calendarRunsThisHour: 3 })).toEqual({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
  // The hourly gate reads the line's own hour, never the total hour (which includes the slots).
  expect(event({ hourRuns: 15, eventRunsThisHour: 4 })).toEqual({ decision: 'queued', reasonCode: null })
})

it('declares the coalescing window per line: calendar obeys it, the item line does not', () => {
  const recent = '2026-10-09T11:45:00.000Z'
  expect(calendar({ lastAutoRunAt: recent })).toEqual({ decision: 'skipped', reasonCode: 'interval-active' })
  // The item path already carries its own 30-minute phase cooldown; a second window here would
  // refuse attempts the old gate allowed, which is not an equivalent migration.
  expect(event({ lastAutoRunAt: recent })).toEqual({ decision: 'queued', reasonCode: null })
})

it('lets a slot through every quota but its own daily reserve', () => {
  expect(slot({ hourRuns: 99, dayRuns: 99, eventRunsToday: 48, calendarRunsToday: 9, lastAutoRunAt: now }))
    .toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ scheduledRunsToday: 2 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ scheduledRunsToday: 3 })).toEqual({ decision: 'skipped', reasonCode: 'schedule-reserve-exhausted' })
})

it('never limits a manual request', () => {
  const exhausted = { hourRuns: 99, dayRuns: 99, eventRunsToday: 99, eventRunsThisHour: 99, calendarRunsToday: 99, calendarRunsThisHour: 99, scheduledRunsToday: 99, lastAutoRunAt: now }
  expect(decideBudget({ triggerKey: 'manual.refresh', ...roomy, ...exhausted })).toEqual({ decision: 'queued', reasonCode: null })
  expect(decideBudget({ triggerKey: 'manual.initial', ...roomy, ...exhausted })).toEqual({ decision: 'queued', reasonCode: null })
})

it('treats an unregistered key as the calendar line, never the generous one', () => {
  // A future source must be registered to get the item line's 48 a day; by default it is strict.
  expect(decideBudget({ triggerKey: 'signal.future.rule', ...roomy, calendarRunsToday: 9 }))
    .toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  expect(decideBudget({ triggerKey: 'signal.future.rule', ...roomy, eventRunsToday: 47 }))
    .toEqual({ decision: 'queued', reasonCode: null })
})

it('fails closed on counts or instants it cannot trust', () => {
  expect(calendar({ hourRuns: -1 })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ dayRuns: 1.5 })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ calendarRunsToday: Number.NaN })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(event({ eventRunsThisHour: Number.NaN })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ now: '2026-10-09T12:00:00Z' })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ lastAutoRunAt: 'not-an-instant' })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
})
