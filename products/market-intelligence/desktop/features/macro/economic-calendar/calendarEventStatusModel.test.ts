import { expect, it } from 'vitest'
import type { CalendarDayItem } from './economicCalendarDayModel'

const now = '2026-09-11T04:00:00.000Z'
const market = (overrides = {}) => ({ source: 'market', event: { eventType: 'economic-indicator', scheduledAt: now,
  providerActual: null, consensus: { displayValue: '3' }, providerPrevious: { displayValue: '2' }, ...overrides } }) as CalendarDayItem
const official = (overrides = {}) => ({ source: 'official', event: { scheduledDate: '2026-09-11', lifecycleState: 'scheduled', ...overrides } }) as CalendarDayItem
it('projects actual, future, missing-value and cancelled states without inferring numeric values', async () => {
  const { calendarEventStatus } = await import('./calendarEventStatusModel')
  for (const displayValue of ['0', '-2', '1–3']) expect(calendarEventStatus(market({ providerActual: { displayValue } }), now)).toBe('data-received')
  expect(calendarEventStatus(market(), now)).toBe('awaiting-data')
  expect(calendarEventStatus(market({ scheduledAt: '2026-09-11T05:00:00.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(calendarEventStatus(official({ lifecycleState: 'cancelled' }), now)).toBe('cancelled')
})
it('respects date-only evidence and does not treat elapsed speeches as missing economic data', async () => {
  const { calendarEventStatus } = await import('./calendarEventStatusModel')
  expect(calendarEventStatus(official({ lifecycleState: 'released', actual: { displayValue: '0' } }), now)).toBe('data-received')
  expect(calendarEventStatus(official(), now)).toBe('time-pending')
  expect(calendarEventStatus(official({ scheduledDate: '2026-09-10' }), now)).toBe('awaiting-data')
  expect(calendarEventStatus(official({ scheduledDate: '2026-09-12', lifecycleState: 'released', actual: { displayValue: '2' } }), now)).toBe('upcoming')
  expect(calendarEventStatus(market({ eventType: 'central-bank-activity' }), now)).toBe('elapsed-unconfirmed')
})

it('keeps status precedence stable across time, value, and event kind', async () => {
  const { calendarEventStatus } = await import('./calendarEventStatusModel')
  expect(calendarEventStatus(market({ scheduledAt: '2026-09-11T03:59:59.000Z', providerActual: null }), now)).toBe('awaiting-data')
  expect(calendarEventStatus(market({ scheduledAt: '2026-09-11T04:00:01.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(calendarEventStatus(market({ scheduledAt: '2026-09-10T04:00:00.000Z', eventType: 'financial-event', providerActual: { displayValue: '1' } }), now)).toBe('elapsed-unconfirmed')
  expect(calendarEventStatus(official({ scheduledDate: '2026-09-10', lifecycleState: 'released', actual: undefined, previous: { displayValue: '2' } }), now)).toBe('awaiting-data')
  expect(calendarEventStatus(official({ scheduledDate: '2026-09-12', lifecycleState: 'scheduled', actual: { displayValue: '0' } }), now)).toBe('upcoming')
})

it('separates "the source has not published yet" from "our collection was refused by the storage ceiling"', async () => {
  const { calendarEventStatus } = await import('./calendarEventStatusModel')
  const pressure = { state: 'failed' as const, attemptedAt: '2026-09-11T03:30:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const }
  // The newest stored batch predates the release and the newest attempt was refused on
  // capacity: nothing here proves the value, so the cell must not look empty.
  const beforeRelease = market({ sourceObservedAt: '2026-09-11T03:00:00.000Z' })
  expect(calendarEventStatus(beforeRelease, now, 'UTC', pressure)).toBe('storage-limited')
  // Observed after the release and still empty: the source itself published nothing yet.
  const afterRelease = market({ sourceObservedAt: '2026-09-11T04:30:00.000Z' })
  expect(calendarEventStatus(afterRelease, now, 'UTC', pressure)).toBe('awaiting-data')
  // Only the capacity verdict may be reported as a storage limit.
  for (const failureCode of ['storage-unavailable', 'response-unavailable', 'parse-unavailable', 'archive-unavailable'] as const) {
    expect(calendarEventStatus(beforeRelease, now, 'UTC', { ...pressure, failureCode })).toBe('awaiting-data')
  }
  expect(calendarEventStatus(beforeRelease, now, 'UTC', { state: 'succeeded', attemptedAt: now, trigger: 'automatic' })).toBe('awaiting-data')
  expect(calendarEventStatus(beforeRelease, now, 'UTC')).toBe('awaiting-data')
  // A value that did arrive is never relabelled by an older refusal.
  expect(calendarEventStatus(market({ sourceObservedAt: '2026-09-11T03:00:00.000Z', providerActual: { displayValue: '3' } }), now, 'UTC', pressure))
    .toBe('data-received')
  // The official route is not subject to the shared market-calendar ceiling.
  expect(calendarEventStatus(official({ scheduledDate: '2026-09-10' }), now, 'UTC', pressure)).toBe('awaiting-data')
})
