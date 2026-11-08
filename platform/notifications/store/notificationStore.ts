import type { NotificationCopyKey } from '../../i18n/notificationCopy'
import type { NotificationCopyParam, NotificationCopyParamRef } from '../contracts/notificationCopyPort'
import type { NotificationCopyNumber } from '../contracts/notificationNumberFormat'
import {
  createDefaultNotificationRuntimeSettings,
  PRIORITY_RANK,
  SEVERITY_RANK,
  type NotificationChannel,
  type NotificationContentByLanguage,
  type NotificationDeliveryState,
  type NotificationPriority,
  type NotificationPushBackoff,
  type NotificationRecord,
  type NotificationRequest,
  type NotificationRuntimeSettings,
  type NotificationSeverity,
  type NotificationSignalSeverity,
  type NotificationState
} from '../contracts/notificationContracts'

/**
 * 熔断的每日写入计数：`<ownerId>|<UTC 日>` → 次数。
 *
 * 必须与记录存在同一份 JSON 里：被折叠的原文不落库，计数无法从记录反推；
 * 重启后若从零开始，熔断就永远触发不了。
 */
export type NotificationDailyCounters = Record<string, number>

export type NotificationStoreState = {
  records: NotificationRecord[]
  dailyCounters: NotificationDailyCounters
  /** 通道熔断：每个 channelId 一条；只由 runtime 写，端口只返回结果（runtime §8）。 */
  pushBackoff: Readonly<Record<string, NotificationPushBackoff>>
  /**
   * 供应商凭据的**判定状态**（P4a/P4b 用）：`ok` / `invalid` 两值，没有第三态。
   *
   * - 只存两值：读不到就说不知道，那就不发事件，不许用 `unknown` 占位；
   * - 只有**翻转**才发事件（invalid→invalid 不重复发）；
   * - 它是判定状态、不是记录：**剪枝不许抹掉**，否则重启后会再发一遍失效。
   */
  providerCredentialHealth: Readonly<Record<string, 'ok' | 'invalid'>>
}

export function createDefaultNotificationStoreState(): NotificationStoreState {
  return {
    records: [],
    dailyCounters: {},
    pushBackoff: {},
    providerCredentialHealth: {}
  }
}

let idCounter = 0

export function createNotificationId(prefix = 'notification'): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

export function resetNotificationIdCounterForTests(): void {
  idCounter = 0
}

/**
 * 丢弃原因（加载期）。必须可观测：静默丢记录会出现「计数器说有 13 条、库里 4 条，没人知道为什么」。
 */
export type NotificationRecordDropReason = 'not-an-object' | 'missing-id' | 'missing-source' | 'missing-copy'

export function normalizeNotificationRecord(value: unknown): NotificationRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NotificationRecord>
  // **`titleKey` 或 `rendered` 至少有一个就算有正文来源**（契约的双形状）：只认 `titleKey` 会把
  // 新形状（简报/分析结论/自检只给成品句）整条丢掉——丢完还会被持久化回去，等于永久删除。
  const hasCopy = (typeof candidate.titleKey === 'string' && candidate.titleKey.length > 0) || candidate.rendered !== undefined
  if (!candidate.id || !candidate.sourceId || !hasCopy) return null

  return {
    id: String(candidate.id),
    owner: candidate.owner === 'platform' ? 'platform' : 'product',
    productId: candidate.productId ? String(candidate.productId) : undefined,
    sourceId: String(candidate.sourceId),
    // 旧记录没有事件类型：归一化成保留值，**不回写**（契约 §6）。
    eventTypeId: candidate.eventTypeId ? String(candidate.eventTypeId) : 'legacy.untyped',
    mergedEventTypes: normalizeStringList(candidate.mergedEventTypes),
    delivery: normalizeDelivery(candidate.delivery),
    // 双形状（契约 v2.56）：有成品就直接用；没有才读老形状的键。两者都没有的记录按老形状空键处理，
    // 读取时落到兜底句——不认识就说不清，不假装读过。
    ...(normalizeRendered(candidate.rendered) === undefined
      ? {}
      : { rendered: normalizeRendered(candidate.rendered) }),
    ...(candidate.titleKey === undefined
      ? {}
      : { titleKey: String(candidate.titleKey) as NotificationCopyKey }),
    titleParams: normalizeTextParams(candidate.titleParams),
    bodyKey: candidate.bodyKey ? String(candidate.bodyKey) as NotificationCopyKey : undefined,
    bodyParams: normalizeTextParams(candidate.bodyParams),
    reasonKey: candidate.reasonKey ? String(candidate.reasonKey) as NotificationCopyKey : undefined,
    reasonParams: normalizeTextParams(candidate.reasonParams),
    severity: normalizeSeverity(candidate.severity),
    priority: normalizePriority(candidate.priority),
    channels: normalizeChannels(candidate.channels),
    state: normalizeState(candidate.state),
    deeplink: candidate.deeplink,
    actions: Array.isArray(candidate.actions) ? candidate.actions : [],
    dedupeKey: candidate.dedupeKey ? String(candidate.dedupeKey) : undefined,
    correlationId: candidate.correlationId ? String(candidate.correlationId) : undefined,
    safeMetadata:
      candidate.safeMetadata && typeof candidate.safeMetadata === 'object'
        ? (candidate.safeMetadata as Record<string, unknown>)
        : undefined,
    occurrenceCount: typeof candidate.occurrenceCount === 'number' ? Math.max(1, candidate.occurrenceCount) : 1,
    collapsedCount:
      typeof candidate.collapsedCount === 'number' && candidate.collapsedCount > 0
        ? Math.floor(candidate.collapsedCount)
        : undefined,
    createdAt: String(candidate.createdAt ?? new Date().toISOString()),
    updatedAt: String(candidate.updatedAt ?? candidate.createdAt ?? new Date().toISOString()),
    readAt: candidate.readAt ? String(candidate.readAt) : undefined,
    acknowledgedAt: candidate.acknowledgedAt ? String(candidate.acknowledgedAt) : undefined,
    dismissedAt: candidate.dismissedAt ? String(candidate.dismissedAt) : undefined,
    snoozedUntil: candidate.snoozedUntil ? String(candidate.snoozedUntil) : undefined,
    expiresAt: candidate.expiresAt ? String(candidate.expiresAt) : undefined
  }
}

