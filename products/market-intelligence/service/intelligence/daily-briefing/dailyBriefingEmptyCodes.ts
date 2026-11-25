import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { briefingEventInNextWindow, briefingEventInWindow } from './dailyBriefingCalendarWindow'
import { briefingMacroEmptyReason } from './dailyBriefingMacroEmptyReason'

/**
 * 「这一段为什么是空的」四个理由码。
 *
 * 一条铁律：**只有对空窗口做过新鲜读数，才可以说「没有」**。关掉了、读不到、没采过、读数陈旧、
 * 上次采集失败、补跑超时、补跑结果未知，或者根本没有新鲜度读数——每一种都说「读不到」，并各自
 * 带自己的理由码。把它们合并成「没有」，正是读者 2026-11-05 报的那个缺陷。
 *
 * 基线用 packet 自己的 `asOf`（它就是 `dataAsOf`）：补跑时两者不同，拿期次的名义截止去量，会让
 * 这一段一边显示事件、一边声称读不到。
 */

export function newsEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.news.state === 'source-disabled') return 'news-source-disabled'
  if (packet.news.state === 'unavailable') return 'news-unavailable'
  return 'no-directional-news'
}

export function macroEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.calendar.state === 'source-disabled') return 'calendar-source-disabled'
  const freshness = packet.calendarFreshness
  // No reading at all (an older caller or a fixture): the section must not claim "nothing happened".
  if (!freshness) return 'calendar-unavailable'
  const reason = briefingMacroEmptyReason({
    state: packet.calendar.state === 'unavailable' ? 'unavailable'
      : freshness.state === 'source-disabled' ? 'source-disabled'
        : freshness.state === 'not-wired' || freshness.state === 'unavailable' ? 'unavailable'
          : 'available',
    ...(freshness.lastCollectedAt ? { lastCollectedAt: freshness.lastCollectedAt } : {}),
    ...(freshness.lastAttemptAt ? { lastAttemptAt: freshness.lastAttemptAt } : {}),
    ...(freshness.lastAttemptFailed === undefined ? {} : { lastAttemptFailed: freshness.lastAttemptFailed }),
    dataAsOf: packet.asOf
  })
  // **读数可用且新鲜时，「窗口为空」优先于任何补跑判定**（用户 2026-11-16）：补跑只是走过的一步，
  // 它失败/超时/结果未知，都不该把一次读得到的空窗写成故障。只有读数本身不可信时，才轮到它。
  const emptyWindow = reason === 'past-24h-no-high-impact-release'
  if (!emptyWindow) {
    // A catch-up that ran out of time is its own sentence: it did not fail, it did not finish.
    if (freshness.catchUp?.state === 'timeout') return 'calendar-catch-up-timeout'
    // A catch-up we triggered but never learned the outcome of (the command answered with a shape the
    // contract does not name) gets its own sentence: nothing failed, we simply do not know yet.
    if (freshness.catchUp?.state === 'unknown') return 'calendar-catch-up-unknown'
    // 补跑失败是「我们这次去补没成功」，不是「源的采集历史失败」：两者一句话说清会误导读者。
    if (freshness.catchUp?.state === 'failed') return 'calendar-catch-up-failed'
  }
  // 「一条发布都没有」与「有发布但都被重要性筛掉」是两句话（产品 2026-11-16）：窗口总数是 0 时
  // 说「没有高影响」等于暗示「有低影响被筛掉了」，那是把「没有」说成「筛没了」。
  if (emptyWindow && !calendarWindowHasAnyEvent(packet)) return 'past-24h-no-release'
  // 注意：这一档的「没有」现在**只在窗口里真的一条高影响事件都没有**时才成立——因为候选不再按
  // 「有没有实际值」过滤（`A0.12`），有事件但没值的事件会进列表，空态根本不会走到这里。
  // 反过来也要说清（`02` v2.125 ①）：**已取消的事件仍然算「有事件」**——它照常显示、带取消标记、
  // 值那一格不渲染；"取消了"不等于"发生过却没有数据"，更不等于"没有发生"。
  return reason
}

/** 窗口里（按日界与时刻，与列表同一套判断）到一条事件都没有了吗。 */
function calendarWindowHasAnyEvent(packet: DailyBriefingFactPacket): boolean {
  if (packet.calendar.state !== 'available') return false
  const window = { start: packet.windowStart, end: packet.windowEnd, timeZone: packet.timeZone }
  return packet.calendar.events.some((event) => briefingEventInWindow(event, window))
}

/** 日历落后本期数据截止多少小时，给「读数陈旧」那一句用。 */
export function macroEmptyHours(packet: DailyBriefingFactPacket): number | undefined {
  const last = packet.calendarFreshness?.lastCollectedAt
  if (!last) return undefined
  const hours = (Date.parse(packet.asOf) - Date.parse(last)) / 3_600_000
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours) : undefined
}

export function nextEmptyCode(packet: DailyBriefingFactPacket): string {
  if (packet.calendar.state === 'source-disabled') return 'calendar-source-disabled'
  if (packet.calendar.state === 'unavailable') return 'calendar-unavailable'
  // 「这一周有事件」与「这一周一条已分级的都没有」是两件事，读出来的空态也必须两句（R44 §6.2）：
  // - 周里一条事件都没有 → 仍是「未来 7 天没有高影响事件」（零事件不是「没分级」）；
  // - 周里有事件、但**一条已分级的都没有** → 是「我们还没分级」，不能说成「没有高影响」——后者
  //   是替来源下断言，而事实是我们还没判。
  // 未分级＝`importance` 缺省（R44：列可空三值、`NULL` 即未分级，不引入第四档）。
  const upcoming = packet.calendar.events
    .filter((event) => event.lifecycleState !== 'cancelled')
    .filter((event) => briefingEventInNextWindow(event, { end: packet.windowEnd, timeZone: packet.timeZone }))
  if (upcoming.length > 0 && upcoming.every((event) => event.importance === undefined)) return 'next-7d-importance-unknown'
  return 'next-7d-no-high-impact-event'
}

