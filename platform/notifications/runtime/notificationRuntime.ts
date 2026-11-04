import { readJsonFileRecovering, writeJsonFileAtomically } from '../../storage/jsonFileStorage'


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
import type { NotificationProducerOwnership } from '../contracts/notificationProducerOwnership'
import type { NotificationCopyPort } from '../contracts/notificationCopyPort'
import { toSafeNotificationRecord } from '../contracts/notificationContracts'
import { pruneNotificationRecords } from '../store/notificationRetention'
import { findActiveDuplicate } from '../runtime/notificationDedupe'
import { planNotificationSubmit } from './notificationSubmitPlan'
import { pruneNotificationDailyCounters } from './notificationBreaker'
import { decideDailyCap, withCenterForDisruptiveChannels } from './notificationAggregate'
import { evaluateProducerGate } from './notificationProducerGate'
import { emitBackoffEvent } from './notificationBackoffEvents'
import { reportProviderCredentialFlip } from './notificationCredentialHealth'
import { pruneNotificationState } from './notificationRuntimePrune'
import {
  normalizeRequestedChannels,
  routeTransientDelivery,
  type DeliveryAttempt,
  type DeliveryHooks,
  type NotificationClock
} from '../runtime/notificationRouting'
import { createNotificationDelivery } from './notificationRuntimeDelivery'
import { composeNotificationSettingsSurface } from './notificationRuntimeSettings'
import {
  compareNotifications,
  notificationCursorKey,
  resumeIndex,
  unreadStateOf
} from './notificationRuntimeQuery'

export type NotificationStorage = JsonFileStorage<NotificationStoreState>

export function createNotificationJsonStorage(filePath: string): NotificationStorage {


  return {
    /**
     * 读回整份状态。**走恢复读**：这一份 JSON 是整份读—改—写的目标，历史上被写成过
     * 「完整文档 + 上一版残片」；裸 `JSON.parse` 会把这种文件变成启动期的未处理拒绝，
     * 而 `readJsonFileRecovering` 会取回最长可解析前缀、留一份 `.corrupt-*` 再把干净内容写回。
     *
     * 文件不存在（首次启动）仍然是默认态，不当作损坏。
     */
    async read() {
      const value = await readJsonFileRecovering(filePath)
      if (value === undefined) return createDefaultNotificationStoreState()
      return normalizeNotificationStoreState(value)
    },
    async write(value) {
      await writeJsonFileAtomically(filePath, value)
    }
  }
}

