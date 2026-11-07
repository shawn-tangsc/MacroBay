import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { failureCopy, readyCopy, timezoneCopy } from './dailyBriefingNoticeSentences'
import { findActionDirective } from '@platform/notifications/contracts/actionDirective'
import type { BriefingDiagnosticLog } from './dailyBriefReadinessGate'
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
  | Readonly<{ kind: 'failed'; variant: 'not-generated' | 'editorial-missing'; date: string; periodId: string; locale?: string; timeLabel?: string }>
  | Readonly<{ kind: 'timezone-invalid'; date: string }>
  /**
   * 完成类：一天一期。`edition` 是读者眼前那一版的身份，落库供「发布频道」核对；`deliver: false`
   * 用于手动重新生成——照常建/合并记录，但不投递任何表面，读者点按钮时才有东西可重投。
   */
  | Readonly<{ kind: 'ready'; date: string; periodId: string; editionId: string; locale: string; deliver?: boolean; timeLabel?: string; lede?: string }>

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
/**
 * 导读里有没有**指向本条通知**的动作指令（契约 v2.57）：有就整段不拼——手机上没有可点的地方，
 * 发出去就是一句做不到的承诺。判定用平台唯一那份词表，产品不另写。
 */
export function actionDirectiveInLede(lede: string | undefined): string | null {
  const trimmed = lede?.trim()
  return trimmed === undefined || trimmed === '' ? null : findActionDirective(trimmed)
}

export async function notifyDailyBriefing(
  submit: DailyBriefingNoticeSubmit | undefined,
  notice: DailyBriefingNotice,
  occurredAt: string,
  log?: BriefingDiagnosticLog
): Promise<NotificationSubmitOutcome | null> {
  if (!submit) {
    // 没装配端口就什么都没发生——以前这里静默返回，整条通知链"没发"和"不该发"分不出来。
    log?.('warn', 'MI_DAILY_BRIEF_NOTICE_PORT_MISSING', { kind: notice.kind, at: occurredAt })
    return null
  }
  // 命中动作词：只交事实句，并把「因为哪句才没发」记进 appLog（平台建不了这个码，也看不见这段）。
  const hit = notice.kind === 'ready' ? actionDirectiveInLede(notice.lede) : null
  if (hit !== null) log?.('warn', 'MI_DAILY_BRIEF_LEDE_WITHHELD', { editionId: (notice as { editionId: string }).editionId, hit, at: occurredAt })
  // 命中时只交事实句：把导读从这次通知里拿掉（不删词、不改写，整段不发）。
  let outgoing: DailyBriefingNotice = notice
  if (notice.kind === 'ready' && hit !== null) outgoing = { ...notice, lede: undefined }
  try {
    const outcome = await submit(buildBriefingNoticeRequest(outgoing, occurredAt))
    // 平台会静默拒收（未知事件类型、免打扰、上限、审批未通过…），这条以前也看不见。
    // 判"发没发"以库里的记录为准，但"为什么没发"必须能从日志里读出来。
    if (outcome.kind !== 'accepted' && outcome.kind !== 'merged') {
      log?.('warn', 'MI_DAILY_BRIEF_NOTICE_NOT_DELIVERED', {
        kind: notice.kind, outcome: outcome.kind,
        ...('reason' in outcome && outcome.reason ? { reason: outcome.reason } : {}),
        at: occurredAt
      })
    }
    return outcome
  } catch (error) {
    log?.('error', 'MI_DAILY_BRIEF_NOTICE_SUBMIT_FAILED', {
      kind: notice.kind,
      message: error instanceof Error ? error.message : String(error),
      at: occurredAt
    })
    return null
  }
}

/**
 * 这一期的**名义时刻**，按它自己的时区写成 `HH:mm`（`02` v2.137 A9.17：通知点名到哪一期）。
 * 拿不到就返回空串——句子里的占位会连着空格一起消失，不印 `07:00` 这种编出来的时刻。
 */
export function briefingTimeLabel(instant: string, timeZone: string): string {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(parsed))
  } catch {
    return ''
  }
}

/** 一次失败的提醒：点名到哪一期（日期 + 时刻 + 语言），变体句说人话原因。 */
export function briefingFailedNotice(input: Readonly<{
  variant: 'not-generated' | 'editorial-missing'
  date: string
  periodId: string
  locale: DailyBriefingLocale
  asOf: string
  timeZone: string
}>): DailyBriefingNotice {
  return {
    kind: 'failed', variant: input.variant, date: input.date, periodId: input.periodId,
    locale: input.locale, timeLabel: briefingTimeLabel(input.asOf, input.timeZone)
  }
}

/** 发一条失败提醒：点名哪一期 + 人话原因变体；没有通知端口时什么也不做。 */
export async function notifyBriefingFailure(
  submit: DailyBriefingNoticeSubmit | undefined,
  input: Readonly<{ variant: 'not-generated' | 'editorial-missing'; date: string; periodId: string; locale: DailyBriefingLocale; asOf: string; timeZone: string }>,
  occurredAt: string,
  log?: BriefingDiagnosticLog
): Promise<NotificationSubmitOutcome | null> {
  return notifyDailyBriefing(submit, briefingFailedNotice(input), occurredAt, log)
}

/** 版次日期写成读者一眼能认的形状（`11/06`）：ISO 串在通知里太长，也太像机器。 */
export function monthDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match === null ? date : `${match[2]}/${match[3]}`
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
      // 源头拼成品（契约 v2.56）：平台只挑一份发，不再读文案表。
      rendered: timezoneCopy(),
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
    // 键带日期 + 期号 + 语言：同一天的两期、或同刻的两种语言，是两条提醒。
    // 版本号、生成时刻或内容哈希仍不许混进去，同一天同一版次重新生成不该再提醒一次。
    return {
      eventTypeId: EVENT_IDS.briefingReady,
      producerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
      // The record states which edition it carries, so a later manual push can check it is the one on
      // screen; a manual regeneration writes the record without delivering anything.
      edition: { editionId: notice.editionId, locale: notice.locale },
      // 正文说的是**哪一期**，不说"今天"：日期 + 时刻 + 这一期的语言；导读接在同一段后面。
      // 只交这一期自己的语言一份——平台按 `edition.locale` 挑，英文界面也整条中文。
      rendered: readyCopy({
        date: notice.date,
        time: notice.timeLabel ?? '',
        locale: notice.locale === 'en-US' ? 'en-US' : 'zh-CN',
        ...(notice.lede === undefined ? {} : { lede: notice.lede })
      }),
      ...(notice.deliver === false ? { deliver: false } : {}),
      dedupeVars: { builder: 'template', vars: { date: notice.date, periodId: notice.periodId, locale: notice.locale } },
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
      // 失败也点名到哪一期，两份语言都交（它没有期次，中心按读者语言挑）。
      rendered: failureCopy({
        variant: notice.variant,
        date: notice.date,
        time: notice.timeLabel ?? '',
        locale: (notice.locale ?? 'zh-CN') === 'en-US' ? 'en-US' : 'zh-CN'
      }),
      actions: [{ ...OPEN_BRIEFING_ACTION }],
      // 整行点开也落到日报页：读者从列表里点，和点按钮是同一件事。
      deeplink: { ...OPEN_BRIEFING_DEEPLINK },
      occurredAt
    }
  }
  throw new Error(`daily-briefing:unhandled-notice:${String(notice)}`)
}
