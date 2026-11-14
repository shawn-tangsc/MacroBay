import { localDate } from './dailyBriefingWindow'

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
