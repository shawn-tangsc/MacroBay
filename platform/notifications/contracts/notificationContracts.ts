import type { NotificationCopyKey } from '../../i18n/notificationCopy'
import type { NotificationSurfaceSelection } from './notificationSurfaceSelection'
import type { NotificationSubmitRejection, NotificationSubmitRejectionReason } from './notificationSubmitRejection'
import type { NotificationCopyParam, NotificationCopyRef } from './notificationCopyPort'
import type { NotificationApprovedLevel, NotificationCategory } from './notificationEventCatalog'

export type { NotificationApprovedLevel }

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'

/**
 * **信号自身的严重度**（契约 v2.45 §16.3.4）：只有「升级再投递」用它，与 `NotificationSeverity`
 * （`info|success|warning|critical`，记录上的展示严重度）**是两个概念，不许混用**。
 *
 * 三档闭集来自产品声明（`SignalSeverity`）；平台只按 `low < medium < high` 排序并作为状态存下来，
 * 不另造第二套值。拿 `NotificationSeverity` 比较会得出「永远不升级」——它在提交计划器里曾写死 `info`。
 */
export type NotificationSignalSeverity = 'low' | 'medium' | 'high'

/** 升级比较的唯一顺序。三档 ⇒ 同一记录最多投递三次（首次 + 两次严格升级），不靠任何计数常量。 */
export const SIGNAL_SEVERITY_RANK: Readonly<Record<NotificationSignalSeverity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2
})
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'
export type NotificationChannel = 'center' | 'toast' | 'popup' | 'desktop'
export type NotificationState = 'unread' | 'read' | 'acknowledged' | 'dismissed' | 'snoozed' | 'expired'

export type NotificationDeeplink = {
  scope: 'platform' | 'product'
  productId?: string
  pageId?: string
  settingsSectionId?: string
  /**
   * 产品的设置抽屉落点（只放 id，不放文案）：产品页自己消费这条；平台不写产品面板 id。
   * 与 `settingsSectionId` 同一条严格规则——产品没注册、或这版没有它，就不导航。
   */
  settingsDrawer?: { productId: string; menuId: string }
  entityType?: string
  entityId?: string
  params?: Record<string, string>
}

export type NotificationAction = {
  id: string
  /**
   * 平台动作与**历史记录**的标签键（平台闭集）；调用点不写句子，句子在文案表里。
   *
   * 产品动作**不再用它**：产品自己的键走 `labelRef`（下一项）。保留它是为了老记录——
   * 记录里存的是当初那个键，删掉这个字段等于让历史通知的按钮凭空消失。
   */
  labelKey?: NotificationCopyKey
  /**
   * 标签的引用（v2.58）：与正文**同一条解析链路、同一次语言**。
   *
   * 为什么不是「提交成品标签」：记录存引用、读取时按当前语言解析，切语言后历史通知的标签
   * 才会跟着变（单语成品会让老通知停在旧语言，那正是成品句模型存中英两份要守的东西）。
   *
   * 产品动作必须用它：`scope: 'product'` 自带 `productId`，提交期校验它与本条事件同属一个产品
   * （`action-label-wrong-scope`）。两个字段都没有 → 提交期拒收（`action-label-missing`）。
   */
  labelRef?: NotificationCopyRef
  /**
   * `open-external` = 「看原文」：打开一个**读者真能点的公开地址**（契约 §7.5 ⑫）。
   *
   * 它与 `open` 不是一回事：`open` 指的是应用内的一个落点（`deeplink`），手机上没有那个界面；
   * `url` 是真链接，Telegram 自己会把它变成可点。两者混用会得到一句做不到的话
   * （手机上点不动），所以提交期分四种情形拒收，见 `notificationSubmitPlan.ts`。
   */
  kind: 'open' | 'acknowledge' | 'dismiss' | 'snooze' | 'custom' | 'open-external'
  /**
   * 只在 `kind === 'open-external'` 时出现：**只收 http/https 绝对地址**。
   *
   * 中心那条按钮与手机推送末尾那一行用**同一个**地址（规范化后），两处不一致读者会以为推错了；
   * 正文模板里不许出现副本（中心会被两行截断）。
   */
  url?: string
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
  /**
   * **已经推送过的最高信号严重度**（契约 v2.45 §16.3.4）。它是状态、跟着记录走，
   * 不是「一天 N 次」这种常量：只有新提交严格更高才再推一次，推完抬到这里。
   * 缺省＝这条记录还没有成功推送过任何一档。
   */
  highestSeverity?: NotificationSignalSeverity
  /** 最近一次重投的时刻（UTC）。 */
  lastPushedAt?: string
}

