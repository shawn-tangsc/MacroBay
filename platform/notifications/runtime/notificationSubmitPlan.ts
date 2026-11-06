/**
 * 新提交路径的**纯规划器**（契约 §3.2 / §4 / §5.1 / §7 / §16 / §6.1）。
 *
 * 这里只回答「这条提交会变成什么」：拒收、抑制、合并、还是新建一条；以及新建时
 * 每个表面该不该排进投递队列。**不碰文件、不发通知、不维护版本**——那些由 runtime 做，
 * 这样规划器的每条分支都能直接用构造数据测，不需要一个运行中的通知文件。
 *
 * 现在的边界：目录、批准表、订阅表、键构造函数都从注入进来；`productId` 由目录给，
 * 不从请求读——请求改不了自己的归属（§16.2b）。
 */
import type { NotificationCopyKey } from '../../i18n/notificationCopy'
import {
  type NotificationApprovedLevel,
  type NotificationEventCatalog,
  type NotificationEventCatalogEntry
} from '../contracts/notificationEventCatalog'
import {
  isNotificationDedupeBuilderId,
  notificationDedupeBuilders
} from '../contracts/notificationDedupeKeys'
import type {
  NotificationChannel,
  NotificationDedupeVars,
  NotificationRecord,
  NotificationRequest,
  NotificationRuntimeSettings,
  NotificationSignalSeverity,
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '../contracts/notificationContracts'
import { createNotificationId } from '../store/notificationStore'

export type NotificationSubmitPlan =
  | { kind: 'rejected'; outcome: Extract<NotificationSubmitOutcome, { kind: 'rejected' }> }
  | {
      kind: 'new'
      record: NotificationRecord
      levels: readonly NotificationApprovedLevel[]
      /** 旧提交形状，供 `mergeDuplicateNotification` 的字段读取（不用于标题/动作）。 */
      incoming: NotificationRequest
      outcome: Extract<NotificationSubmitOutcome, { kind: 'accepted' }>
    }
  | {
      kind: 'merge'
      duplicate: NotificationRecord
      incoming: NotificationRequest
      /** `condition` 窗口内再提交算「又一次」；`occurrence` 的重复上报不计数。 */
      incrementCount: boolean
    }

export type NotificationSubmitPlanInput = {
  catalog: NotificationEventCatalog
  settings: NotificationRuntimeSettings
  /** 平台支不支持桌面通知（`Notification.isSupported()`）。判定只认这一个外部事实。 */
  desktopSupported: boolean
  request: NotificationSubmitRequest
  duplicate?: NotificationRecord
  now: string
}

/**
 * 一次提交会打扰哪些表面（契约 §5.1 / 设计 §2）。
 *
 * 中心恒真：它就是铃铛里那份记录。桌面与提示**互斥**，桌面优先——这条互斥只写在这里，
 * 投递层不许再写第二套（设计 §2 硬规矩 2）。
 *
 * 桌面「可用」这里只判两件能判的事实：开关开、平台支持。第三种（`show()` 抛错/返回
 * `ok:false`）只能投递时才知道，由投递层退回提示并记一条「桌面没有弹出来」——见 P7。
 */
export type NotificationSurfacePlan = Readonly<{ desktop: boolean; toast: boolean }>

export function planNotificationSurfaces(
  entry: NotificationEventCatalogEntry,
  settings: NotificationRuntimeSettings,
  desktopSupported: boolean
): NotificationSurfacePlan {
  const desktopApproved = entry.approvedDisruptionLevels.includes('desktop')
  const toastApproved = entry.approvedDisruptionLevels.includes('toast')
  const desktop = desktopApproved && settings.desktopEnabled && desktopSupported
  // 桌面优先：桌面真能弹时，这条不再另外在应用内重复一次。
  return Object.freeze({ desktop, toast: desktop ? false : toastApproved && settings.toastEnabled })
}

export function planNotificationSubmit(input: NotificationSubmitPlanInput): NotificationSubmitPlan {
  const entry = input.catalog.get(input.request.eventTypeId)
  if (entry === undefined) {
    return rejected('unknown-event-type', `notification event "${input.request.eventTypeId}" is not registered`)
  }
  if (entry.deprecated === true) {
    return rejected('unknown-event-type', `notification event "${entry.id}" is deprecated`)
  }
  if (entry.requiresUserAction && input.request.actions.length === 0) {
    return rejected('missing-action', `notification event "${entry.id}" requires at least one action`)
  }

  // 信号严重度只认三档闭集：类型层挡得住编译期，运行期还要挡一次（IPC / 生产者 / JS 调用点）。
  // 放行 `critical` 会让 `highestSeverity` 一次抬到顶，之后永不再升级——而且看起来一切正常。
  if (input.request.signalSeverity !== undefined && !isSignalSeverity(input.request.signalSeverity)) {
    return rejected(
      'invalid-signal-severity',
      `notification event "${entry.id}" received signalSeverity "${String(input.request.signalSeverity)}"; expected low | medium | high`
    )
  }

  const bodyKey = resolveBodyKey(entry, input.request)
  if (bodyKey === null) {
    return rejected('unknown-body-variant', `notification event "${entry.id}" has no body variant "${input.request.bodyVariant ?? ''}"`)
  }

  const rawDedupeKey = resolveDedupeKey(entry, input.request.dedupeVars)
  if (rawDedupeKey === undefined) {
    return rejected('missing-dedupe-key', `notification event "${entry.id}" did not expand to a dedupe key`)
  }
  if (isInvalidDedupeVars(entry, input.request.dedupeVars)) {
    return rejected('invalid-dedupe-vars', `notification event "${entry.id}" received dedupe vars for another builder`)
  }
  const crossProduct = crossProductPrefix(input.catalog, rawDedupeKey, entry.productId)
  if (crossProduct !== undefined) {
    return rejected('cross-product-key', `dedupe key belongs to "${crossProduct}", not "${entry.productId}"`)
  }
  const dedupeKey = `${entry.productId}|${rawDedupeKey}`

  const surfaces = planNotificationSurfaces(entry, input.settings, input.desktopSupported)
  const levels = effectiveLevels(entry, surfaces)
  const incoming = toLegacyRequest(entry, input.request, dedupeKey, levels, bodyKey)
  if (input.duplicate) {
    return {
      kind: 'merge',
      duplicate: input.duplicate,
      incoming,
      incrementCount: entry.dedupeUnit === 'condition'
    }
  }

  const record = createRecord(entry, input.request, dedupeKey, levels, surfaces, bodyKey, input.now)
  return {
    kind: 'new',
    record,
    levels,
    incoming,
    outcome: { kind: 'accepted', recordId: record.id, levels }
  }
}

/** 运行期校验：值必须落在三档闭集里（不被 `as` 或 JS 调用点绕过去）。 */
function isSignalSeverity(value: unknown): value is NotificationSignalSeverity {
  return value === 'low' || value === 'medium' || value === 'high'
}

function rejected(
  reason: Extract<NotificationSubmitOutcome, { kind: 'rejected' }>['reason'],
  message: string
): Extract<NotificationSubmitPlan, { kind: 'rejected' }> {
  return { kind: 'rejected', outcome: { kind: 'rejected', reason, message } }
}

/** 正文变体：声明了变体表就必须选中一个；没声明时 `bodyVariant` 忽略。 */
function resolveBodyKey(entry: NotificationEventCatalogEntry, request: NotificationSubmitRequest): string | undefined | null {
  if (!entry.bodyKeyByVariant) return entry.bodyKey
  const variant = request.bodyVariant
  if (variant === undefined) return null
  return entry.bodyKeyByVariant[variant] ?? null
}

function isInvalidDedupeVars(entry: NotificationEventCatalogEntry, vars: NotificationDedupeVars): boolean {
  if (entry.dedupeKeyTemplate !== undefined) return vars.builder !== 'template'
  if (entry.dedupeKeyBuilder === undefined) return true
  return vars.builder !== entry.dedupeKeyBuilder
}

function resolveDedupeKey(entry: NotificationEventCatalogEntry, vars: NotificationDedupeVars): string | undefined {
  if (entry.dedupeKeyTemplate !== undefined) {
    if (vars.builder !== 'template') return undefined
    const expanded = entry.dedupeKeyTemplate.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
      const value = vars.vars[name]
      return value === undefined ? placeholder : value
    })
    return expanded.includes('{') ? undefined : expanded
  }
  if (entry.dedupeKeyBuilder === undefined || !isNotificationDedupeBuilderId(entry.dedupeKeyBuilder)) {
    return undefined
  }
  if (vars.builder !== entry.dedupeKeyBuilder) return undefined
  if (vars.builder === 'moduleSignal') return notificationDedupeBuilders.moduleSignal(vars)
  if (vars.builder === 'sourceIssue') return notificationDedupeBuilders.sourceIssue({ sourceId: vars.sourceId })
  return undefined
}

