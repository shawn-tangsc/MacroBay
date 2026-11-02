import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { notificationCopyText } from '../../i18n/notificationCopy'

import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import {
  acknowledgeNotification,
  createDefaultNotificationStoreState,
  createNotificationFromRequest,
  createNotificationId,
  dismissNotification,
  expireDueNotifications,
  isActiveNotification,
  markNotificationRead,
  mergeDuplicateNotification,
  normalizeNotificationStoreState,
  reactivateSnoozedNotifications,
  snoozeNotification,
  type NotificationStoreState
} from '../store/notificationStore'
import type {
  DesktopNotificationPermission,
  NotificationChannel,
  NotificationDiagnosticsSink,
  NotificationListPage,
  NotificationListQuery,
  NotificationRecord,
  NotificationRequest,
  NotificationRuntimeSettings,
  NotificationSubmitOutcome,
  NotificationSubmitRequest,
  NotificationUnreadState,
  SafeNotificationRecord
} from '../contracts/notificationContracts'
import type { NotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { toSafeNotificationRecord } from '../contracts/notificationContracts'
import {
  decideNotificationBreaker,
  pruneNotificationDailyCounters,
  utcDayOf
} from './notificationBreaker'
import { pruneNotificationRecords } from '../store/notificationRetention'
import { findActiveDuplicate } from '../runtime/notificationDedupe'
import { planNotificationSubmit } from './notificationSubmitPlan'
import {
  normalizeRequestedChannels,
  routeTransientDelivery,
  type DeliveryAttempt,
  type DeliveryHooks,
  type NotificationClock,
  type NotificationDeliveryContent
} from '../runtime/notificationRouting'

export type NotificationStorage = JsonFileStorage<NotificationStoreState>

export function createNotificationJsonStorage(filePath: string): NotificationStorage {


  return {
    async read() {
      try {
        return normalizeNotificationStoreState(JSON.parse(await readFile(filePath, 'utf8')))
      } catch (error) {
        if (isMissingFileError(error)) return createDefaultNotificationStoreState()
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }
  }
}

export type NotificationRuntimeDependencies = {
  storage: NotificationStorage
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 读者时区与当前时刻；免打扰窗口按它判断。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」。 */
  clock: NotificationClock
  deliveryHooks?: DeliveryHooks
  /** 事件目录（契约 §2）。装配层注入；没有目录时新提交路径一律 rejected: unknown-event-type。 */
  catalog?: NotificationEventCatalog
  /** 诊断出口（runtime §2）：必传于装配层；这里可缺省是为了旧测试的迁移，缺省即无人接收。 */
  diagnostics?: NotificationDiagnosticsSink
  /** 读者语言：正文在投递前解析一次，四个钩子拿同一份 content。 */
  getLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 只有「系统能回答授没授权」时才给 granted/denied；查不到就返回 unknown，不许拿支持性冒充授权。 */
  readDesktopPermission?: () => Promise<DesktopNotificationPermission>
  /** 记录有任何变化（投递 / 标读 / 撤销 / 稍后 / 清理）时调用一次，载荷是递增的版本号。 */
  onChanged?: (change: { version: number }) => void
}

export function createNotificationRuntime(deps: NotificationRuntimeDependencies) {
  let cache: NotificationStoreState | null = null
  /** 唯一的「现在」：不可注入的时钟等于不可测的熔断，跨零点会长出一条自己变红的用例。 */
  const nowIso = (): string => deps.clock.now().toISOString()
  /** 进程内单调递增的变更版本：订阅方用它丢掉重复/乱序事件，重启后从 1 重新开始即可。 */
  let version = 0

  async function load(): Promise<NotificationStoreState> {
    if (cache) return cache
    const state = normalizeNotificationStoreState(await deps.storage.read())
    const now = nowIso()
    const normalized = {
      ...state,
      records: expireDueNotifications(reactivateSnoozedNotifications(state.records, now), now),
      // 计数桶的回收只由清理任务与下一次写入负责；读取时静默丢弃会让「清理释放了几条」永远报 0。
      dailyCounters: state.dailyCounters ?? {}
    }
    cache = normalized
    return normalized
  }

  async function persist(state: NotificationStoreState): Promise<void> {
    cache = state
    await deps.storage.write(state)
  }

  async function submitLegacy(request: NotificationRequest): Promise<SafeNotificationRecord> {
    const state = await load()
    const settings = await deps.getSettings()
    const now = nowIso()
    const duplicate = findActiveDuplicate(state.records, request, now)

    // 折叠第一层：同 dedupeKey 且仍活跃 → 只累加次数，不新增记录，也不消耗熔断额度。
    if (duplicate) {
      const merged = mergeDuplicateNotification(duplicate, request, now)
      const mergedRecords = state.records.map((item: NotificationRecord) => (item.id === merged.id ? merged : item))
      await persist({ ...state, records: mergedRecords })
      notifyChanged()
      return toSafeNotificationRecord(merged)
    }

    const ownerId = request.productId ?? 'platform'
    const breaker = decideNotificationBreaker({
      counters: state.dailyCounters ?? {},
      ownerId,
      now
    })
    const dailyCounters = pruneNotificationDailyCounters(breaker.counters, now)

    // 折叠第二层：超过当日上限后原文不落库，只把「今天还出过几条」留在聚合记录上。
    if (breaker.action === 'fold') {
      const folded = foldIntoAggregate(state.records, request, ownerId, now)
      await persist({ ...state, records: folded.records, dailyCounters })
      notifyChanged()
      return toSafeNotificationRecord(folded.aggregate)
    }

    const record = createNotificationFromRequest(
      {
        ...request,
        requestedChannels: withCenterForDisruptiveChannels(request, normalizeRequestedChannels(request, settings, deps.clock))
      },
      now
    )

    await persist({ ...state, records: [record, ...state.records], dailyCounters })
    notifyChanged()
    await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock, await resolveContent(record))

    return toSafeNotificationRecord(record)
  }

  function submit(request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome>
  function submit(request: NotificationRequest): Promise<SafeNotificationRecord>
  function submit(
    request: NotificationRequest | NotificationSubmitRequest
  ): Promise<SafeNotificationRecord | NotificationSubmitOutcome> {
    return 'dedupeVars' in request ? submitEvent(request) : submitLegacy(request)
  }

  async function persistWithDiagnostics(state: NotificationStoreState): Promise<void> {
    try {
      await persist(state)
    } catch (error) {
      deps.diagnostics?.({ code: 'persist-failed', at: nowIso() })
      throw error
    }
  }

  async function resolveContent(record: NotificationRecord): Promise<NotificationDeliveryContent> {
    const language = (await deps.getLanguage?.()) ?? 'zh-CN'
    const fallback = language === 'en-US' ? 'A notification' : '有一条通知'
    const resolve = (key: NotificationRecord['titleKey'] | undefined): string => {
      if (key === undefined) return ''
      const text = notificationCopyText(language, key)
      return typeof text === 'string' && text.length > 0 ? text : fallback
    }
    return {
      title: resolve(record.titleKey),
      body: resolve(record.bodyKey),
      reason: resolve(record.reasonKey),
      ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink }),
      shortId: record.id.slice(0, 8)
    }
  }

  /**
   * 新提交路径（契约 §3.2）。规划器只回答「变成什么」，这里负责落库、合并与投递；
   * 合并/跨类型/空正文等规则全部在 `planNotificationSubmit` + `mergeDuplicateNotification` 一处。
   */
  async function submitEvent(request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome> {
    const state = await load()
    const settings = await deps.getSettings()
    const now = nowIso()
    if (!deps.catalog) {
      return { kind: 'rejected', reason: 'unknown-event-type', message: 'notification catalog is not configured' }
    }

    const first = planNotificationSubmit({
      catalog: deps.catalog,
      subscriptions: state.subscriptions,
      settings,
      request,
      now
    })
    if (first.kind === 'rejected' || first.kind === 'suppressed') return first.outcome

    const duplicate = findActiveDuplicate(state.records, first.incoming, now)
    const plan = duplicate
      ? planNotificationSubmit({
          catalog: deps.catalog,
          subscriptions: state.subscriptions,
          settings,
          request,
          now,
          duplicate
        })
      : first
    if (plan.kind === 'rejected' || plan.kind === 'suppressed') return plan.outcome

    if (plan.kind === 'merge') {
      const merged = mergeDuplicateNotification(plan.duplicate, plan.incoming, now, {
        incrementCount: plan.incrementCount
      })
      const records = state.records.map((item: NotificationRecord) => (item.id === merged.id ? merged : item))
      await persistWithDiagnostics({ ...state, records })
      notifyChanged()
      return {
        kind: 'merged',
        recordId: merged.id,
        occurrenceCount: merged.occurrenceCount,
        mergedEventTypes: merged.mergedEventTypes ?? [merged.eventTypeId]
      }
    }

    const record = plan.record
    await persistWithDiagnostics({ ...state, records: [record, ...state.records] })
    notifyChanged()
    const delivered = await deliverNewRecord(record, settings)
    if (delivered !== record) {
      const records = [delivered, ...state.records]
      await persistWithDiagnostics({ ...state, records })
      notifyChanged()
    }
    return plan.outcome
  }

  /**
   * 只在这一步投递一次（契约 §16.3「合并不重推」）。跳过不算失败：该表面不写 delivery 条目；
   * `unknown-after-send` 是独立原因码，不能写成「没发到手机」。
   */
  async function deliverNewRecord(
    record: NotificationRecord,
    settings: NotificationRuntimeSettings
  ): Promise<NotificationRecord> {
    const content = await resolveContent(record)
    const attempts = await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock, content)
    const delivery: NotificationRecord['delivery'] = { ...record.delivery }
    for (const attempt of attempts) {
      if (attempt.channel !== 'toast' && attempt.channel !== 'popup' && attempt.channel !== 'desktop') continue
      if (attempt.result === 'skipped') {
        delete delivery[attempt.channel]
        continue
      }
      delivery[attempt.channel] = {
        state: attempt.result === 'failed' ? 'failed' : 'sent-accepted',
        at: attempt.attemptedAt,
        ...(attempt.reason === undefined ? {} : { reason: attempt.reason })
      }
    }

    if (delivery.push?.state === 'queued') {
      const at = nowIso()
      if (settings.push.channelId === null || !deps.deliveryHooks?.push) {
        delivery.push = { state: 'failed', reason: 'push-unavailable', at }
      } else {
        const result = await deps.deliveryHooks.push({ ...record, delivery }, content)
        delivery.push = result.ok
          ? { state: 'sent-accepted', at, ...(result.messageId === undefined ? {} : { messageId: result.messageId }) }
          : { state: 'failed', reason: result.reason ?? 'channel-rejected', at }
      }
    }
    return { ...record, delivery }
  }

  return {
    submit,

    async initialize(): Promise<void> {
      await load()
    },

    /**
     * 保留期清理：按天数 + 条数剪记录，同时丢掉窗口外的计数桶。
     * 清理任务（`@platform/jobs`）与启动恢复都只调这一处，避免两条清理路径各剪一半。
     */
    async prune(): Promise<{ removedRecords: number; removedCounters: number }> {
      const state = await load()
      const settings = await deps.getSettings()
      const now = nowIso()
      const pruned = pruneNotificationRecords(state.records, { retentionDays: settings.retentionDays, now })
      const counters = pruneNotificationDailyCounters(state.dailyCounters ?? {}, now)
      const removedCounters = Object.keys(state.dailyCounters ?? {}).length - Object.keys(counters).length
      const removedRecords = state.records.length - pruned.records.length
      if (removedRecords === 0 && removedCounters === 0) return { removedRecords: 0, removedCounters: 0 }
      await persist({ ...state, records: pruned.records, dailyCounters: counters })
      notifyChanged()
      return { removedRecords, removedCounters }
    },

    /**
     * 分页列表。排序在这里做；游标是**键游标** `createdAt|id`。
     * 数组下标游标在「边翻边进新通知」时会让第 2 页重复第 1 页的末条——而这正是回看 30 天的核心场景。
     */
    async list(query: NotificationListQuery = {}): Promise<NotificationListPage> {
      const state = await load()
      const now = nowIso()
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      const allowedStates = query.state?.length ? new Set(query.state) : null
      const unreadFirst = query.unreadFirst === true

      const filtered = state.records.filter((record: NotificationRecord) => {
        if (query.productId && record.productId !== query.productId) return false
        if (allowedStates && !allowedStates.has(record.state)) return false
        if (!allowedStates && !isActiveNotification(record, now) && record.state !== 'read' && record.state !== 'acknowledged') {
          return false
        }
        return true
      })

      const sorted = [...filtered].sort((left, right) => compareNotifications(left, right, unreadFirst))
      const start = query.cursor ? resumeIndex(sorted, query.cursor, unreadFirst) : 0
      const end = Math.min(start + limit, sorted.length)
      const page = sorted.slice(start, end).map(toSafeNotificationRecord)
      const last = end > start ? sorted[end - 1] : undefined
      const nextCursor = end < sorted.length && last ? notificationCursorKey(last) : undefined
      return { items: page, nextCursor }
    },

    /** 角标状态：未读数 + 版本号。**不是**第二个函数：原来是单独一个 `getUnreadCount`，现在合成一个返回值。 */
    /**
     * 用户手动自检专用：**不占当日写入额度**。绕过口只在这里，
     * 公开的 `submit()` 没有参数能让产品线传进来——不是“不该传”，是没有地方传。
     */
    /**
     * 测试通知：走**完整投递链路**并把每次投递的结果一起交回。
     *
     * 为什么必须投递而不是只落库：按钮旁边的文案承诺「右上角会出现一条横幅」，
     * 只落库等于横幅永不出现；而用户点它的目的本来就是判断「系统放没放行」，
     * 把 `desktop` 那条的 `ok` / `reason` 丢掉，这次测试就白点了。不占熔断额度仍由调用方负责。
     */
    async submitSelfTest(request: NotificationRequest): Promise<{ record: SafeNotificationRecord; delivery: DeliveryAttempt[] }> {
      const state = await load()
      const settings = await deps.getSettings()
      const now = nowIso()
      const record = createNotificationFromRequest(
        {
          ...request,
          requestedChannels: withCenterForDisruptiveChannels(request, normalizeRequestedChannels(request, settings, deps.clock))
        },
        now
      )
      await persist({ ...state, records: [record, ...state.records] })
      notifyChanged()
      const delivery = await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock)
      return { record: toSafeNotificationRecord(record), delivery }
    },

    async getUnreadState(productId?: string): Promise<NotificationUnreadState> {
      const state = await load()
      const now = nowIso()
      return unreadStateOf(state.records, now, productId, version)
    },

    /**
     * 「清空」= 全部未读标为已读，**不是删除**（用户 11-01 定的口径）。
     *
     * 一次落盘、一次广播：前端绝不能拿列表逐条 `markRead` —— 翻到第 120 条就是 120 次 IPC，
     * 中间失败会留下「标了一半」的状态。范围是**全部未读**，不是「当前页」：
     * 只清当前页会让角标残留，用户会以为没生效。幂等：没有未读时返回 0，不报错。
     */
    async markAllRead(productId?: string): Promise<NotificationUnreadState> {
      const state = await load()
      const now = nowIso()
      let changed = false
      const records = state.records.map((record: NotificationRecord) => {
        if (record.state !== 'unread') return record
        if (productId && record.productId !== productId) return record
        changed = true
        return markNotificationRead(record, now)
      })
      if (changed) {
        await persist({ ...state, records })
        notifyChanged()
      }
      return unreadStateOf(records, now, productId, version)
    },

    /**
     * 删除**已读**记录（不是清空、不是单条收起）。三件事必须分清：
     * 清空 = 全部标已读（`markAllRead`），单条收起 = 状态迁移（`dismiss`），这里才是真删。
     *
     * 口径（架构师 2026-11-02 裁定）：只删 `state === 'read'`，未读一条不动；**不整批失败**——
     * 部分能删就返回实际删掉的条数；删完必须走一次 `notifyChanged()`，否则角标不清零，
     * 用户会看到「删了但数字还在」。计数桶与保留期剪枝都不受影响。
     */
    async deleteRead(): Promise<{ deleted: number }> {
      const state = await load()
      const kept = state.records.filter((record: NotificationRecord) => record.state !== 'read')
      const deleted = state.records.length - kept.length
      if (deleted === 0) return { deleted: 0 }
      await persist({ ...state, records: kept })
      notifyChanged()
      return { deleted }
    },

    async markRead(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => markNotificationRead(record))
    },

    async acknowledge(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => acknowledgeNotification(record))
    },

    async dismiss(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => dismissNotification(record))
    },

    async snooze(id: string, until: string): Promise<SafeNotificationRecord> {
      if (until <= nowIso()) {
        throw new Error('Snooze time must be in the future.')
      }
      return transition(id, (record) => snoozeNotification(record, until))
    },

    async readDesktopPermission(): Promise<DesktopNotificationPermission> {
      if (deps.readDesktopPermission) {
        return deps.readDesktopPermission()
      }
      // 没有读法就是「不知道」，不是「被拒绝」，也不是「已授权」。
      return 'unknown'
    }
  }

  function notifyChanged(): void {
    version += 1
    const change = { version }
    try {
      deps.onChanged?.(change)
    } catch {
      // 广播失败不能回滚已经写入的记录：事件是提示，不是事实来源。
    }
  }

  async function transition(
    id: string,
    transform: (record: NotificationRecord) => NotificationRecord
  ): Promise<SafeNotificationRecord> {
    const state = await load()
    const index = state.records.findIndex((record: NotificationRecord) => record.id === id)
    if (index < 0) throw new Error(`Notification "${id}" was not found.`)

    const nextRecord = transform(state.records[index]!)
    const nextRecords = [...state.records]
    nextRecords[index] = nextRecord
    await persist({ ...state, records: nextRecords })
    notifyChanged()
    return toSafeNotificationRecord(nextRecord)
  }
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>

