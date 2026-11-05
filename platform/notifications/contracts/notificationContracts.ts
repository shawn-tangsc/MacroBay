import type { NotificationCopyKey, NotificationCopyLanguage } from '../../i18n/notificationCopy'
import type { NotificationApprovedLevel } from './notificationEventCatalog'

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
  /** 动作标签的键；调用点不写句子，句子在文案表里。 */
  labelKey: NotificationCopyKey
  kind: 'open' | 'acknowledge' | 'dismiss' | 'snooze' | 'custom'
  deeplink?: NotificationDeeplink
}

/** 每个投递表面各一条证据（契约 §8）：不是一个字段撑四个面。 */
export type NotificationDeliveryState = {
  /**
   * 四档，映射写死（契约 §8 / 设计 N21）：没发出=`queued`、通道受理=`sent-accepted`、
   * 请求已发但没拿到回执=`sent-unconfirmed`、通道报错=`failed`+原因。
   * 界面文案只读这一档，不许拿投递端返回值猜。
   */
  state: 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
  reason?: string
  messageId?: string
  at: string
  /** 「再推一次」用：这条记录的手机投递一共成功发起过几次（调试与瞬时回执用，界面不常驻）。 */
  pushCount?: number
  /** 最近一次重投的时刻（UTC）。 */
  lastPushedAt?: string
}

/** 通道熔断状态：每个 channelId 一条，随通知 JSON 持久化、重启不丢窗口。 */
export type NotificationPushBackoff = {
  channelId: string
  failures: number
  pausedUntil: string | null
}

export type NotificationRecord = {
  id: string
  owner: 'platform' | 'product'
  productId?: string
  sourceId: string
  /** 事件类型；旧记录归一化为 `legacy.untyped`（契约 §6）。 */
  eventTypeId: string
  /** 合并进来的其它事件类型（含首条，契约 §16.2）。 */
  mergedEventTypes?: string[]
  /** 每个表面的投递证据（契约 §8）。旧记录归一化为空对象。 */
  delivery: Partial<Record<'toast' | 'popup' | 'desktop' | 'push', NotificationDeliveryState>>
  /** 标题文案键；句子由 `platform/i18n/notificationCopy.ts` 解析（切语言时历史通知跟着变）。 */
  titleKey: NotificationCopyKey
  titleParams?: Record<string, string>
  /**
   * 提交那一刻的界面语言。措辞按键解析（改文案，历史跟着变好），但**用哪一种语言是提交时定下的**：
   * 让过去的通知跟着今天的界面语言变，等于改写历史，和运行记录同一条口径。
   *
   * **旧记录没有这一格**——它们提交时没人记语言，替它们编一个就是伪造历史。缺这一格时按读者当前
   * 语言解析，这是历史遗留处理，不是设计（见 `resolveNotificationText`）。
   */
  language?: NotificationCopyLanguage
  bodyKey?: NotificationCopyKey
  bodyParams?: Record<string, string>
  /** 「为什么推了」的键与参数；端口拿解析后的句子，不自己拼。 */
  reasonKey?: NotificationCopyKey
  reasonParams?: Record<string, string>
  severity: NotificationSeverity
  priority: NotificationPriority
  channels: NotificationChannel[]
  state: NotificationState
  deeplink?: NotificationDeeplink
  actions: NotificationAction[]
  dedupeKey?: string
  correlationId?: string
  safeMetadata?: Record<string, unknown>
  /** 读者眼前那一版的标识（`redeliverPush` 靠它核对）；**历史记录没有它，一律按不匹配处理**。 */
  edition?: { editionId: string; locale: string }
  occurrenceCount: number
  /** 熔断折叠掉的原文条数；只有聚合记录有。原文不落库，但这个事实必须留下。 */
  collapsedCount?: number
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
  /** 兼容旧生产者的迁移字段；新提交路径一定带事件 id（契约 §3.2）。 */
  eventTypeId?: string
  /** 标题文案键；句子由 `platform/i18n/notificationCopy.ts` 解析（切语言时历史通知跟着变）。 */
  titleKey: NotificationCopyKey
  titleParams?: Record<string, string>
  bodyKey?: NotificationCopyKey
  bodyParams?: Record<string, string>
  /** 「为什么推了」的键与参数；端口拿解析后的句子，不自己拼。 */
  reasonKey?: NotificationCopyKey
  reasonParams?: Record<string, string>
  severity: NotificationSeverity
  priority: NotificationPriority
  requestedChannels: NotificationChannel[]
  deeplink?: NotificationDeeplink
  actions?: NotificationAction[]
  dedupeKey?: string
  correlationId?: string
  safeMetadata?: Record<string, unknown>
  expiresAt?: string
  /** 读者眼前那一版；合并时**带了才覆盖**，没带就保持记录原样（不许清空）。 */
  edition?: { editionId: string; locale: string }
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
  desktopEnabled: boolean
  /** 全站提示开关，默认 false（契约 §5.1：提示不是订阅列）。 */
  toastEnabled: boolean
  popupEnabled: boolean
  /**
   * 情报三条「推不推手机」的读者选择（契约 §5.4）：只存那三个 id，缺省即开。
   * 生效还要同时满足「批准含 channel ∩ 频道已启用 ∩ 频道可用」，那是投递层的事。
   */
  channelEvents?: Readonly<Record<string, boolean>>
  /**
   * 出站通道（**过渡字段**）：设置页已经不再读写它；投递端口在「取唯一启用频道」落地前
   * 仍按它取目标。第六组改完端口后，这个字段随 AppSettings 一并删除。
   */
  push: { channelId: string | null }
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
    // 契约 §5.1（2026-11-04 口径）：桌面默认**关**，读者主动打开才弹。
    desktopEnabled: false,
    // 契约 §5.1：提示是全站一个开关，新装默认关；生效 = 批准含 toast ∩ 本开关。
    toastEnabled: false,
    popupEnabled: true,
    // 三条频道事件默认全开：「装上就推，不想收再去关」（契约 §5.4）。
    channelEvents: Object.freeze({}),
    // 过渡字段：设置页不再写它，第六组把端口改成「唯一启用频道」后删掉。
    push: { channelId: null },
    retentionDays: 30,
    defaultSnoozeMinutes: 60
  }
}

