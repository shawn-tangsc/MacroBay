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
 * 动作标签的键平台还没有生成函数（`NotificationAction.labelKey` 只收平台闭集键），
 * 这里先用同一前缀补一个，键形状与另外四个一致；平台补上后换成平台函数，调用点不变。
 */
export {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '@platform/notifications/contracts/platformNotificationEvents'

export function notificationEventActionKey(eventTypeId: string): string {
  return `notification.event.${eventTypeId}.action`
}

/** 一条事件有正文时用的键；带变体时是 `.body.<variant>`。 */
export function notificationEventVariantKey(eventTypeId: string, variant: string): string {
  return notificationEventBodyKey(eventTypeId, variant)
}

/** 本模块的通知事件 id：与 `notification-event-ownership.md`、批准表逐字一致。 */
export const MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS = Object.freeze({
  briefingFailed: 'market-intelligence.briefing.failed',
  briefingReady: 'market-intelligence.briefing.ready',
  signalTriggered: 'market-intelligence.signal.triggered',
  macroEventLanded: 'market-intelligence.macro.event-landed',
  sourceConsecutiveFailed: 'market-intelligence.source.consecutive-failed',
  sourceStale: 'market-intelligence.source.stale',
  calibrationResult: 'market-intelligence.calibration.result',
  timezoneInvalid: 'market-intelligence.timezone.invalid'
})
