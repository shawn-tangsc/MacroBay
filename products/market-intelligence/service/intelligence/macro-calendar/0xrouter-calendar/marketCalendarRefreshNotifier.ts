import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationSubmitContracts'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../../contracts/notificationEventKeys'
import { marketCalendarPublicPolicy } from '../../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 市场日历（0xRouter 那条腿）一次刷新没成功时的通知（2026-11-11 用户：「失败了，要通知」）。
 *
 * 三条口径，写在这里而不是散在调用点：
 * - **自动与手动同一条**：读者要的是「这次没刷新成功」这件事，不区分是谁触发的；
 * - **同一来源同一读者日最多一条**：去重键 `calendar-refresh:{providerId}:{date}:{generation}`——
 *   前两段是「哪条源 · 哪一天」，`{generation}` 是「这个状况的第几次」：连续失败（中间没成功）
 *   落在同一代、被合并不刷屏；**失败 → 成功 → 又失败**是新一代，能再报一次（产品经理 2026-11-11
 *   的语义要求：`condition` 不许做成按自然日死锁，否则读者会以为已经好了）；
 * - **正文只有人话**：变体名 = 失败码，句子在文案表里，所以正文永远不出现内部码；没有码时用
 *   `no-code` 那一版，不编原因。
 */
export type CalendarRefreshFailureCode = typeof marketCalendarPublicPolicy.attemptFailures[number]

/** 没有码（或码不在闭集里）时用的变体：只报「这次没刷成」，不编原因。 */
export const CALENDAR_REFRESH_NO_CODE_VARIANT = 'no-code' as const

/** 来源在正文里的名字（0xRouter 那条腿；供应商名属集成数据，不是内部词汇）。 */
export const MARKET_CALENDAR_REFRESH_SOURCE_LABEL = '0xRouter' as const

/** 变体名就是失败码本身；不认识的一律落 `no-code`，绝不把码写进正文。 */
export function calendarRefreshVariant(failureCode: string | undefined): string {
  if (failureCode === undefined) return CALENDAR_REFRESH_NO_CODE_VARIANT
  return (marketCalendarPublicPolicy.attemptFailures as readonly string[]).includes(failureCode)
    ? failureCode
    : CALENDAR_REFRESH_NO_CODE_VARIANT
}

/**
 * 去重键里那个 `{date}`：**读者眼前的日期**（设置时区），不是 UTC 日。
 * 读者看得到的东西跟他的日历走；记账才用 UTC（2026-11-01 已定口径）。
 */
export function readerCalendarDay(instant: string, timeZone: string): string {
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) return instant.slice(0, 10)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
  } catch {
    return new Date(at).toISOString().slice(0, 10)
  }
}

export type CalendarRefreshFailureNotice = Readonly<{
  providerId: string
  failureCode?: string
  /** 这一次失败发生在哪个读者日（`readerCalendarDay` 的结果）。 */
  date: string
  /** 这个状况的第几代：每次成功刷新后 +1（同一天「失败→成功→失败」因此能报第二条）。 */
  generation: number
}>

/** 提交请求：键、变体、正文参数三样都由这里一处给，调用点不再拼字符串。 */
export function buildCalendarRefreshFailureRequest(notice: CalendarRefreshFailureNotice, occurredAt: string): NotificationSubmitRequest {
  const variant = calendarRefreshVariant(notice.failureCode)
  return {
    eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.calendarRefreshFailed,
    producerId: MARKET_CALENDAR_REFRESH_SOURCE_LABEL,
    bodyVariant: variant,
    bodyParams: { source: MARKET_CALENDAR_REFRESH_SOURCE_LABEL },
    // 变量名与声明模板 `calendar-refresh:{providerId}:{date}:{generation}` 逐字同名（`dedupeNameGuard` 会抓）。
    dedupeVars: { builder: 'template', vars: { providerId: notice.providerId, date: notice.date, generation: String(notice.generation) } },
    // 报送只走中心与桌面（声明里没申请手机，也就没有手机那一档）；没有动作：后台维护事件,
    // 读者当场做不了事，持续性失败由 `source.consecutive-failed` 那条负责。
    actions: [],
    occurredAt
  }
}

/** 发一条：没有通知端口时什么也不做；提交异常不把刷新判成失败（数据已经落库/已经失败过）。 */
export async function notifyCalendarRefreshFailed(
  submit: ((request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>) | undefined,
  notice: CalendarRefreshFailureNotice,
  occurredAt: string
): Promise<NotificationSubmitOutcome | null> {
  if (submit === undefined) return null
  try {
    return await submit(buildCalendarRefreshFailureRequest(notice, occurredAt))
  } catch {
    return null
  }
}