/**
 * 跨产品同键（§16.2b）：键在展开时被手工带上了 `productId|` 前缀，且那个产品真实存在、
 * 不是本事件的声明者 → 直接拒。正常构造的键没有这个前缀，由平台统一加。
 */
function crossProductPrefix(
  catalog: NotificationEventCatalog,
  rawDedupeKey: string,
  ownerProductId: string
): string | undefined {
  const separator = rawDedupeKey.indexOf('|')
  if (separator <= 0) return undefined
  const claimed = rawDedupeKey.slice(0, separator)
  if (claimed === ownerProductId) return undefined
  return catalog.list().some((entry) => entry.productId === claimed) ? claimed : undefined
}

/**
 * 生效表面 = 批准 ∩ 开关（桌面优先互斥）。手机那一档仍按批准：**投递层**还要再判
 * 「频道事件表勾了 ∩ 频道启用 ∩ 频道可用」，两处各判自己那一半，不在这里替它猜。
 */
function effectiveLevels(
  entry: NotificationEventCatalogEntry,
  surfaces: NotificationSurfacePlan
): readonly NotificationApprovedLevel[] {
  const levels: NotificationApprovedLevel[] = ['center']
  if (surfaces.desktop) levels.push('desktop')
  if (surfaces.toast) levels.push('toast')
  if (entry.approvedDisruptionLevels.includes('channel')) levels.push('channel')
  return Object.freeze(levels)
}