/**
 * 4a「中心必达」：只要这条通知会走任何一个打断式通道，`channels` 就必须含 `center`。
 * 归一化放在这里一处，**不靠四个生产者各自记得传**——靠调用点记得，等于有四个地方会忘。
 * 这条不为「要不要响」负责：免打扰和通道开关仍由路由决定，它只保证「响过的东西一定能回看」。
 */
function withCenterForDisruptiveChannels(
  request: NotificationRequest,
  channels: readonly NotificationChannel[]
): NotificationChannel[] {
  const disruptive = channels.some((channel) => channel === 'desktop' || channel === 'toast' || channel === 'popup')
  if (!disruptive || channels.includes('center')) return [...channels]
  return ['center', ...channels]
}


/**
 * 熔断的聚合记录：**同一 owner 同一天只有一条**。
 *
 * 折叠掉的是原文，不是事实——正文不落库，但「今天还出过几条、属于哪个 owner」必须留下。
 * 标题只是一个稳定标识，界面从 `collapsedCount` 出文案，**不要直接显示这个字符串**。
 */
const NOTIFICATION_AGGREGATE_TITLE = 'notification-aggregate'
/** 聚合记录的稳定标识键；界面从 `collapsedCount` 出文案，不直接显示这一句。 */
const NOTIFICATION_AGGREGATE_TITLE_KEY = 'notification.aggregate.title' as const

