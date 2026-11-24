import { addDays, localDate } from './dailyBriefingWindow'

/**
 * 一条日历事件属不属于 `[start, end)` 这个窗口——**只判归属**，不判它该分到哪一栏。
 *
 * 单独立一个文件是为了拆掉一个会成环的 import：这段判断同时被「宏观候选」和「过去 24 小时
 * 选取」两边用，而后者又要在前者所在的文件里被引用。判断只有这一份，两处都从这里拿。
 *
 * 有时刻就按瞬时判；**只公布日期**时按日期判（`scheduledAt` 只是排序位，不能当瞬时）：
 * 只按瞬时判，日期位落在窗口起点之前就会把昨天的事件整条丢掉——「把有事件说成没有事件」
 * 比多列一条更糟。
 */
/**
 * 一条日历事件属不属于「未来 7 天」那一栏——只判归属，**不判重要性**。
 *
 * 分成两个问题：这一栏的候选是哪些（`dailyBriefingDocument.selectNextCandidates`，还要按档筛），
 * 以及这一周里到底有没有事件（空态理由用它，`dailyBriefingEmptyCodes.nextEmptyCode`）。
 * 两个问题必须同一套窗口，否则会出现「列表空着、理由说这周没事件」与「这周明明有事件」并存的画面。
 *
 * 边界与那一栏一致：只在 `windowEnd` 之后、读者日界的今天到 +7 天之间；只公布日期的事件按日期判。
 */
export function briefingEventInNextWindow(
  event: Readonly<{ scheduledAt: string; releaseTimeNotPublished?: true; releaseDate?: string }>,
  window: Readonly<{ end: string; timeZone: string }>
): boolean {
  const today = localDate(window.end, window.timeZone)
  if (today === undefined) return false
  const horizon = addDays(today, 7)
  if (event.releaseTimeNotPublished) {
    const day = event.releaseDate
    return day !== undefined && day >= today && day <= horizon
  }
  const at = Date.parse(event.scheduledAt)
  const day = localDate(event.scheduledAt, window.timeZone)
  return Number.isFinite(at) && at > Date.parse(window.end) && day !== undefined && day <= horizon
}

export function briefingEventInWindow(
  event: Readonly<{ scheduledAt: string; releaseTimeNotPublished?: true; releaseDate?: string }>,
  window: Readonly<{ start: string; end: string; timeZone: string }>
): boolean {
  if (event.releaseTimeNotPublished) {
    const day = event.releaseDate
    const startDay = localDate(window.start, window.timeZone)
    const endDay = localDate(window.end, window.timeZone)
    return day !== undefined && startDay !== undefined && endDay !== undefined && day >= startDay && day <= endDay
  }
  const at = Date.parse(event.scheduledAt)
  return Number.isFinite(at) && at >= Date.parse(window.start) && at < Date.parse(window.end)
}
