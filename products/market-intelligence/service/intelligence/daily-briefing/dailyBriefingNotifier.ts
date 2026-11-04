import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from '../jobs/intelligenceJobIds'

/**
 * 日报线的三条通知：`briefing.ready`（一天一期完成提醒）、`briefing.failed`（两种正文变体）、
 * `timezone.invalid`。
 *
 * **完成类一天一期**（读者 2026-11-04 翻案恢复，撤销 §28 的「成功保持静默」）：日报生成并落盘后
 * 发一条，键只带日期；同一天重新生成不新增第二条。只进中心，读者在情报页勾了才推手机，桌面不弹。
 *
 * 提交只带**参数**，键由平台按声明展开（契约 §3.2）：`brief-failed:{date}:{period}`、
 * `timezone-invalid:{date}` 的变量从这里进，拼键只在声明一处。
 * 变体名只认声明 `bodyKeyByVariant` 里的两个；写错会被 `rejected: unknown-body-variant` 拒，
 * 不会静默掉到兜底句。
 *
 * `producerId` 用 **handler id** 而不是带期号的 definition id（契约 §14.1）：让渡表是静态的，
 * 只有 handler 稳定；一期一个 definition 的话，每加一期都会冒出一个 claim 永远对不上的 id。
 *
 * 一条通知发不出去不能把生成判成失败（日报已经落库），所以这里吞掉提交异常、返回 null。
 */
export type DailyBriefingNotice =
  | Readonly<{ kind: 'failed'; variant: 'not-generated' | 'editorial-missing'; date: string; periodId: string }>
  | Readonly<{ kind: 'timezone-invalid'; date: string }>
  /** 完成类：读者 2026-11-04 翻案恢复的一条日报完成提醒，一天一期，重新生成不再发。 */
  | Readonly<{ kind: 'ready'; date: string }>

export type DailyBriefingNoticeSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/**
 * 失败类的落点：日报页。产品位给 `pageId`，壳层负责解析到那一屏。壳层补上 `pageId` 之前
 * 这个动作点了还不会走——按本版口径，那一天之前它不算完成。
 */
const OPEN_BRIEFING_DEEPLINK = Object.freeze({
  scope: 'product' as const,
  productId: 'market-intelligence',
  pageId: 'daily-briefing'
})

/** 失败类只有一个动作：打开日报页重试。动作键是平台的（`notification.action.open-briefing`）。 */
const OPEN_BRIEFING_ACTION = Object.freeze({
  id: 'open-briefing',
  labelKey: 'notification.action.open-briefing' as const,
  kind: 'open' as const,
  deeplink: OPEN_BRIEFING_DEEPLINK
})

/** 「去设置改时区」落在**偏好设置**（时区就在这里）。 */
const TIME_ZONE_SETTINGS_DEEPLINK = Object.freeze({
  scope: 'platform' as const,
  settingsSectionId: 'preferences'
})

/**
 * 服务与 job 共用这一个入口：`submit` 缺省时什么也不做（未装配通知运行时的测试），
 * 提交失败也只返回 null——调用点不需要各自写 try/catch。
 */
export async function notifyDailyBriefing(
  submit: DailyBriefingNoticeSubmit | undefined,
  notice: DailyBriefingNotice,
  occurredAt: string
): Promise<NotificationSubmitOutcome | null> {
  if (!submit) return null
  try {
    return await submit(buildBriefingNoticeRequest(notice, occurredAt))
  } catch {
    return null
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
  if (notice.kind === 'ready') {
    // 键只带日期：版本号、生成时刻或内容哈希任一混进去，同一天重新生成就会变成第二条提醒。
    return {
      eventTypeId: EVENT_IDS.briefingReady,
      producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
      dedupeVars: { builder: 'template', vars: { date: notice.date } },
      actions: [{ ...OPEN_BRIEFING_ACTION }],
      deeplink: { ...OPEN_BRIEFING_DEEPLINK },
      occurredAt
    }
  }
  if (notice.kind === 'failed') {
    // 一期一条：`condition` 粒度下同期再失败是「又一次」，次数累加、正文取最新、不重推。
    return {
      eventTypeId: EVENT_IDS.briefingFailed,
      producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
      dedupeVars: { builder: 'template', vars: { date: notice.date, period: notice.periodId } },
      bodyVariant: notice.variant,
      actions: [{ ...OPEN_BRIEFING_ACTION }],
      // 整行点开也落到日报页：读者从列表里点，和点按钮是同一件事。
      deeplink: { ...OPEN_BRIEFING_DEEPLINK },
      occurredAt
    }
  }
  throw new Error(`daily-briefing:unhandled-notice:${String(notice)}`)
}
