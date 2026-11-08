/**
 * 提交的**输入校验**（契约 §3.2 / §7.5⑫ / §16.2b）：事件目录、请求与去重键之间的对账。
 *
 * 从 `notificationSubmitPlan.ts` 抽出来的：那里已经顶到 500 行硬线，而这一段是一个完整概念——
 * 「这份提交写得对不对」，与「这条提交会变成什么」（合并 / 新建 / 拒收的编排）是两件事。
 * 行为零改动：函数逐字搬，只换了位置。
 */
import type { NotificationEventCatalog, NotificationEventCatalogEntry } from '../contracts/notificationEventCatalog'
import { isNotificationDedupeBuilderId, notificationDedupeBuilders } from '../contracts/notificationDedupeKeys'
import type {
  NotificationAction,
  NotificationApprovedLevel,
  NotificationDedupeVars,
  NotificationSignalSeverity,
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '../contracts/notificationContracts'

/** 运行期校验：值必须落在三档闭集里（不被 `as` 或 JS 调用点绕过去）。 */
export function isSignalSeverity(value: unknown): value is NotificationSignalSeverity {
  return value === 'low' || value === 'medium' || value === 'high'
}

/**
 * `open-external` 的四条硬边界（契约 §7.5 ⑫）。
 *
 * 为什么在提交入口拒收而不是在渲染层兜底：静默丢掉一个动作，读者看到的是「按钮莫名其妙没了」；
 * 而把 URL 塞进正文的替代办法会让中心那条被两行截断——两种都比当场拒收更难查。
 * 消息里**只回协议名**不回整条 URL：正文里可能带一次性参数，日志不该多存一份。
 */
export function invalidExternalAction(
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
export function isPublicWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}


/** 正文变体：声明了变体表就必须选中一个；没声明时 `bodyVariant` 忽略。 */
export function resolveBodyKey(entry: NotificationEventCatalogEntry, request: NotificationSubmitRequest): string | undefined | null {
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
export function resolveKeyByVariant(
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
export function missingRenderedField(
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
export function usesStaleIntradayBucketShape(vars: NotificationDedupeVars): boolean {
  if (vars.builder !== 'moduleSignal' || vars.cadence !== 'intraday') return false
  return 'observedAt' in vars || 'bucketMs' in vars
}

export function isInvalidDedupeVars(entry: NotificationEventCatalogEntry, vars: NotificationDedupeVars): boolean {
  if (entry.dedupeKeyTemplate !== undefined) return vars.builder !== 'template'
  if (entry.dedupeKeyBuilder === undefined) return true
  return vars.builder !== entry.dedupeKeyBuilder
}

export function resolveDedupeKey(entry: NotificationEventCatalogEntry, vars: NotificationDedupeVars): string | undefined {
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
export function crossProductPrefix(
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

