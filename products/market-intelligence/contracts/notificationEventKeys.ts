import {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '@platform/notifications/contracts/platformNotificationEvents'

/**
 * 情报模块通知事件的文案键：**全部由事件 id 机械生成**，调用点不手拼。
 *
 * 标题/正文/理由直接用平台那三个生成函数（`notification.event.<id>.<part>`），
 * 这样事件改名时键跟着变、文案门禁（`notificationEventCopyGate`）能把缺口点名到事件和语言。
 *
 * 动作标签用平台的动作键（`notification.action.open-settings`），不在产品键里另起一套。
 */
export {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '@platform/notifications/contracts/platformNotificationEvents'

/**
 * 事件下的任意一段文案键：`notification.event.<id>.<path>`（如 `country.US`、`indicator.cpi`）。
 *
 * 与其余几个生成函数同源：手写全串会在事件改名时静默失效，而这类键数量多、最容易手写。
 */
export function notificationEventNamedKey(eventTypeId: string, path: string): string {
  return `notification.event.${eventTypeId}.${path}`
}

/**
 * 标题变体的键：`notification.event.<id>.headline.<variant>`。
 *
 * 与标题/正文/理由同一套前缀、同一个生成地：事件改名时四句「加剧」标题跟着变，
 * 不会因为手写全串而静默解析不到、悄悄降级成兜底句。
 */
export function notificationEventHeadlineKey(eventTypeId: string, variant: string): string {
  return `notification.event.${eventTypeId}.headline.${variant}`
}

/** 一条事件有正文时用的键；带变体时是 `.body.<variant>`。 */
export function notificationEventVariantKey(eventTypeId: string, variant: string): string {
  return notificationEventBodyKey(eventTypeId, variant)
}

/** 本模块的通知事件 id：与 `notification-event-ownership.md`、批准表逐字一致。 */
/**
 * 平台分析事件的 id —— 本产品是它们的生产者，所以 id 从这里取，别处不再写一遍字面量。
 *
 * 与批准表逐字一致；生产者门禁只认这一处和平台声明表，写在别处它认不出「有没有人真的在发」。
 */
export const ANALYSIS_NOTIFICATION_EVENT_IDS = Object.freeze({
  manualFailed: 'platform.analysis.manual-failed',
  repeatedFailure: 'platform.analysis.repeated-failure',
  attemptAbandoned: 'platform.analysis.attempt-abandoned',
  recovered: 'platform.analysis.recovered'
})

export const MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS = Object.freeze({
  briefingFailed: 'market-intelligence.briefing.failed',
  briefingReady: 'market-intelligence.briefing.ready',
  signalTriggered: 'market-intelligence.signal.triggered',
  macroEventLanded: 'market-intelligence.macro.event-landed',
  sentimentAlert: 'market-intelligence.sentiment.alert',
  sourceConsecutiveFailed: 'market-intelligence.source.consecutive-failed',
  sourceStale: 'market-intelligence.source.stale',
  timezoneInvalid: 'market-intelligence.timezone.invalid'
})