/** 通道熔断状态：每个 channelId 一条，随通知 JSON 持久化、重启不丢窗口。 */
export type NotificationPushBackoff = {
  channelId: string
  failures: number
  pausedUntil: string | null
}

/**
 * 成品句子（契约 v2.56）：源头用骨架 + 全部事实拼好，**平台只挑一份**。
 *
 * 三段都要：手机上 `formatPushText` 会合并 title + body + reason，`reason` 留键就等于
 * 在推送路径上留一处读时拼装——那正是这次换模型要拆掉的东西。
 * **动作标签不进来**：那是按钮文案，由界面按 `labelKey` 出。
 */
export type NotificationContentByLanguage = {
  /**
   * 两种语言**都可缺席**——但至少要有 `edition.locale` 那一份（那一期只有一种语言的例外，
   * 契约 v2.56）。没有 `edition` 的事件（信号、宏观、失败、时区）**两份都要齐**，由提交期判定把关。
   */
  'zh-CN'?: { title: string; body: string; reason: string }
  'en-US'?: { title: string; body: string; reason: string }
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
  /**
   * 老形状：标题文案键 + 参数，读取时按语言解析。**新记录不再写它**（写成品句子），
   * 双形状兼容到「库里 `titleKey` 非空记录数 = 0」为止（契约 v2.56 §3.3）。
   */
  titleKey?: NotificationCopyKey
  /** 新形状：源头拼好的成品句子，每种语言一份；平台只按当前语言挑，不拼不改。 */
  rendered?: NotificationContentByLanguage
  titleParams?: Record<string, NotificationCopyParam>
  bodyKey?: NotificationCopyKey
  bodyParams?: Record<string, NotificationCopyParam>
  /** 「为什么推了」的键与参数；端口拿解析后的句子，不自己拼。 */
  reasonKey?: NotificationCopyKey
  reasonParams?: Record<string, NotificationCopyParam>
  /**
   * **首次定档**：建记录时写一次，是「这次真正排上了哪几档」的快照；合并**不改写**（它是事实，不是状态）。
   * 老记录没有这一项时，读侧按 `channels + delivery.push` 推断一次——那是兼容用的推断，不是权威。
   */
  appliedLevels?: readonly NotificationApprovedLevel[]
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

/**
 * 通知自带动作在界面上的样子：标签已经是句子，不再是键。
 *
 * 为什么动作标签也要在主进程解析：渲染层一旦拿得到 `labelKey`，它就得有一张文案表去查——
 * 那张表正是 `notification.event.…` 被印到屏幕上的入口。所以键与引用都不进这份载荷。
 */
export type NotificationCenterAction = Omit<NotificationAction, 'labelKey' | 'labelRef'> & { label: string }

/**
 * 渲染层看到的一条通知（落地约束 v1.2 §1）：句子已由主进程在**读的那一刻**按当前界面语言解析。
 *
 * 键与参数**不在这份载荷里**——渲染层拿不到键，就印不出 `notification.event.…` 这种串，
 * 不靠评审记得。记录本身仍存 ref（契约 §3.3），所以切了语言，历史通知跟着变。
 *
 * `category` 与 `createdAt` 是**结构字段**，不参与文案解析：文案解析失败、整条降级成兜底句时，
 * 它们照旧在——否则「点开看详情」只剩一句兜底句，等于点了没反应。
 */
export type NotificationCenterItem = Omit<
  SafeNotificationRecord,
  'titleKey' | 'titleParams' | 'bodyKey' | 'bodyParams' | 'reasonKey' | 'reasonParams' | 'actions'
> & {
  /** 标题句；解析不到时是平台兜底句，**不是键**。 */
  title: string
  /** 正文句；没有正文是空串。 */
  body: string
  /** 「为什么推了」的解析句；没有就省略，不拿键顶上。 */
  reason?: string
  /** 动作标签已解析；解析不出标签的动作整条不出现（按不动的按钮不该摆在读者面前）。 */
  actions: NotificationCenterAction[]
  /**
   * 类型标签（契约 v2.34）。目录里已经没有这条事件（旧记录、已撤事件）时没有标签——
   * 界面不编一个，缺失本身是事实。
   */
  category?: NotificationCategory
  /**
   * 「今天一共发生过 N 次」那一句；**只在真的合并过时才有**（`occurrenceCount > 1`）。
   *
   * 恒出会让读者看到「共 1 次」——一个他没见过的第二个东西，比不显示更糟。
   * 句子在主进程解析，渲染层拿到的就是这句话，不自己拼数。
   */
  occurrenceLabel?: string
}

export type NotificationRequest = {
  /** 成品句子（新形状）：合并路径靠它把「正文取最新」也覆盖到成品记录上。 */
  rendered?: NotificationContentByLanguage
  owner: 'platform' | 'product'
  productId?: string
  sourceId: string
  /** 兼容旧生产者的迁移字段；新提交路径一定带事件 id（契约 §3.2）。 */
  eventTypeId?: string
  /** 标题文案键；句子由 `platform/i18n/notificationCopy.ts` 解析（切语言时历史通知跟着变）。 */
  titleKey: NotificationCopyKey
  titleParams?: Record<string, NotificationCopyParam>
  bodyKey?: NotificationCopyKey
  bodyParams?: Record<string, NotificationCopyParam>
  /** 「为什么推了」的键与参数；端口拿解析后的句子，不自己拼。 */
  reasonKey?: NotificationCopyKey
  reasonParams?: Record<string, NotificationCopyParam>
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
  items: NotificationCenterItem[]
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
   * 事件级 / 组级的表面选择（契约 §5.5 第三层）：键是**组键**（同一件事的两条共用一个）或事件 id。
   *
   * 它是读者能选的**最后一道**，只能收窄：没批的面存进来也会被夹掉。缺省（没这个键）＝读者还没
   * 表过态，按批准表允许的来——不是「全关」，否则刚打开提醒就会一条都收不到。
   */
  surfaceSelections?: Readonly<Record<string, NotificationSurfaceSelection>>
  /**
   * 出站通道（**过渡字段**）：设置页已经不再读写它；投递端口在「取唯一启用频道」落地前
   * 仍按它取目标。第六组改完端口后，这个字段随 AppSettings 一并删除。
   */
  /**
   * 历史遗留的「推到哪条通道」字段（技术方案 §1）。
   *
   * @deprecated **没有任何生产代码会写它，运行路径也不再读它**——目标改由
   * `resolvePushChannel(channels)` 从「恰好一条 `runtime-ready`」派生。字段保留只为旧文件可读
   * （`normalize` 不删），等确认无消费者（`grep -rn 'push.channelId'` 只剩归一与类型）再单独一笔删。
   * **不要**在它上面再加任何读点：两个来源描述同一件事，迟早出现「发到一条已停用的通道」。
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
    surfaceSelections: Object.freeze({}),
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

// 提交这一侧的形状搬到自己的模块（契约同一节）；消费方仍从这里取，导入面不变。
export type {
  NotificationDedupeVars,
  NotificationSubmitRequest,
  NotificationSuppressedLevel,
  NotificationSubmitOutcome
} from './notificationSubmitContracts'

export type { NotificationDiagnosticsEntry, NotificationDiagnosticsSink } from './notificationDiagnostics'