/** 逐条归一化并**报告丢弃**：条数与原因分类，供加载路径留痕。 */
export function normalizeNotificationRecordsWithReport(value: unknown): {
  records: NotificationRecord[]
  dropped: readonly NotificationRecordDropReason[]
} {
  if (!Array.isArray(value)) return { records: [], dropped: [] }
  const records: NotificationRecord[] = []
  const dropped: NotificationRecordDropReason[] = []
  for (const raw of value) {
    const normalized = normalizeNotificationRecord(raw)
    if (normalized !== null) { records.push(normalized); continue }
    dropped.push(
      raw === null || typeof raw !== 'object'
        ? 'not-an-object'
        : !(raw as Partial<NotificationRecord>).id
          ? 'missing-id'
          : !(raw as Partial<NotificationRecord>).sourceId ? 'missing-source' : 'missing-copy'
    )
  }
  return { records, dropped }
}

export function normalizeNotificationStoreState(value: unknown): NotificationStoreState {
  const defaults = createDefaultNotificationStoreState()
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<NotificationStoreState>
  const records = Array.isArray(candidate.records)
    ? candidate.records.map(normalizeNotificationRecord).filter((record): record is NotificationRecord => Boolean(record))
    : []
  return {
    records,
    dailyCounters: normalizeDailyCounters(candidate.dailyCounters),
    pushBackoff: normalizePushBackoff(candidate.pushBackoff),
    // 只认两个值：别的（含旧文件里的脏数据）一律丢掉——没有「unknown」这个状态。
    providerCredentialHealth: normalizeCredentialHealth(candidate.providerCredentialHealth)
  }
}

/** 合并进来的事件类型：只收短字符串、去重；空列表等于没有。 */
function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
  return list.length > 0 ? list : undefined
}

/** 投递证据按表面各一条；坏形状整条丢掉，不猜一个状态（契约 §8）。 */
function normalizeDelivery(value: unknown): NotificationRecord['delivery'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const delivery: NotificationRecord['delivery'] = {}
  for (const surface of ['toast', 'popup', 'desktop', 'push'] as const) {
    const raw = (value as Record<string, unknown>)[surface]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const state = (raw as Record<string, unknown>).state
    if (state !== 'queued' && state !== 'sent-accepted' && state !== 'failed') continue
    const at = (raw as Record<string, unknown>).at
    if (typeof at !== 'string' || at.length === 0) continue
    const reason = (raw as Record<string, unknown>).reason
    const messageId = (raw as Record<string, unknown>).messageId
    delivery[surface] = {
      state,
      at,
      ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
      ...(typeof messageId === 'string' && messageId.length > 0 ? { messageId } : {})
    }
  }
  return delivery
}

