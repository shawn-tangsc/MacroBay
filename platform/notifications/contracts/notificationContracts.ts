export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'
export type NotificationChannel = 'center' | 'toast' | 'popup' | 'desktop'
export type NotificationState = 'unread' | 'read' | 'acknowledged' | 'dismissed' | 'snoozed' | 'expired'

export type NotificationDeeplink = {
  scope: 'platform' | 'product'
  productId?: string
  pageId?: string
  settingsSectionId?: string
  entityType?: string
  entityId?: string
  params?: Record<string, string>
}

export type NotificationAction = {
  id: string
  label: string
  kind: 'open' | 'acknowledge' | 'dismiss' | 'snooze' | 'custom'
  deeplink?: NotificationDeeplink
}

export type NotificationRecord = {
  id: string
  owner: 'platform' | 'product'
  productId?: string
  sourceId: string
  title: string
  body?: string
  severity: NotificationSeverity
  priority: NotificationPriority
  channels: NotificationChannel[]
  state: NotificationState
  deeplink?: NotificationDeeplink
  actions: NotificationAction[]
  dedupeKey?: string
  correlationId?: string
  safeMetadata?: Record<string, unknown>
  occurrenceCount: number
  createdAt: string
  updatedAt: string
  readAt?: string
  acknowledgedAt?: string
  dismissedAt?: string
  snoozedUntil?: string
  expiresAt?: string
}

export type SafeNotificationRecord = Omit<NotificationRecord, 'safeMetadata'> & {
  safeMetadata?: Record<string, unknown>
}

export type NotificationRequest = {
  owner: 'platform' | 'product'
  productId?: string
  sourceId: string
  title: string
  body?: string
  severity: NotificationSeverity
  priority: NotificationPriority
  requestedChannels: NotificationChannel[]
  deeplink?: NotificationDeeplink
  actions?: NotificationAction[]
  dedupeKey?: string
  correlationId?: string
  safeMetadata?: Record<string, unknown>
  expiresAt?: string
}

export type NotificationListQuery = {
  state?: NotificationState[]
  productId?: string
  limit?: number
  /** 键游标 `createdAt|id`：同一毫秒的多条不会丢，也不随新记录插入而错位。不是数组下标。 */
  cursor?: string
  /** 未读排在已读之前，组内仍按时间倒序。排序在查询里做，渲染层不许拼两次查询。 */
  unreadFirst?: boolean
}

export type NotificationListPage = {
  items: SafeNotificationRecord[]
  nextCursor?: string
}

/** 角标状态：未读数 + 版本号。版本号随每次记录变化递增，订阅方据此判断「是不是比上次新」。 */
export type NotificationUnreadState = {
  unread: number
  version: number
}

/**
 * 桌面通知的授权状态。**`unknown` 是常态，不是异常**：Electron 41 没有 `getNotificationSettings`，
 * 而 `Notification.isSupported()` 回答的是「这个平台支不支持通知」，不是「用户授没授权」。
 * 拿它冒充 `granted` 会让排查全部指向「发送失败」，把一个查不到的结论说成已知事实。
 */
export type DesktopNotificationPermission = 'granted' | 'denied' | 'unknown'

export type NotificationRuntimeSettings = {
  centerEnabled: boolean
  desktopEnabled: boolean
  toastEnabled: boolean
  popupEnabled: boolean
  /**
   * 保留天数：**当前存着但没有任何消费者**——运行时没有剪枝任务，设置页也没暴露这一项
   * （2026-11-01 用户裁决保留字段、暂不实现）。它与「有策略无执行者」那族同源，接通知生产者时
   * 必须同时给出真的清理任务，否则这个值永远只是数字。不许在没接清理的情况下把它摆到界面上。
   */
  retentionDays: number
  defaultSnoozeMinutes: number
  quietHours?: {
    enabled: boolean
    startLocalTime: string
    endLocalTime: string
  }
  minimumDisruptivePriority?: NotificationPriority
  productPermissions?: Record<
    string,
    {
      enabled: boolean
      allowDesktop: boolean
      allowToast: boolean
      allowPopup: boolean
    }
  >
}

export function createDefaultNotificationRuntimeSettings(): NotificationRuntimeSettings {
  return {
    centerEnabled: true,
    desktopEnabled: true,
    toastEnabled: true,
    popupEnabled: true,
    retentionDays: 30,
    defaultSnoozeMinutes: 60
  }
}

/**
 * Whether anything in the platform submits notifications yet. With no producer the delivery
 * switches filter an empty stream, so the settings pane must present them as unavailable instead
 * of as working toggles. Flip this in the same change that wires the first producer.
 */
export const notificationProducerWired = false

export function toSafeNotificationRecord(record: NotificationRecord): SafeNotificationRecord {
  const metadata = record.safeMetadata ? sanitizeMetadata(record.safeMetadata) : undefined
  return {
    ...record,
    safeMetadata: metadata
  }
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(metadata)
  if (serialized.length > 4096) {
    return { truncated: true }
  }
  const blocked = /(api[_-]?key|api[_-]?secret|authorization|password|token)/i
  if (blocked.test(serialized)) {
    return { redacted: true }
  }
  return metadata
}

export const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  success: 1,
  warning: 2,
  critical: 3
}

export const PRIORITY_RANK: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
}
