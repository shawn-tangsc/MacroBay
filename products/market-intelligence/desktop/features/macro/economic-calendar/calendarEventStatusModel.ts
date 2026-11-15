import type { MarketCalendarRefreshAttempt } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarPublicPolicy } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { calendarDisplayDate, type CalendarDayItem } from './economicCalendarDayModel'

/**
 * 渲染侧的状态词表。**它不是发布状态的第二份定义**：
 * - 输入侧的 `releaseStatus` 直接取契约的联合（`marketCalendarPublicPolicy.releaseStatuses`），这里不抄；
 * - 这里多出来的 `data-received / upcoming / awaiting-data / storage-limited / time-pending /
 *   elapsed-unconfirmed` 是**界面自己的判定结果**（「有没有值」「是不是还没到点」「是不是存储受限」），
 *   契约里没有、也不该有；
 * - 与契约同名的那三档（`backfilling` / `missing` / `cancelled`）从契约策略里取，避免两边各写一份。
 *
 * 也就是说：**发布状态只有一个出处（契约），这里只是把它的几档 + 界面判定合成一个词表。**
 */
/** 界面自己判定的那几档（契约里没有，也不该有：它们描述「值/时点/存储」而不是「源给了什么状态」）。 */
const uiStates = ['data-received', 'upcoming', 'awaiting-data', 'storage-limited', 'time-pending', 'elapsed-unconfirmed'] as const

/**
 * 渲染侧状态 = 界面判定档 + **契约里的发布状态**（`backfilling` / `missing` / `cancelled` 等）。
 * 后者不在这里再写一遍：字面量只出现在契约一处，这里用类型组合取过来。
 */
export const CalendarEventStatusPolicy = Object.freeze({ states: uiStates })
/**
 * 契约状态里**本模型真的会返回**的那三档。剩下的 `scheduled` / `published` / `unknown` 是
 * 「源那一侧」的词，界面不直接显示它们（已到点没值 → `awaiting-data`，有值 → `data-received`）。
 * 这样行的文案映射不会因为类型里多出几档而缺键，也不会拿「待发布」去盖住过期行。
 */
type SharedDisplayStatus = Extract<(typeof marketCalendarPublicPolicy.releaseStatuses)[number],
  'backfilling' | 'missing' | 'cancelled'>

export type CalendarEventStatus = typeof uiStates[number] | SharedDisplayStatus
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
  /**
   * 发布后的两种新状态（日历线 2026-11-16 的五态口径）：
   * - `backfilling`：已过发布时点、还没值，仍在 24 小时补值窗口内 → 界面「待补值」；
   * - `missing`：窗口结束仍没有 → 界面「未提供」。
   * 都是**源给的状态**，不由渲染层按时间推——推出来的值会和补值扫描各说各话。
   */
  if (releaseStatus === 'backfilling') return 'backfilling'
  if (releaseStatus === 'missing') return 'missing'
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