function aggregateDedupeKey(ownerId: string, now: string): string {
  return `${NOTIFICATION_AGGREGATE_TITLE}|${ownerId}|${utcDayOf(now)}`
}

function foldIntoAggregate(
  records: readonly NotificationRecord[],
  request: NotificationRequest,
  ownerId: string,
  now: string
): { records: NotificationRecord[]; aggregate: NotificationRecord } {
  const dedupeKey = aggregateDedupeKey(ownerId, now)
  const existing = records.find((record) => record.dedupeKey === dedupeKey)
  if (existing) {
    const aggregate: NotificationRecord = {
      ...existing,
      collapsedCount: (existing.collapsedCount ?? 0) + 1,
      occurrenceCount: existing.occurrenceCount + 1,
      updatedAt: now
    }
    return {
      records: records.map((record) => (record.id === aggregate.id ? aggregate : record)),
      aggregate
    }
  }

  const aggregate: NotificationRecord = {
    id: createNotificationId(),
    owner: request.owner,
    productId: request.productId,
    sourceId: NOTIFICATION_AGGREGATE_TITLE,
    eventTypeId: 'legacy.aggregate',
    delivery: {},
    titleKey: NOTIFICATION_AGGREGATE_TITLE_KEY,
    severity: 'warning',
    priority: 'low',
    channels: ['center'],
    state: 'unread',
    actions: [],
    dedupeKey,
    safeMetadata: { aggregate: true },
    occurrenceCount: 1,
    collapsedCount: 1,
    createdAt: now,
    updatedAt: now
  }
  return { records: [aggregate, ...records], aggregate }
}