export type NotificationRuntimeDependencies = {
  storage: NotificationStorage
  getSettings: () => Promise<NotificationRuntimeSettings>
  /**
   * 这个平台支不支持桌面通知（`Notification.isSupported()`）。**只认这一个外部事实**：
   * 系统里有没有关掉 MacroBay 的通知我们读不到，不许拿授权状态猜（设计 §2）。
   */
  desktopSupported?: () => boolean
  /** 读者时区与当前时刻；免打扰窗口按它判断。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」。 */
  clock: NotificationClock
  deliveryHooks?: DeliveryHooks
  /** 事件目录（契约 §2）。装配层注入；没有目录时新提交路径一律 rejected: unknown-event-type。 */
  catalog?: NotificationEventCatalog
  /** 诊断出口（runtime §2）：必传于装配层；这里可缺省是为了旧测试的迁移，缺省即无人接收。 */
  diagnostics?: NotificationDiagnosticsSink
  /** 生产者归属表（契约 §14）：未登记 → 平台发；让渡给产品 → 平台不发，只记诊断。 */
  producerOwnership?: NotificationProducerOwnership
  /** 已登记的产品 productId；producerId 前缀对不上任何产品即视为平台自有。 */
  productIds?: readonly string[]
  /** 读者语言：正文在投递前解析一次，四个钩子拿同一份 content。 */
  getLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 文案解析端口（契约 §3.3）：平台键/产品键都走它；缺省时退回平台闭集。 */
  copy?: NotificationCopyPort
  /** 写读者级设置（提示开关 / 通道选择）；由装配层接到设置 store，runtime 不自己写设置文件。 */
  updateSettings?: (patch: Partial<NotificationRuntimeSettings>) => Promise<void>
  /** 通道侧投影：可用通道 + 目标只读；没有通道线时为空数组。 */
  getPushTargets?: () => Promise<readonly unknown[]>
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
  /** 每个未登记的 producerId 只记一次诊断；进程重启后再记一次是可接受的。 */
  const seenUnclaimedProducers = new Set<string>()

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

  /**
   * 变更串行化：整份 JSON 的「读—改—写」必须**整段**排队，而不是只给 write 排队。
   *
   * 两条提交只差几毫秒时，各自 `load()` 拿到同一份 cache、各自基于它整份重写；只锁 write 的话，
   * 后写的那次仍然带着旧的底稿，前一条记录照样被抹掉。所以锁的是整段变更：
   * submit / prune / markAllRead / deleteRead / 单条状态迁移 / 订阅写入都排在这一条链上。
   */
  let mutationQueue: Promise<unknown> = Promise.resolve()
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationQueue.then(operation, operation)
    mutationQueue = run.catch(() => undefined)
    return run
  }

  async function persist(state: NotificationStoreState): Promise<void> {
    cache = state
    await deps.storage.write(state)
  }

  async function submit(request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome> {
    return exclusive(() => submitEvent(request))
  }

  async function persistWithDiagnostics(state: NotificationStoreState): Promise<void> {
    try {
      await persist(state)
    } catch (error) {
      deps.diagnostics?.({ code: 'persist-failed', at: nowIso() })
      throw error
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

    const gate = evaluateProducerGate({
      producerId: request.producerId,
      eventTypeId: request.eventTypeId,
      ownership: deps.producerOwnership,
      productIds: deps.productIds,
      diagnostics: deps.diagnostics,
      seenUnclaimedProducers,
      now
    })
    if (gate.action === 'delegated' && request.producerId !== undefined) {
      return {
        kind: 'delegated',
        eventTypeId: request.eventTypeId,
        producerId: request.producerId,
        ownerProductId: gate.ownerProductId
      }
    }

    const first = planNotificationSubmit({
      catalog: deps.catalog,
      settings,
      desktopSupported: deps.desktopSupported?.() ?? true,
      request,
      now
    })
    if (first.kind === 'rejected') return first.outcome

    const duplicate = findActiveDuplicate(state.records, first.incoming, now)
    const plan = duplicate
      ? planNotificationSubmit({
          catalog: deps.catalog,
          settings,
          desktopSupported: deps.desktopSupported?.() ?? true,
          request,
          now,
          duplicate
        })
      : first
    if (plan.kind === 'rejected') return plan.outcome

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

    const ownerId = deps.catalog.get(request.eventTypeId)?.productId ?? 'platform'
    const cap = decideDailyCap({
      records: state.records,
      request: plan.incoming,
      ownerId,
      counters: state.dailyCounters,
      now
    })
    const dailyCounters = cap.counters
    // 折叠第二层：超过当日上限后原文不落库，只留下「今天还出过几条」（T2/T10）。
    if (cap.fold) {
      await persistWithDiagnostics({ ...state, records: cap.records, dailyCounters })
      notifyChanged()
      return {
        kind: 'collapsed',
        aggregateRecordId: cap.aggregate.id,
        collapsedCount: cap.aggregate.collapsedCount ?? 1
      }
    }

    const record = plan.record
    await persistWithDiagnostics({ ...state, records: [record, ...state.records], dailyCounters })
    notifyChanged()
    const delivered = await delivery.deliverNewRecord(record, settings, state.pushBackoff)
    if (delivered.record !== record || delivered.pushBackoff !== state.pushBackoff) {
      const records = [delivered.record, ...state.records]
      await persistWithDiagnostics({ ...state, records, pushBackoff: delivered.pushBackoff, dailyCounters })
      notifyChanged()
    }
    if (delivered.transition !== undefined) {
      await emitBackoffEvent({ transition: delivered.transition, now, submit: submitEvent })
    }
    if (delivered.desktopBlocked) {
      // P7：桌面这一跳没弹出来。它是**唯一**的来源——`readPermission()` 读不到授权，不许拿它猜。
      // 这条自己只批了中心与提示（不含桌面），所以不会再产生下一次桌面失败，不会自激。
      await submitEvent({
        eventTypeId: 'platform.desktop.blocked',
        producerId: 'platform',
        dedupeVars: { builder: 'template', vars: { recordId: record.id } },
        actions: [],
        occurredAt: now
      })
    }
    return plan.outcome
  }

  /** P4a/P4b 的提交点：抽出到 `notificationCredentialHealth.ts`，这里只接线。 */
  const reportProviderCredential = (input: { providerId: string; state: 'ok' | 'invalid' }) =>
    reportProviderCredentialFlip(input, { load, persistWithDiagnostics, notifyChanged, submit: submitEvent, now: nowIso })

  const settingsPorts = { catalog: deps.catalog, getSettings: deps.getSettings, updateSettings: deps.updateSettings, getPushTargets: deps.getPushTargets, pushWired: () => deps.deliveryHooks?.push !== undefined }
  const settingsSurface = composeNotificationSettingsSurface(settingsPorts, { load, exclusive, persistWithDiagnostics, notifyChanged })
  const delivery = createNotificationDelivery({
    deliveryHooks: deps.deliveryHooks,
    clock: deps.clock,
    getLanguage: deps.getLanguage,
    copy: deps.copy,
    now: nowIso
  })

  return {
    submit,

    ...settingsSurface,
    reportProviderCredential,

    async initialize(): Promise<void> {
      await load()
    },

    /** 保留期清理（实现见 `notificationRuntimePrune.ts`）：只剪记录与计数桶，不碰判定状态。 */
    prune(): Promise<{ removedRecords: number; removedCounters: number }> {
      return pruneNotificationState({ load, retentionDays: async () => (await deps.getSettings()).retentionDays, persist, notifyChanged, exclusive, now: nowIso })
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
      return exclusive(async () => {
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
      })
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
      return exclusive(async () => {
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
      })
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
      return exclusive(async () => {
      const state = await load()
      const kept = state.records.filter((record: NotificationRecord) => record.state !== 'read')
      const deleted = state.records.length - kept.length
      if (deleted === 0) return { deleted: 0 }
      await persist({ ...state, records: kept })
      notifyChanged()
      return { deleted }
      })
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
    return exclusive(async () => {
    const state = await load()
    const index = state.records.findIndex((record: NotificationRecord) => record.id === id)
    if (index < 0) throw new Error(`Notification "${id}" was not found.`)

    const nextRecord = transform(state.records[index]!)
    const nextRecords = [...state.records]
    nextRecords[index] = nextRecord
    await persist({ ...state, records: nextRecords })
    notifyChanged()
    return toSafeNotificationRecord(nextRecord)
    })
  }
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>

/**
 * 4a「中心必达」：只要这条通知会走任何一个打断式通道，`channels` 就必须含 `center`。
 * 归一化放在这里一处，**不靠四个生产者各自记得传**——靠调用点记得，等于有四个地方会忘。
 * 这条不为「要不要响」负责：免打扰和通道开关仍由路由决定，它只保证「响过的东西一定能回看」。
 */
/** 未读优先时未读组在前；组内按 `createdAt` 倒序，同一毫秒用 `id` 兜底保证顺序稳定。 */
/** 键游标 `createdAt|id`：同一毫秒的多条各有不同 id，因此不会丢；也是排序位置，插入不影响已翻过的页。 */
/**
 * 从游标继续：找到那一条就从它之后开始；找不到（被删或被改状态移出本组）就按排序键
 * 取「排在游标之后」的第一条，**绝不退回数组下标**。
 */
