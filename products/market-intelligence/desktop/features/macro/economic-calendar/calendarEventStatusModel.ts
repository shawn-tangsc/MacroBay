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
  /**
   * 生命周期**只读源给的状态**（`releaseStatus`），不按 `source === 'official'` 分支推：
   * 切到标准表之后所有行都走市场那条路径，按来源分支的话「源说已取消」在界面上永远不出现，
   * 而且不报错——这正是「凭空消失」。官方旧事件没有 `releaseStatus` 时退回它的 lifecycle。
   */
  const releaseStatus = (item.event as { releaseStatus?: string }).releaseStatus
  const cancelled = releaseStatus !== undefined ? releaseStatus === 'cancelled'
    : item.source === 'official' && item.event.lifecycleState === 'cancelled'
  if (cancelled) return 'cancelled'
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
    const published = releaseStatus !== undefined ? releaseStatus === 'published'
      : item.event.lifecycleState === 'released'
    if (item.event.scheduledDate <= today && published && actual) return 'data-received'
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
