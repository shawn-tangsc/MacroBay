import { expect, it } from 'vitest'
import type { CalendarDayItem } from './economicCalendarDayModel'
import { calendarEventStatus } from './calendarEventStatusModel'

const now = '2026-09-11T04:00:00.000Z'
/** 签名要求读者时区（date-only 判定要用它）；这组夹具都写在 UTC，所以统一传 'UTC'。 */
const statusOf = (item: CalendarDayItem, at: string, attempt?: Parameters<typeof calendarEventStatus>[3]) =>
  calendarEventStatus(item, at, 'UTC', attempt)
const market = (overrides = {}) => ({ source: 'market', event: { eventType: 'economic-indicator', scheduledAt: now,
  providerActual: null, consensus: { displayValue: '3' }, providerPrevious: { displayValue: '2' }, ...overrides } }) as CalendarDayItem
const official = (overrides = {}) => ({ source: 'official', event: { scheduledDate: '2026-09-11', lifecycleState: 'scheduled', ...overrides } }) as CalendarDayItem
it('projects actual, future, missing-value and cancelled states without inferring numeric values', async () => {
  for (const displayValue of ['0', '-2', '1–3']) expect(statusOf(market({ providerActual: { displayValue } }), now)).toBe('data-received')
  expect(statusOf(market(), now)).toBe('awaiting-data')
  expect(statusOf(market({ scheduledAt: '2026-09-11T05:00:00.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(statusOf(official({ lifecycleState: 'cancelled' }), now)).toBe('cancelled')
})
it('respects date-only evidence and does not treat elapsed speeches as missing economic data', async () => {
  expect(statusOf(official({ lifecycleState: 'released', actual: { displayValue: '0' } }), now)).toBe('data-received')
  expect(statusOf(official(), now)).toBe('time-pending')
  expect(statusOf(official({ scheduledDate: '2026-09-10' }), now)).toBe('awaiting-data')
  expect(statusOf(official({ scheduledDate: '2026-09-12', lifecycleState: 'released', actual: { displayValue: '2' } }), now)).toBe('upcoming')
  expect(statusOf(market({ eventType: 'central-bank-activity' }), now)).toBe('elapsed-unconfirmed')
})

it('keeps status precedence stable across time, value, and event kind', async () => {
  expect(statusOf(market({ scheduledAt: '2026-09-11T03:59:59.000Z', providerActual: null }), now)).toBe('awaiting-data')
  expect(statusOf(market({ scheduledAt: '2026-09-11T04:00:01.000Z', providerActual: { displayValue: '0' } }), now)).toBe('upcoming')
  expect(statusOf(market({ scheduledAt: '2026-09-10T04:00:00.000Z', eventType: 'financial-event', providerActual: { displayValue: '1' } }), now)).toBe('elapsed-unconfirmed')
  expect(statusOf(official({ scheduledDate: '2026-09-10', lifecycleState: 'released', actual: undefined, previous: { displayValue: '2' } }), now)).toBe('awaiting-data')
  expect(statusOf(official({ scheduledDate: '2026-09-12', lifecycleState: 'scheduled', actual: { displayValue: '0' } }), now)).toBe('upcoming')
})

it('separates "the source has not published yet" from "our collection was refused by the storage ceiling"', async () => {
  const pressure = { state: 'failed' as const, attemptedAt: '2026-09-11T03:30:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const }
  // The newest stored batch predates the release and the newest attempt was refused on
  // capacity: nothing here proves the value, so the cell must not look empty.
  const beforeRelease = market({ sourceObservedAt: '2026-09-11T03:00:00.000Z' })
  expect(statusOf(beforeRelease, now, pressure)).toBe('storage-limited')
  // Observed after the release and still empty: the source itself published nothing yet.
  const afterRelease = market({ sourceObservedAt: '2026-09-11T04:30:00.000Z' })
  expect(statusOf(afterRelease, now, pressure)).toBe('awaiting-data')
  // Only the capacity verdict may be reported as a storage limit.
  for (const failureCode of ['storage-unavailable', 'response-unavailable', 'parse-unavailable', 'archive-unavailable'] as const) {
    expect(statusOf(beforeRelease, now, { ...pressure, failureCode })).toBe('awaiting-data')
  }
  expect(statusOf(beforeRelease, now, { state: 'succeeded', attemptedAt: now, trigger: 'automatic' })).toBe('awaiting-data')
  expect(statusOf(beforeRelease, now)).toBe('awaiting-data')
  // A value that did arrive is never relabelled by an older refusal.
  expect(statusOf(market({ sourceObservedAt: '2026-09-11T03:00:00.000Z', providerActual: { displayValue: '3' } }), now, pressure))
    .toBe('data-received')
  // The official route is not subject to the shared market-calendar ceiling.
  expect(statusOf(official({ scheduledDate: '2026-09-10' }), now, pressure)).toBe('awaiting-data')
})