/**
 * 每条投递渠道背后**有没有用户看得见的落点**。可点状态必须等于这一栏，不是等于「平台能不能发通知」。
 *
 * 这一格曾被写成一个布尔量（`notificationProducerWired`），它的含义是「有没有生产者了」。接上第一个
 * 生产者后它变成 `true`，于是四个开关一起点亮——可那一刻只有中心与桌面有落点，应用内横幅与弹窗连
 * 渲染者都没有。**一个布尔量代表四件事，必然有一次说谎。**
 *
 * 接上一个真实落点时改这一处：`toast` 在右上角横幅落地后转真；`popup` 还没有形态，保持 `false`，
 * 设置页据此逐条禁用并各说各的原因。
 */
export const notificationDeliveryWired: Readonly<Record<NotificationChannel, boolean>> = Object.freeze({
  center: true,
  desktop: true,
  toast: true,
  popup: false
})

/**
 * 出站通道有没有装配好：与 `notificationDeliveryWired` 并列，但**不塞进那个 Record**——
 * 那是「本机表面」真相表，手机不是本机表面。只有装配层真接上 `push` 钩子才置 true；
 * 设置页第五行读它禁用并写原因。
 */
export const notificationPushWired: boolean = false

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

/** 去重键的输入（契约 §3.2）：判别联合，不是自由字符串表。 */
export type NotificationDedupeVars =
  | { builder: 'moduleSignal'; moduleId: string; ruleId: string; asset: string | null
      observedAt: string; cadence: 'intraday'; bucketMs: number }
  | { builder: 'moduleSignal'; moduleId: string; ruleId: string; asset: string | null
      observedAt: string; cadence: 'trading-day' }
  | { builder: 'sourceIssue'; sourceId: string }
  | { builder: 'template'; vars: Readonly<Record<string, string>> }

/** 提交请求（契约 §3.2）：记录里存键与参数，不存句子。 */
export type NotificationSubmitRequest = {
  eventTypeId: string
  producerId?: string
  /**
   * 只记录不投递（契约 §16.3.3）：照常走提交与去重，但**不写任何表面的 delivery 条目**。
   * 缺省 `true`（不传＝投递，历史调用方一行不用改）。**只许手动/读者动作路径用**，
   * 自动生产者带上它由生产者边界守卫报错。
   */
  deliver?: boolean
  /** 读者眼前那一版；落库供 `redeliverPush` 核对。 */
  edition?: { editionId: string; locale: string }
  dedupeVars: NotificationDedupeVars
  titleParams?: Readonly<Record<string, string>>
  bodyParams?: Readonly<Record<string, string>>
  bodyVariant?: string
  reasonParams?: Readonly<Record<string, string>>
  actions: readonly NotificationAction[]
  deeplink?: NotificationDeeplink
  correlationId?: string
  occurredAt: string
}

/** 给产品的回执（契约 §6.1 封闭集合）；不向用户抛异常。 */
export type NotificationSubmitOutcome =
  | { kind: 'accepted'; recordId: string; levels: readonly NotificationApprovedLevel[] }
  | { kind: 'merged'; recordId: string; occurrenceCount: number; mergedEventTypes: string[] }
  | { kind: 'collapsed'; aggregateRecordId: string; collapsedCount: number }
  /** 让渡给了产品：平台不落库、不投递，只记一条 `delegated` 诊断（契约 §14）。 */
  | { kind: 'delegated'; eventTypeId: string; producerId: string; ownerProductId: string }
  | {
      kind: 'rejected'
      reason:
        | 'unknown-event-type'
        | 'cross-product-key'
        | 'missing-dedupe-key'
        | 'invalid-dedupe-vars'
        | 'unknown-body-variant'
        | 'missing-action'
        | 'scope-mismatch'
      message: string
    }

/** 诊断出口：五类「没人看就会变成黑箱」的事实（runtime §2）。 */
export type NotificationDiagnosticsEntry = {
  code:
    | 'delegated'
    | 'unclaimed-producer'
    | 'claim-never-registered'
    | 'copy-unresolved'
    | 'persist-failed'
  eventTypeId?: string
  producerId?: string
  at: string
}
export type NotificationDiagnosticsSink = (entry: NotificationDiagnosticsEntry) => void
