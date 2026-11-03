import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'

/**
 * 宏观发布落地的通知（Wave 6）：**只在「实际值到了、且与预期差超过阈值」时提交一条**。
 *
 * 阈值不在这里判：`providerReleaseSurprises` 是唯一决定「算不算意外」的地方，这里只把它的
 * 结果变成一个提交请求。例行发布（没有实际值、或没超过阈值）不产生通知——一条每天都会响的
 * 通知，读者三天内就会把它关掉，之后真出事也不会看。
 *
 * 键由平台按声明展开（`calendar:{eventId}:{releaseAt}`），调用方只给参数；同一次发布重复提交
 * 走平台的 `occurrence` 去重：次数累加、正文取最新，不重推。
 *
 * `producerId` 用稳定 handler id 而不是带期号的 definition id：让渡表是静态的，只有 handler
 * 稳定。一条通知发不出去不能把分析判成失败（数据已经落库），所以这里吞掉提交异常。
 */
export type MacroReleaseNotice = Readonly<{
  /** 发布的稳定标识（日历行的 `eventKey`），与 `dedupeKeyTemplate` 的 `{eventId}` 对应。 */
  eventId: string
  /** 这次发布描述的时点（UTC、Z 结尾毫秒）；晚到的数据仍属于它自己的发布时间。 */
  releaseAt: string
}>

export const MACRO_RELEASE_PRODUCER_ID = 'market-intelligence.calendarRefresh'

export type MacroReleaseSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/** 纯函数：同样的发布与时刻永远得到同一份请求，便于逐字段断言。 */
export function buildMacroReleaseNoticeRequest(
  notice: MacroReleaseNotice,
  occurredAt: string
): NotificationSubmitRequest {
  return {
    eventTypeId: EVENT_IDS.macroEventLanded,
    producerId: MACRO_RELEASE_PRODUCER_ID,
    dedupeVars: { builder: 'template', vars: { eventId: notice.eventId, releaseAt: notice.releaseAt } },
    // 这一条不需要读者做任何事（`requiresUserAction: false`）：平台没有「打开日历」的动作键，
    // 与其借「去设置」把读者带到无关页面，不如不给动作。
    actions: [],
    occurredAt
  }
}

export async function notifyMacroRelease(
  submit: MacroReleaseSubmit | undefined,
  notice: MacroReleaseNotice,
  occurredAt: string
): Promise<NotificationSubmitOutcome | null> {
  if (!submit) return null
  try {
    return await submit(buildMacroReleaseNoticeRequest(notice, occurredAt))
  } catch {
    return null
  }
}

/**
 * 一次分析里判出来的发布意外 → 每条一条通知。
 *
 * 去重交给平台：同一条发布在同一个 releaseAt 下重复提交不会重推；这里不去重，因为「是不是
 * 同一次发布」正是 `calendar:{eventId}:{releaseAt}` 要回答的问题，两处各判一次必然分叉。
 */
export async function notifyMacroReleases(
  submit: MacroReleaseSubmit | undefined,
  releases: readonly MacroReleaseNotice[],
  occurredAt: string
): Promise<number> {
  let sent = 0
  for (const release of releases) {
    if (await notifyMacroRelease(submit, release, occurredAt)) sent += 1
  }
  return sent
}