function toLegacyRequest(
  entry: NotificationEventCatalogEntry,
  request: NotificationSubmitRequest,
  dedupeKey: string,
  levels: readonly NotificationApprovedLevel[],
  bodyKey: string | undefined
): NotificationRequest {
  const localChannels = levels.filter((level): level is NotificationChannel =>
    level === 'center' || level === 'toast' || level === 'desktop'
  )
  return {
    owner: entry.productId === 'platform' ? 'platform' : 'product',
    ...(entry.productId === 'platform' ? {} : { productId: entry.productId }),
    sourceId: entry.id,
    eventTypeId: entry.id,
    titleKey: entry.titleKey as NotificationCopyKey,
    ...(request.titleParams === undefined ? {} : { titleParams: request.titleParams }),
    ...(bodyKey === undefined ? {} : { bodyKey: bodyKey as NotificationCopyKey }),
    ...(request.bodyParams === undefined ? {} : { bodyParams: request.bodyParams }),
    reasonKey: entry.reasonKey as NotificationCopyKey,
    ...(request.reasonParams === undefined ? {} : { reasonParams: request.reasonParams }),
    severity: request.severity ?? 'info',
    priority: 'normal',
    requestedChannels: localChannels.length > 0 ? [...localChannels] : ['center'],
    ...(request.actions.length === 0 ? {} : { actions: [...request.actions] }),
    ...(request.deeplink === undefined ? {} : { deeplink: request.deeplink }),
    dedupeKey,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    ...(request.edition === undefined ? {} : { edition: request.edition })
  }
}

function createRecord(
  entry: NotificationEventCatalogEntry,
  request: NotificationSubmitRequest,
  dedupeKey: string,
  levels: readonly NotificationApprovedLevel[],
  surfaces: NotificationSurfacePlan,
  bodyKey: string | undefined,
  now: string
): NotificationRecord {
  // `deliver: false`：只落记录、不排任何投递面；记录内容与 `occurrenceCount` 照常。
  const deliver = request.deliver !== false
  const localChannels = levels.filter((level): level is NotificationChannel =>
    level === 'center' || level === 'toast' || level === 'desktop'
  )
  const delivery: NotificationRecord['delivery'] = {}
  if (deliver) {
    // 互斥在这里落成数据：两个表面**不许同时**有交付条目（设计 §2）。
    if (surfaces.desktop) delivery.desktop = { state: 'queued', at: now }
    else if (surfaces.toast) delivery.toast = { state: 'queued', at: now }
    if (levels.includes('channel')) delivery.push = { state: 'queued', at: now }
  }
  return {
    id: createNotificationId(),
    owner: entry.productId === 'platform' ? 'platform' : 'product',
    ...(entry.productId === 'platform' ? {} : { productId: entry.productId }),
    sourceId: entry.id,
    eventTypeId: entry.id,
    delivery,
    titleKey: entry.titleKey as NotificationCopyKey,
    ...(request.titleParams === undefined ? {} : { titleParams: request.titleParams }),
    ...(bodyKey === undefined ? {} : { bodyKey: bodyKey as NotificationCopyKey }),
    ...(request.bodyParams === undefined ? {} : { bodyParams: request.bodyParams }),
    reasonKey: entry.reasonKey as NotificationCopyKey,
    ...(request.reasonParams === undefined ? {} : { reasonParams: request.reasonParams }),
    severity: request.severity ?? 'info',
    priority: 'normal',
    channels: localChannels.length > 0 ? [...localChannels] : ['center'],
    state: 'unread',
    ...(request.deeplink === undefined ? {} : { deeplink: request.deeplink }),
    actions: [...request.actions],
    dedupeKey,
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
    ...(request.edition === undefined ? {} : { edition: request.edition }),
    occurrenceCount: 1,
    createdAt: now,
    updatedAt: now
  }
}
