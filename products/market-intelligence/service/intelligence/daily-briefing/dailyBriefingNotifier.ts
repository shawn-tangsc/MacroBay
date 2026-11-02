import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from '../jobs/intelligenceJobIds'

/**
 * 日报线的两条通知：`briefing.ready` 与 `timezone.invalid`。
 *
 * 提交只带**参数**，键由平台按声明展开（契约 §3.2）：`brief-done:{date}:{period}` 与
 * `timezone-invalid:{date}` 的变量从这里进，拼键只在声明一处，写错了编译期就该红。
 *
 * `producerId` 用 **handler id** 而不是带期号的 definition id（契约 §14.1）：让渡表是静态的，
 * 只有 handler 稳定；一期一个 definition 的话，每加一期都会冒出一个 claim 永远对不上的 id。
 *
 * 一条通知发不出去不能把生成判成失败（日报已经落库），所以调用点负责吞异常；这里只管构造。
 */
export type DailyBriefingNotice =
  | Readonly<{ kind: 'ready'; date: string; periodId: string }>
  | Readonly<{ kind: 'timezone-invalid'; date: string }>

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
  // 一条通知发不出去不能把生成判成失败（日报已经落库）；这里吞掉，返回 null 表示没交出去。
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
  if (notice.kind === 'timezone-invalid') {
    return {
      eventTypeId: EVENT_IDS.timezoneInvalid,
      producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
      dedupeVars: { builder: 'template', vars: { date: notice.date } },
      // 只进中心（声明里没申请桌面/通道）；动作是「去设置」，读者要做的事就在那里。
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
  // 完成类：桌面与通道按读者的订阅（`notifyOnlyIfSubscribed`），这里不挑表面。
  // 一期一条：`occurrence` 粒度下重生成再提交是「同一次发生的重复上报」，不新开行、不重推。
  return {
    eventTypeId: EVENT_IDS.briefingReady,
    producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    dedupeVars: { builder: 'template', vars: { date: notice.date, periodId: notice.periodId } },
    actions: [],
    occurredAt
  }
}