/** 熔断状态：只收合法 channelId + 非负整数失败数 + null/UTC 时刻；坏条目丢掉。 */
function normalizePushBackoff(value: unknown): Readonly<Record<string, NotificationPushBackoff>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const backoff: Record<string, NotificationPushBackoff> = {}
  for (const [channelId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(channelId)) continue
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const failures = (raw as Record<string, unknown>).failures
    if (typeof failures !== 'number' || !Number.isFinite(failures) || failures < 0) continue
    const pausedUntil = (raw as Record<string, unknown>).pausedUntil
    if (pausedUntil !== null && (typeof pausedUntil !== 'string' || !Number.isFinite(Date.parse(pausedUntil)))) continue
    backoff[channelId] = {
      channelId,
      failures: Math.floor(failures),
      pausedUntil: pausedUntil as string | null
    }
  }
  return backoff
}

/**
 * 计数桶的键必须是 `<ownerId>|<YYYY-MM-DD>`、值必须是正整数：坏桶直接丢弃，
 * 否则一个 `NaN` 会让熔断永远不触发，而界面看不出任何异常。
 */
function normalizeDailyCounters(value: unknown): NotificationDailyCounters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const counters: NotificationDailyCounters = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^.+\|\d{4}-\d{2}-\d{2}$/.test(key)) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue
    counters[key] = Math.floor(raw)
  }
  return counters
}

/**
 * 文案参数：字面串，或一个**不带参数**的引用（契约 v2.40）。
 *
 * 两条边界都在这里守：字面量必须短（进的是任务名这类实体名，不是日志正文）；引用只收三种
 * scope 且**只带标识**——带 params 或再嵌一层就整条丢掉，不让「多一层」从数据里溜进解析器。
 */
function normalizeTextParams(value: unknown): Record<string, NotificationCopyParam> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const params: Record<string, NotificationCopyParam> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      if (raw.length <= 200) params[key] = raw
      continue
    }
    const number = normalizeParamNumber(raw)
    if (number !== undefined) {
      params[key] = number
      continue
    }
    const ref = normalizeParamRef(raw)
    if (ref !== undefined) params[key] = { ref }
  }
  return Object.keys(params).length > 0 ? params : undefined
}

/**
 * 成品句子（契约 v2.56）：两种语言、三段都必须是**非空字符串**，否则整份丢弃——
 * 半份成品比没有更危险：平台会以为读到了，读者却看到空句子。
 */
function normalizeRendered(value: unknown): NotificationContentByLanguage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const pick = (language: 'zh-CN' | 'en-US'): { title: string; body: string; reason: string } | undefined => {
    const entry = candidate[language]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
    const parts = entry as Record<string, unknown>
    const title = typeof parts.title === 'string' ? parts.title : undefined
    const body = typeof parts.body === 'string' ? parts.body : undefined
    const reason = typeof parts.reason === 'string' ? parts.reason : undefined
    if (title === undefined || body === undefined || reason === undefined) return undefined
    if (title.trim() === '' || body.trim() === '' || reason.trim() === '') return undefined
    return { title, body, reason }
  }
  // 单语言是**合法状态**（那一期只有一种语言）：有哪种留哪种，一种都没有才算没读到成品。
  const zh = pick('zh-CN')
  const en = pick('en-US')
  if (zh === undefined && en === undefined) return undefined
  return { ...(zh === undefined ? {} : { 'zh-CN': zh }), ...(en === undefined ? {} : { 'en-US': en }) }
}

/** 信号严重度：只认三档闭集（契约 v2.45）。其它值一律当作「没有这个状态」。 */
function normalizeSignalSeverity(value: unknown): NotificationSignalSeverity | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

/**
 * 参数位置上的数字：只认 `{ number, kind }`，`kind` 落在闭集里、数值有限。
 * 其它形状（少字段、多字段、单位自造）一律丢掉——半懂的引用比没有更危险。
 */
function normalizeParamNumber(value: unknown): NotificationCopyNumber | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (keys.length !== 2 || !('number' in candidate) || !('kind' in candidate)) return undefined
  const { number, kind } = candidate
  if (typeof number !== 'number' || !Number.isFinite(number)) return undefined
  if (kind !== 'usd' && kind !== 'pct' && kind !== 'multiple' && kind !== 'count') return undefined
  return { number, kind }
}

/** 参数位置上的引用：只认 `{ ref: { scope, …标识 } }`，多一个字段都不要。 */
function normalizeParamRef(value: unknown): NotificationCopyParamRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const holder = value as { ref?: unknown }
  if (!holder.ref || typeof holder.ref !== 'object' || Array.isArray(holder.ref)) return undefined
  const ref = holder.ref as Record<string, unknown>
  const keys = Object.keys(ref)
  const exactly = (...allowed: string[]): boolean =>
    keys.length === allowed.length && allowed.every((field) => field in ref)
  if (ref.scope === 'platform' && exactly('scope', 'key') && typeof ref.key === 'string') {
    return { scope: 'platform', key: ref.key }
  }
  if (ref.scope === 'product' && exactly('scope', 'productId', 'key') &&
    typeof ref.productId === 'string' && typeof ref.key === 'string') {
    return { scope: 'product', productId: ref.productId, key: ref.key }
  }
  if (ref.scope === 'job-title' && exactly('scope', 'definitionId') && typeof ref.definitionId === 'string') {
    return { scope: 'job-title', definitionId: ref.definitionId }
  }
  return undefined
}

