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
  NotificationAction,
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
import { isInsideQuietHours } from './quietHours'
import { resolveSubmitSurfaces, type NotificationSurfaceDecision } from './notificationSurfaceDecision'
import { applySurfaceNarrowing, effectiveLevels } from './notificationSurfaceLevels'
import { actionLabelRejection } from './notificationActionLabelRejection'


export type NotificationSubmitPlan =
  | { kind: 'rejected'; outcome: Extract<NotificationSubmitOutcome, { kind: 'rejected' }> }
  | {
      kind: 'new'
      record: NotificationRecord
      levels: readonly NotificationApprovedLevel[]
      /**
       * 同一组两条通知的存量选择对不上（历史数据/半次写入）：三面已按「都关」处理，
       * 调用方**必须**记一行诊断——否则「都关」看起来跟读者自己关掉一模一样。
       */
      surfaceConflict: boolean
      /** 旧提交形状，供 `mergeDuplicateNotification` 的字段读取（不用于标题/动作）。 */
      incoming: NotificationRequest
      outcome: Extract<NotificationSubmitOutcome, { kind: 'accepted' }>
    }
  | {
      kind: 'merge'
      /** 本次提交真正排上的档位（用于判「第二次是否更宽」）。 */
      levels: readonly NotificationApprovedLevel[]
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
  /** 今天（**UTC 自然日**）这个事件已落几条、最近一次何时：由调用方从记录数出，不另设计数器。 */
  sameEventToday?: Readonly<{ count: number; lastOccurredAt: string | null }>
  now: string
  /** 读者时区（`clock.timeZone()`）：免打扰按它算；拿不到时判 `unknown` 且**不静音**（宁可多响一次）。 */
  timeZone: string
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
  // 「看原文」动作的四条边界（契约 §7.5 ⑫）：各给一个具名原因，别让它落成「按钮有时在有时不在」。
  const badExternalAction = invalidExternalAction(input.request.actions)
  if (badExternalAction !== undefined) {
    return rejected(badExternalAction.reason, `notification event "${entry.id}" ${badExternalAction.message}`)
  }
  const badActionLabel = actionLabelRejection(input.request.actions, entry.productId)
  if (badActionLabel !== undefined) return { kind: 'rejected', outcome: badActionLabel }

  // 信号严重度只认三档闭集：类型层挡得住编译期，运行期还要挡一次（IPC / 生产者 / JS 调用点）。
  // 放行 `critical` 会让 `highestSeverity` 一次抬到顶，之后永不再升级——而且看起来一切正常。
  if (input.request.signalSeverity !== undefined && !isSignalSeverity(input.request.signalSeverity)) {
    return rejected(
      'invalid-signal-severity',
      `notification event "${entry.id}" received signalSeverity "${String(input.request.signalSeverity)}"; expected low | medium | high`
    )
  }

  // 源头没拼完：成品缺语言或某段空串 → **拒收，不落库**（契约 v2.56）。
  // 降级是「发出去了但少一句」，拒收是「根本不该发」；源头没拼完照发，读者拿到的就是半句话。
  if (input.request.rendered !== undefined) {
    const missing = missingRenderedField(input.request.rendered, input.request.edition?.locale)
    if (missing !== undefined) {
      return rejected('copy-missing', `notification event "${entry.id}" submitted incomplete copy: ${missing}`)
    }
  }

  // 成品句子在手时**根本不读键**：变体表、正文键、理由键都不参与（契约 v2.56）。
  // 否则「声明了变体表却交成品」会被 bodyVariant 那道门拒掉，而且记录里会多挂一份已作废的正文来源。
  const bodyKey = input.request.rendered !== undefined ? undefined : resolveBodyKey(entry, input.request)
  if (bodyKey === null) {
    return rejected('unknown-body-variant', `notification event "${entry.id}" has no body variant "${input.request.bodyVariant ?? ''}"`)
  }
  // 标题与理由的变体：与正文同形、同一条规则（声明了变体表就必须给对名字，不退回默认键）。
  // 退回默认键会印出一句措辞对不上情形的话（无预期值却写「高于预期」），那正是要修的缺陷。
  const titleKey = resolveKeyByVariant(entry.titleKey, entry.titleKeyByVariant, input.request.titleVariant)
  if (titleKey === null) {
    return rejected('unknown-body-variant', `notification event "${entry.id}" has no title variant "${input.request.titleVariant ?? ''}"`)
  }
  const reasonKey = resolveKeyByVariant(entry.reasonKey, entry.reasonKeyByVariant, input.request.reasonVariant)
  if (reasonKey === null) {
    return rejected('unknown-body-variant', `notification event "${entry.id}" has no reason variant "${input.request.reasonVariant ?? ''}"`)
  }

  // 旧的日内键形状（带时间桶）现在构造不出键；单列一个原因，别让它落成「没有键」这种含糊说法。
  if (usesStaleIntradayBucketShape(input.request.dedupeVars)) {
    return rejected(
      'stale-signal-dedupe-vars',
      `notification event "${entry.id}" received a moduleSignal intraday key with observedAt/bucketMs; the intraday key carries no time (contract v2.43 §7.4)`
    )
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
  // 测试与真实**永不互相吞掉**：同一个键、两个域（§2），前缀只在这一处加。
  const dedupeKey = input.request.namespace === 'test' ? `test:${entry.productId}|${rawDedupeKey}` : `${entry.productId}|${rawDedupeKey}`

  // 当日上限与最小间隔：只在**会新建记录**的提交上判（合并进已有那一条不算新的一条）。
  // 数从记录里来（`sameEventToday`），这一处只负责比大小——所以平台与生产者不会各有一套阈值。
  // `dailyLimit` 是**可选**的：没写就不判。0′（读者手动点的那次失败）就是靠「没写」拿到豁免，
  // 不是靠某个特判分支——特判会在下一次改造里被顺手删掉。
  if (input.duplicate === undefined) {
    const sentToday = input.sameEventToday?.count ?? 0
    if (entry.dailyLimit !== undefined && sentToday >= entry.dailyLimit) {
      return rejected(
        'daily-limit-reached',
        `notification event "${entry.id}" already sent ${sentToday} of ${entry.dailyLimit} today (UTC); this one is refused, not silently dropped`
      )
    }
    const last = input.sameEventToday?.lastOccurredAt
    if (entry.minimumGapMs !== undefined && typeof last === 'string') {
      const elapsed = Date.parse(input.now) - Date.parse(last)
      if (Number.isFinite(elapsed) && elapsed < entry.minimumGapMs) {
        return rejected(
          'minimum-gap-active',
          `notification event "${entry.id}" sent ${elapsed}ms ago; the declared gap is ${entry.minimumGapMs}ms`
        )
      }
    }
  }

  // 读者选择 + 三个面：判定在 `notificationSurfaceDecision.ts`（契约 §5.1 / §5.5）。
  const { surfaces, conflict: surfaceConflict } = resolveSubmitSurfaces({
    entry,
    list: () => input.catalog.list(),
    settings: input.settings,
    desktopSupported: input.desktopSupported
  })
  // 免打扰时段**只进中心**：手机这一档在这里摘掉（验收 S6 / 用户测试单第 18 条
  // 「只进中心，不弹、不发手机」）。以前只静音本机三种打扰，手机照样推——那是缺陷，不是设计。
  const insideQuietHours = isInsideQuietHours(input.settings, {
    now: () => new Date(input.now),
    timeZone: () => input.timeZone
  })
  const approved = effectiveLevels(surfaces, !insideQuietHours)
  // 按次收窄（`narrowedDisruptionLevels`）：**只许收窄、不许放大**；`center` 是平台必达，传的数组里
  // 没有它也保留。不传＝与今天逐字一致（下面那行不会改变任何东西）。
  const narrowed = input.request.narrowedDisruptionLevels
  if (narrowed !== undefined) {
    // 收窄只能**变少**、不能**变出**：出现批准表没批的档位就是生产者写错了，**拒收**，
    // 不静默求交（那会让生产者以为那一档发出去了）。与「申请了未批准的档位」同一个处理。
    const unapproved = narrowed.filter((level) => !approved.includes(level))
    if (unapproved.length > 0) {
      return rejected('surface-not-approved', `notification event "${entry.id}" narrowed to an unapproved level: ${unapproved.join(', ')}`)
    }
  }
  // `center` 不是可被收窄的面，是必达记录：传不传它都在，所以 `['channel']` 的含义就是「channel + center」。
  const levels = narrowed === undefined
    ? approved
    : approved.filter((level) => level === 'center' || narrowed.includes(level))
  // 地址规范化**只做一次**，写进记录：之后中心按钮与手机末尾那一行读的是同一个值。
  // 两端各 trim 一次不算保证——一个带首尾空白的地址会「中心能开、手机打不开」，读者只会觉得推错了。
  const request: NotificationSubmitRequest = { ...input.request, actions: input.request.actions.map(normalizeActionUrl) }
  const incoming = toLegacyRequest(entry, request, dedupeKey, levels, bodyKey, titleKey, reasonKey)
  if (input.duplicate) {
    return {
      kind: 'merge',
      levels,
      duplicate: input.duplicate,
      incoming,
      incrementCount: entry.dedupeUnit === 'condition'
    }
  }

  const record = createRecord(entry, request, dedupeKey, levels, surfaces, bodyKey, input.now, titleKey, reasonKey)
  return {
    kind: 'new',
    record,
    levels,
    surfaceConflict,
    incoming,
    outcome: { kind: 'accepted', recordId: record.id, levels }
  }
}

/** 运行期校验：值必须落在三档闭集里（不被 `as` 或 JS 调用点绕过去）。 */
function isSignalSeverity(value: unknown): value is NotificationSignalSeverity {
  return value === 'low' || value === 'medium' || value === 'high'
}

/**
 * `open-external` 的四条硬边界（契约 §7.5 ⑫）。
 *
 * 为什么在提交入口拒收而不是在渲染层兜底：静默丢掉一个动作，读者看到的是「按钮莫名其妙没了」；
 * 而把 URL 塞进正文的替代办法会让中心那条被两行截断——两种都比当场拒收更难查。
 * 消息里**只回协议名**不回整条 URL：正文里可能带一次性参数，日志不该多存一份。
 */
function invalidExternalAction(
  actions: readonly NotificationAction[]
): { reason: Extract<NotificationSubmitOutcome, { kind: 'rejected' }>['reason']; message: string } | undefined {
  for (const action of actions) {
    const url = typeof action.url === 'string' ? action.url.trim() : undefined
    if (action.kind !== 'open-external') {
      if (action.url !== undefined) {
        return {
          reason: 'url-without-external-action',
          message: `action "${action.id}" carries a url but its kind is "${action.kind}"; only open-external points outside`
        }
      }
      continue
    }
    if (url === undefined || url.length === 0) {
      return { reason: 'external-action-without-url', message: `action "${action.id}" is open-external but has no url` }
    }
    if (!isPublicWebUrl(url)) {
      return {
        reason: 'external-action-bad-url',
        message: `action "${action.id}" has a url that is not an absolute http(s) address (${url.split(':')[0] ?? ''}:)`
      }
    }
    if (action.deeplink !== undefined) {
      return {
        reason: 'external-action-with-deeplink',
        message: `action "${action.id}" is open-external and also carries a deeplink; an in-app landing cannot be opened on a phone`
      }
    }
  }
  return undefined
}

/** 只认 http/https 且必须带主机名：`javascript:`、`file:`、`http:foo`、相对路径一律不算。 */
function isPublicWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
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

/**
 * 标题与理由的变体解析，规则与 `bodyVariant` **完全同形**——三种键不许两套规则。
 *
 * 返回 `null` 表示「声明了变体表但请求没给、或给了不存在的名字」：**拒收，不退回默认键**。
 * 退回默认键的后果是读者看到一句措辞对不上情形的话（无预期值却印「高于预期」），
 * 而那正是这批改动要修的缺陷；宁可少发一条，也不发一句自相矛盾的。
 */
function resolveKeyByVariant(
  base: string,
  variants: Readonly<Record<string, string>> | undefined,
  variant: string | undefined
): string | null {
  if (variants === undefined) return base
  if (variant === undefined) return null
  return variants[variant] ?? null
}

/**
 * 成品完整性（契约 v2.56 + 首席 2026-11-06 裁定）：
 *
 * - **带 `edition.locale`**：只要求**那一份**三段齐全。那一期只有一种语言是合法状态，
 *   硬凑第二种语言就是「英文成品里塞中文导读」——假齐全，比缺更糟。
 *   `edition.locale` 不是 `zh-CN`/`en-US` → 拒收（**不许当成「没有 edition」默默走读者语言**，
 *   那会让一条错数据看着像正常）。
 * - **不带 `edition`**（信号、宏观、失败、时区）：两语言都要齐，与今天一致。
 *
 * 返回第一个缺口（回执与排查都用它），完整则 `undefined`。
 */
function missingRenderedField(
  rendered: NonNullable<NotificationSubmitRequest['rendered']>,
  editionLocale: string | undefined
): string | undefined {
  const requirement: readonly ('zh-CN' | 'en-US')[] = editionLocale === undefined
    ? ['zh-CN', 'en-US']
    : editionLocale === 'zh-CN' || editionLocale === 'en-US'
      ? [editionLocale]
      : []
  if (requirement.length === 0) return `edition.locale "${String(editionLocale)}"`
  for (const language of requirement) {
    const entry = rendered[language]
    if (entry === undefined) return `${language}.title`
    for (const field of ['title', 'body', 'reason'] as const) {
      const value = entry[field]
      if (typeof value !== 'string' || value.trim().length === 0) return `${language}.${field}`
    }
  }
  return undefined
}

/** 日内键不许带时间：带了就是旧口径残留，拒收并给具名原因。 */
function usesStaleIntradayBucketShape(vars: NotificationDedupeVars): boolean {
  if (vars.builder !== 'moduleSignal' || vars.cadence !== 'intraday') return false
  return 'observedAt' in vars || 'bucketMs' in vars
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

/**
 * 「看原文」的地址在**进记录那一刻规范化一次**，之后中心按钮与手机末尾那一行读的是同一个值。
 *
 * 两端各 trim 一次不算保证：一个带首尾空白的地址，在中心能打开、在手机上打不开，读者会以为推错了
 * （界面规范 §3.2 的硬要求是「两边必须是同一个地址」）。所以规范化只做一次，写在记录上。
 */
function normalizeActionUrl(action: NotificationAction): NotificationAction {
  if (action.kind !== 'open-external' || typeof action.url !== 'string') return action
  return { ...action, url: action.url.trim() }
}

function toLegacyRequest(
  entry: NotificationEventCatalogEntry,
  request: NotificationSubmitRequest,
  dedupeKey: string,
  levels: readonly NotificationApprovedLevel[],
  bodyKey: string | undefined,
  titleKey: string,
  reasonKey: string
): NotificationRequest {
  const localChannels = levels.filter((level): level is NotificationChannel =>
    level === 'center' || level === 'toast' || level === 'desktop'
  )
  return {
    owner: entry.productId === 'platform' ? 'platform' : 'product',
    ...(entry.productId === 'platform' ? {} : { productId: entry.productId }),
    sourceId: entry.id,
    eventTypeId: entry.id,
    titleKey: titleKey as NotificationCopyKey,
    ...(request.titleParams === undefined ? {} : { titleParams: request.titleParams }),
    ...(bodyKey === undefined ? {} : { bodyKey: bodyKey as NotificationCopyKey }),
    ...(request.bodyParams === undefined ? {} : { bodyParams: request.bodyParams }),
    ...(request.rendered === undefined ? { reasonKey: reasonKey as NotificationCopyKey } : {}),
    ...(request.reasonParams === undefined ? {} : { reasonParams: request.reasonParams }),
    ...(request.rendered === undefined ? {} : { rendered: request.rendered }),
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
  surfaces: Readonly<{ desktop: boolean; toast: boolean }>,
  bodyKey: string | undefined,
  now: string,
  titleKey: string,
  reasonKey: string
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
    ...(request.rendered === undefined
      ? { titleKey: titleKey as NotificationCopyKey }
      : { rendered: request.rendered }),
    ...(request.titleParams === undefined ? {} : { titleParams: request.titleParams }),
    ...(bodyKey === undefined ? {} : { bodyKey: bodyKey as NotificationCopyKey }),
    ...(request.bodyParams === undefined ? {} : { bodyParams: request.bodyParams }),
    ...(request.rendered === undefined ? { reasonKey: reasonKey as NotificationCopyKey } : {}),
    ...(request.reasonParams === undefined ? {} : { reasonParams: request.reasonParams }),
    severity: request.severity ?? 'info',
    priority: 'normal',
    appliedLevels: [...levels],
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