/** 未读数与版本的唯一算法：角标、清空、事件三处读同一个结果。 */
function unreadStateOf(
  records: readonly NotificationRecord[],
  now: string,
  productId: string | undefined,
  version: number
): NotificationUnreadState {
  const unread = records.filter(
    (record) =>
      record.state === 'unread' &&
      isActiveNotification(record, now) &&
      (!productId || record.productId === productId)
  ).length
  return { unread, version }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/** 未读优先时未读组在前；组内按 `createdAt` 倒序，同一毫秒用 `id` 兜底保证顺序稳定。 */
function compareNotifications(left: NotificationRecord, right: NotificationRecord, unreadFirst: boolean): number {
  if (unreadFirst) {
    const leftRank = left.state === 'unread' ? 0 : 1
    const rightRank = right.state === 'unread' ? 0 : 1
    if (leftRank !== rightRank) return leftRank - rightRank
  }
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

/** 键游标 `createdAt|id`：同一毫秒的多条各有不同 id，因此不会丢；也是排序位置，插入不影响已翻过的页。 */
function notificationCursorKey(record: NotificationRecord): string {
  return `${record.createdAt}|${record.id}`
}

/**
 * 从游标继续：找到那一条就从它之后开始；找不到（被删或被改状态移出本组）就按排序键
 * 取「排在游标之后」的第一条，**绝不退回数组下标**。
 */
function resumeIndex(sorted: readonly NotificationRecord[], cursor: string, unreadFirst: boolean): number {
  const exact = sorted.findIndex((record) => notificationCursorKey(record) === cursor)
  if (exact >= 0) return exact + 1

  const separator = cursor.lastIndexOf('|')
  if (separator <= 0) return 0
  const createdAtPart = cursor.slice(0, separator)
  const idPart = cursor.slice(separator + 1)
  const index = sorted.findIndex((record) => {
    if (record.createdAt !== createdAtPart) return record.createdAt > createdAtPart
    return record.id > idPart
  })
  return index < 0 ? sorted.length : index
}