export function createNotificationFromRequest(request: NotificationRequest, now = new Date().toISOString()): NotificationRecord {
  return {
    id: createNotificationId(),
    owner: request.owner,
    productId: request.productId,
    sourceId: request.sourceId,
    eventTypeId: request.eventTypeId ?? 'legacy.untyped',
    delivery: {},
    titleKey: request.titleKey,
    titleParams: request.titleParams,
    bodyKey: request.bodyKey,
    bodyParams: request.bodyParams,
    reasonKey: request.reasonKey,
    reasonParams: request.reasonParams,
    severity: request.severity,
    priority: request.priority,
    channels: request.requestedChannels.includes('center') ? request.requestedChannels : ['center', ...request.requestedChannels],
    state: 'unread',
    deeplink: request.deeplink,
    actions: request.actions ?? [],
    dedupeKey: request.dedupeKey,
    correlationId: request.correlationId,
    safeMetadata: request.safeMetadata,
    occurrenceCount: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: request.expiresAt
  }
}

export function markNotificationRead(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: record.state === 'acknowledged' ? 'acknowledged' : 'read',
    readAt: record.readAt ?? now,
    updatedAt: now
  }
}

export function acknowledgeNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: 'acknowledged',
    readAt: record.readAt ?? now,
    acknowledgedAt: now,
    updatedAt: now
  }
}

export function dismissNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'expired') return record
  return {
    ...record,
    state: 'dismissed',
    dismissedAt: now,
    updatedAt: now
  }
}

export function snoozeNotification(record: NotificationRecord, until: string, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: 'snoozed',
    snoozedUntil: until,
    updatedAt: now
  }
}

export function expireNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed') return record
  return {
    ...record,
    state: 'expired',
    updatedAt: now
  }
}

export function reactivateSnoozedNotifications(records: NotificationRecord[], now = new Date().toISOString()): NotificationRecord[] {
  return records.map((record) => {
    if (record.state !== 'snoozed' || !record.snoozedUntil) return record
    if (record.snoozedUntil > now) return record
    return {
      ...record,
      state: 'unread',
      snoozedUntil: undefined,
      updatedAt: now
    }
  })
}

export function expireDueNotifications(records: NotificationRecord[], now = new Date().toISOString()): NotificationRecord[] {
  return records.map((record) => {
    if (!record.expiresAt || record.expiresAt > now) return record
    return expireNotification(record, now)
  })
}

export function isActiveNotification(record: NotificationRecord, now = new Date().toISOString()): boolean {
  if (record.state === 'dismissed' || record.state === 'expired') return false
  if (record.state === 'snoozed' && record.snoozedUntil && record.snoozedUntil > now) return false
  return true
}

function normalizeSeverity(value: unknown): NotificationSeverity {
  if (value === 'success' || value === 'warning' || value === 'critical') return value
  return 'info'
}

function normalizePriority(value: unknown): NotificationPriority {
  if (value === 'low' || value === 'high' || value === 'urgent') return value
  return 'normal'
}

function normalizeState(value: unknown): NotificationState {
  if (
    value === 'read' ||
    value === 'acknowledged' ||
    value === 'dismissed' ||
    value === 'snoozed' ||
    value === 'expired'
  ) {
    return value
  }
  return 'unread'
}

function normalizeChannels(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value)) return ['center']
  const allowed: NotificationChannel[] = ['center', 'toast', 'popup', 'desktop']
  const channels = value.filter((item): item is NotificationChannel => allowed.includes(item as NotificationChannel))
  return channels.length > 0 ? [...new Set(channels)] : ['center']
}




/** 只留 `ok` / `invalid` 两值；其余丢弃，不发明第三态。 */
function normalizeCredentialHealth(
  value: unknown
): Readonly<Record<string, 'ok' | 'invalid'>> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, 'ok' | 'invalid'> = {}
  for (const [providerId, state] of Object.entries(value as Record<string, unknown>)) {
    if (state === 'ok' || state === 'invalid') out[providerId] = state
  }
  return out
}

/**
 * 合并规则已抽到 `notificationMerge.ts`（store 只留读写；抽出去因为本文件超了体积线）。
 * 这里**只转出口**，规则本身不在这份文件里——一处实现，别处引用。
 */
export { mergeDuplicateNotification } from './notificationMerge'
