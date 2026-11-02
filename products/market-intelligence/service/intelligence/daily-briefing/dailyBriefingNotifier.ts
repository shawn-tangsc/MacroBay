import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from '../jobs/intelligenceJobIds'

/**
 * 日报线的一条通知：`timezone.invalid`。
 *
 * 「今天日报已生成」不再发通知（2026-11-03）：它没有动作（`actions: []`），读者点开也去不了
 * 任何地方；而且产品经理 §28 定了「成功不通知」。口径和代码只能留一个，留口径。
 *
 * 提交只带**参数**，键由平台按声明展开（契约 §3.2）：`timezone-invalid:{date}` 的变量从这里进，
 * 拼键只在声明一处，写错了编译期就该红。
 *
 * `producerId` 用 **handler id** 而不是带期号的 definition id（契约 §14.1）：让渡表是静态的，
 * 只有 handler 稳定；一期一个 definition 的话，每加一期都会冒出一个 claim 永远对不上的 id。
 *
 * 一条通知发不出去不能把生成判成失败（日报已经落库），所以这里吞掉提交异常、返回 null；
 * 调用点因此不必各自写一遍 try/catch。
 */
export type DailyBriefingNotice = Readonly<{ kind: 'timezone-invalid'; date: string }>

export type DailyBriefingNoticeSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/**
 * 「去设置改时区」落在**偏好设置**（时区就在这里）。今天壳层的 deeplink 只解析
 * `settingsSectionId`（`notificationDeeplink.ts`），所以这里只发这一种，不写一条走不通的页跳转。
 */
const TIME_ZONE_SETTINGS_DEEPLINK = Object.freeze({
  scope: 'platform' as const,
  settingsSectionId: 'preferences'
})

export function createDailyBriefingNotifier(deps: Readonly<{
  submit: DailyBriefingNoticeSubmit
  now?: () => string
}>): (notice: DailyBriefingNotice) => Promise<NotificationSubmitOutcome | null> {
  const now = deps.now ?? (() => new Date().toISOString())
  return async function notify(notice) {
    try {
      return await deps.submit(buildBriefingNoticeRequest(notice, now()))
    } catch {
      return null
    }
  }
}

/** 纯函数：同样的通知与时刻永远得到同一份请求，便于逐字段断言。 */
export function buildBriefingNoticeRequest(
  notice: DailyBriefingNotice,
  occurredAt: string
): NotificationSubmitRequest {
  return {
    eventTypeId: EVENT_IDS.timezoneInvalid,
    producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    // 变量名必须是声明模板里的那个（`timezone-invalid:{date}`）：平台按名字填，填不上就拒收。
    dedupeVars: { builder: 'template', vars: { date: notice.date } },
    // 只进中心（声明里没申请桌面/通道）；读者要做的事就在偏好设置里，动作指到那儿。
    actions: [{
      id: 'open-time-zone-settings',
      labelKey: 'notification.action.open-settings',
      kind: 'open',
      deeplink: { ...TIME_ZONE_SETTINGS_DEEPLINK }
    }],
    deeplink: { ...TIME_ZONE_SETTINGS_DEEPLINK },
    occurredAt
  }
}
