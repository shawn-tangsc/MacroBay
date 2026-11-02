/**
 * 平台事件声明表（契约 §2）：平台自己产生的 8 条通知事件。
 *
 * 与产品 manifest 里的声明**同形**，只是声明者固定为 `platform`；批准值不在这里——
 * 生效表面只读 `notificationEventPolicy.ts` 的批准表（契约 §4：「生效值只读批准表」）。
 *
 * 键名由事件 id 机械生成（`notificationEventTitleKey` / `notificationEventReasonKey`），
 * 句子归文案表；这里一条句子都不写，免得两处都能改。
 */
import type { NotificationEventDeclaration } from './notificationEventCatalog'

/** 标题键：`notification.event.<event id>.title`。同一处生成，调用点不手拼。 */
export function notificationEventTitleKey(eventTypeId: string): string {
  return `notification.event.${eventTypeId}.title`
}

/** 理由键：`notification.event.<event id>.reason`。 */
export function notificationEventReasonKey(eventTypeId: string): string {
  return `notification.event.${eventTypeId}.reason`
}

/**
 * 正文键：`notification.event.<event id>.body`；带变体时是 `.body.<variant>`。
 *
 * 与标题/理由同源：产品声明一条事件时，四个键都由这里生成，调用点不手拼——
 * 手写的键在事件改名时不会有人同步，目录解析出来就会落空。
 */
export function notificationEventBodyKey(eventTypeId: string, variant?: string): string {
  const base = `notification.event.${eventTypeId}.body`
  return variant === undefined ? base : `${base}.${variant}`
}


function declaration(
  id: string,
  input: Omit<NotificationEventDeclaration, 'id' | 'titleKey' | 'reasonKey'>,
  copy?: { titleKey?: string; bodyKey?: string }
): NotificationEventDeclaration {
  return {
    id,
    titleKey: copy?.titleKey ?? notificationEventTitleKey(id),
    ...(copy?.bodyKey === undefined ? {} : { bodyKey: copy.bodyKey }),
    reasonKey: notificationEventReasonKey(id),
    ...input
  }
}

export const PLATFORM_NOTIFICATION_EVENTS: readonly NotificationEventDeclaration[] = Object.freeze([
  // P1 任务跑到终态仍失败：同一任务同一天一条、次数累加（`condition` + 24h 窗，跨天重算）。
  declaration('platform.job.failed-terminal', {
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'job-failed:{definitionId}:{date}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000,
    notifyOnlyIfSubscribed: false
  }, { titleKey: 'notification.taskFailed.title', bodyKey: 'notification.taskFailed.body' }),
  // P2 同一任务连续 3 次终态失败：只通知、不暂停任务；同一天同一任务一条。
  declaration('platform.job.repeated-failed', {
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeKeyTemplate: 'job-repeated:{definitionId}:{date}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false
  }),
  // P3 分析额度用尽：同一天只发一次，不随每次被拒重复。
  declaration('platform.analysis.quota-exhausted', {
    requiresUserAction: false,
    requestedDisruptionLevels: ['toast'],
    dedupeKeyTemplate: 'quota-exhausted:{date}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false
  }),
  // P4a 供应商凭据失效：同一供应商 1 小时内合并；恢复是独立事件，不改这条的正文。
  declaration('platform.provider.credential-invalid', {
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'credential-invalid:{providerId}',
    dedupeUnit: 'condition',
    conditionWindowMs: 3_600_000,
    notifyOnlyIfSubscribed: false
  }),
  // P4b 凭据恢复：一天最多一条；独立 id、独立记录，不弹不叫醒。
  declaration('platform.provider.credential-recovered', {
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'credential-recovered:{providerId}:{day}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false
  }),
  // P6a 通道连续失败、自动暂停推送：绝不发到通道本身（申请档位里没有 channel）。
  declaration('platform.channel.push-suspended', {
    requiresUserAction: true,
    requestedDisruptionLevels: ['toast', 'desktop'],
    dedupeKeyTemplate: 'push-suspended:{channelId}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000,
    notifyOnlyIfSubscribed: false
  }),
  // P6b 通道恢复：一天最多一条。
  declaration('platform.channel.push-resumed', {
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false
  }),
  // P7 桌面通知没弹出来：只说观测到的事实，不猜为什么；不合并，随事件本身。
  declaration('platform.desktop.blocked', {
    requiresUserAction: false,
    requestedDisruptionLevels: [],
    dedupeKeyTemplate: 'desktop-blocked:{recordId}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false
  })
])
