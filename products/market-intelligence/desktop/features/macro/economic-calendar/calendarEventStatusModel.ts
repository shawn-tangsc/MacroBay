import type { MarketCalendarRefreshAttempt } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { calendarDisplayDate, type CalendarDayItem } from './economicCalendarDayModel'

export const CalendarEventStatusPolicy = Object.freeze({
  states: ['data-received', 'upcoming', 'awaiting-data', 'storage-limited', 'time-pending', 'elapsed-unconfirmed', 'cancelled'] as const
})
export type CalendarEventStatus = typeof CalendarEventStatusPolicy.states[number]
/**
 * Release status of one calendar cell.
 *
 * `attempt` is the newest refresh attempt for that item's source, when the caller has it.
 * It exists so an overdue row with no value is not silently indistinguishable from one the
 * source has not published yet: a refusal by the shared calendar ceiling is a *storage*
 * limit, not a missing release.
 */
export function calendarEventStatus(item: CalendarDayItem, now: string, timeZone: string,
  attempt?: MarketCalendarRefreshAttempt): CalendarEventStatus {
  if (item.source === 'official' && item.event.lifecycleState === 'cancelled') return 'cancelled'
  const numeric = item.source === 'official' || item.event.eventType === 'economic-indicator'
  const actual = item.source === 'official' ? item.event.actual : item.event.providerActual
  if (item.event.scheduledAt) {
    if (item.event.scheduledAt > now) return 'upcoming'
    if (!numeric) return 'elapsed-unconfirmed'
    return actual ? 'data-received' : storageLimited(item, attempt) ? 'storage-limited' : 'awaiting-data'
  }
  if (item.source === 'official') {
    const today = calendarDisplayDate(now, timeZone)
    if (item.event.scheduledDate > today) return actual ? 'upcoming' : 'time-pending'
    if (item.event.scheduledDate <= today && item.event.lifecycleState === 'released' && actual) return 'data-received'
    if (item.event.scheduledDate < today) return 'awaiting-data'
  }
  return 'time-pending'
}
/**
 * True only when the shown observation cannot cover the release *and* the newest attempt was
 * refused by the shared calendar ceiling.
 *
 * `sourceObservedAt` is the receipt time of the batch this row was read from; a batch taken
 * after the scheduled time already answers the question, so an empty value there is the
 * source's own answer and belongs to "not published yet". The official route never carries a
 * market attempt, so it can never reach this claim.
 */
function storageLimited(item: CalendarDayItem, attempt: MarketCalendarRefreshAttempt | undefined): boolean {
  return item.source === 'market' && attempt?.state === 'failed' && attempt.failureCode === 'storage-pressure' &&
    item.event.sourceObservedAt < item.event.scheduledAt!
}
