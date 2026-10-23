import { expect, it } from 'vitest'
import { analysisBudgetPolicy, decideBudget, type AnalysisBudgetInput } from './analysisBudgetPolicy'

const now = '2026-10-09T12:00:00.000Z'
/** Enough headroom that only the rule under test can skip. */
const roomy: Omit<AnalysisBudgetInput, 'triggerKey'> = {
  now, lastAutoRunAt: null, hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0
}
const calendar = (overrides: Partial<AnalysisBudgetInput> = {}) => decideBudget({ triggerKey: 'calendar.refresh', ...roomy, ...overrides })
const slot = (overrides: Partial<AnalysisBudgetInput> = {}) => decideBudget({ triggerKey: 'schedule.asia.open', ...roomy, ...overrides })

it('states every budget number in one frozen policy', () => {
  expect(analysisBudgetPolicy.version).toBe('marketAnalysisBudgetPolicy.v2')
  expect(analysisBudgetPolicy.minimumIntervalMs).toBe(30 * 60 * 1_000)
  expect(analysisBudgetPolicy.maximumHourlyRuns).toBe(3)
  expect(analysisBudgetPolicy.maximumDailyRuns).toBe(12)
  expect(analysisBudgetPolicy.reservedScheduledRunsPerDay).toBe(3)
  expect(analysisBudgetPolicy.dayWindow).toBe('utc-calendar-day')
  // The event allowance is derived from the total and the slots' reserve, not configured twice:
  // the reserve belongs to the opens, so the data-driven line cannot spend it.
  expect(analysisBudgetPolicy.eventRunsPerDayAllowance + analysisBudgetPolicy.reservedScheduledRunsPerDay)
    .toBe(analysisBudgetPolicy.maximumDailyRuns)
  expect(Object.isFrozen(analysisBudgetPolicy)).toBe(true)
})

it('lets a data-driven run through when every limit has room, without inventing a pass code', () => {
  expect(calendar()).toEqual({ decision: 'queued', reasonCode: null })
})

it('enforces the event line allowance and never spends the slots\' reserve on it', () => {
  expect(calendar({ eventRunsToday: 8 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ eventRunsToday: 9 })).toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  // Even with the slots' own quota untouched, the event line cannot borrow it.
  expect(calendar({ eventRunsToday: 9, scheduledRunsToday: 0 })).toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
})

it('enforces the hourly gate for the event and item lines', () => {
  expect(calendar({ hourRuns: 2 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ hourRuns: 3 })).toEqual({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
  expect(decideBudget({ triggerKey: 'macro.actual.first-confirmed', ...roomy, hourRuns: 3 }))
    .toEqual({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
})

it('coalesces repeats inside the minimum interval', () => {
  expect(calendar({ lastAutoRunAt: '2026-10-09T11:59:00.000Z' })).toEqual({ decision: 'skipped', reasonCode: 'interval-active' })
  // One millisecond short of the window is still inside it.
  expect(calendar({ lastAutoRunAt: '2026-10-09T11:30:00.001Z' })).toEqual({ decision: 'skipped', reasonCode: 'interval-active' })
  // Exactly one window later the interval has elapsed.
  expect(calendar({ lastAutoRunAt: '2026-10-09T11:30:00.000Z' })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ lastAutoRunAt: '2026-10-09T11:00:00.000Z' })).toEqual({ decision: 'queued', reasonCode: null })
})

it('lets a slot through the hourly gate and the interval rule but not past its own reserve', () => {
  // Running at an open is the trigger, so neither the hourly gate nor the coalescing interval
  // applies: the only thing that can refuse an open is the line's own daily reserve.
  expect(slot({ hourRuns: 3, lastAutoRunAt: '2026-10-09T11:59:00.000Z' })).toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ scheduledRunsToday: 1 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ scheduledRunsToday: 2 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ scheduledRunsToday: 3 })).toEqual({ decision: 'skipped', reasonCode: 'schedule-reserve-exhausted' })
})

it('applies the daily total to every automatic source except the session slots', () => {
  expect(calendar({ dayRuns: 11 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(calendar({ dayRuns: 12 })).toEqual({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  // The ordering is the guarantee: a busy day of data-driven runs must not spend the three calls
  // the reader asked for at the opens. This is the one line decided before the daily total.
  expect(slot({ dayRuns: 12, eventRunsToday: 12 })).toEqual({ decision: 'queued', reasonCode: null })
  expect(slot({ dayRuns: 12, scheduledRunsToday: 3 })).toEqual({ decision: 'skipped', reasonCode: 'schedule-reserve-exhausted' })
})

it('never limits a manual request', () => {
  const exhausted = { hourRuns: 99, dayRuns: 99, eventRunsToday: 99, scheduledRunsToday: 99, lastAutoRunAt: now }
  expect(decideBudget({ triggerKey: 'manual.refresh', ...roomy, ...exhausted })).toEqual({ decision: 'queued', reasonCode: null })
  expect(decideBudget({ triggerKey: 'manual.initial', ...roomy, ...exhausted })).toEqual({ decision: 'queued', reasonCode: null })
})

it('fails closed on counts or instants it cannot trust', () => {
  expect(calendar({ hourRuns: -1 })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ dayRuns: 1.5 })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ eventRunsToday: Number.NaN })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ now: '2026-10-09' })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
  expect(calendar({ lastAutoRunAt: '2026-10-09T11:00:00Z' })).toEqual({ decision: 'skipped', reasonCode: 'invalid-budget-input' })
})
