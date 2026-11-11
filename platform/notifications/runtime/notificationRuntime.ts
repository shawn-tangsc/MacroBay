import {
  acknowledgeNotification,
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
  NotificationSuppressedLevel,
  NotificationUnreadState,
  NotificationCenterItem
} from '../contracts/notificationContracts'
import type { NotificationEventCatalog } from '../contracts/notificationEventCatalog'
import type { NotificationProducerOwnership } from '../contracts/notificationProducerOwnership'
import type { NotificationCopyPort } from '../contracts/notificationCopyPort'
import type { NotificationCopyLanguage } from '../../i18n/notificationCopy'
import { toNotificationCenterItem } from './notificationCenterItem'
import { pruneNotificationRecords } from '../store/notificationRetention'
import { findActiveDuplicate } from '../runtime/notificationDedupe'
import { planNotificationSubmit } from './notificationSubmitPlan'
import { rejectionTraceLevel } from '../contracts/notificationSubmitRejection'
import { reportPersistFailure, traceSubmitFailure } from './notificationSubmitFailureTrace'
import { pruneNotificationDailyCounters } from './notificationBreaker'
import { countSameEventToday, decideDailyCap, foldSuppressedIntoLatest, withCenterForDisruptiveChannels } from './notificationAggregate'
import { evaluateProducerGate } from './notificationProducerGate'
import { emitBackoffEvent } from './notificationBackoffEvents'
import { reportProviderCredentialFlip, type ProviderCredentialSignal } from './notificationCredentialHealth'
import { pruneNotificationState } from './notificationRuntimePrune'
import {
  normalizeRequestedChannels,
  routeTransientDelivery,
  type DeliveryAttempt,
  type DeliveryHooks,
  type NotificationClock,
  type NotificationDeliveryContent
} from '../runtime/notificationRouting'
import { createNotificationDelivery } from './notificationRuntimeDelivery'
import { NO_PUSH_CHANNEL, type PushChannelResolution } from '../delivery/pushChannelResolution'
import { composeRedeliverSurface } from './notificationRedeliverSurface'
import { composeSelfTestSurface } from './notificationSelfTestSurface'
import { reportNarrowingWidened } from './notificationNarrowingTrace'
import { composeNotificationRuntimeSurfaces } from './notificationRuntimeSurfaces'
import { composeNotificationReadSurface } from './notificationRuntimeRead'
import { decideSeverityUpgrade } from './notificationSeverityUpgrade'
import { renderPlatformEventCopy } from '../producers/platformEventCopy'
import {
  compareNotifications,
  notificationCursorKey,
  resumeIndex,
  unreadStateOf
} from './notificationRuntimeQuery'

// 文件存储搬到自己的模块（运行时越过 500 行后抽出）；消费方仍从这里取，导入面不变。
import type { NotificationStorage } from './notificationJsonStorage'
export { createNotificationJsonStorage, type NotificationStorage } from './notificationJsonStorage'

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
  /** 诊断出口（runtime §2）：**必传**——漏传时「能记但没人接」＝根本没留痕。 */
  diagnostics: NotificationDiagnosticsSink
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
  /** 通道侧「最近一次真实投递」；缺省时设置页只说「没有记录」，不猜。 */
  lastDelivery?: (channelId: string) => {
    status: 'delivered' | 'failed' | 'unknown-after-send'
    at: string
    conversationLabel: string | null
  } | null
  /** 目标通道的**唯一派生**（技术方案 §1），主推送/升级/重投共用；缺省＝一条都没有，绝不回退读旧字段。 */
  resolvePushChannel?: () => Promise<PushChannelResolution>
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
      reportPersistFailure({ error, diagnostics: deps.diagnostics, at: nowIso() })
      throw error
    }
  }

  /** 新提交路径（契约 §3.2）：规划器回答「变成什么」，这里落库、合并与投递。 */
  async function submitEvent(request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome> {
    const outcome = await traceSubmitFailure(() => decideAndStoreSubmit(request), { eventTypeId: request.eventTypeId, diagnostics: deps.diagnostics, at: nowIso })
    // 被拒也要留一行痕（2026-11-08）：调用方普遍 `catch {}`，拒收原本三处都查不到。只留痕、不改行为。
    if (outcome.kind === 'rejected') {
      deps.diagnostics({
        code: outcome.reason,
        level: rejectionTraceLevel(outcome.reason),
        eventTypeId: request.eventTypeId,
        at: nowIso()
      })
    }
    return outcome
  }

  async function decideAndStoreSubmit(request: NotificationSubmitRequest): Promise<NotificationSubmitOutcome> {
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

    // 当日上限与最小间隔的**计数**：从记录里数（UTC 日），不是另一份计数器。
    const sameEventToday = countSameEventToday(state.records, request.eventTypeId, now)
    const first = planNotificationSubmit({
      catalog: deps.catalog,
      settings,
      desktopSupported: deps.desktopSupported?.() ?? true,
      request,
      sameEventToday,
      now,
      timeZone: deps.clock.timeZone()
    })
    if (first.kind === 'rejected') {
      // 被上限/冷却拦下的那一条不能凭空消失：「今天还出过一次」要落到今天最后那条同事件记录上，
      // 读者看到「共 N 次」，排障在记录里读到 `lastSuppressedReason`；没有可折叠记录才原样拒收。
      if (first.outcome.reason === 'daily-limit-reached' || first.outcome.reason === 'minimum-gap-active') {
        const folded = foldSuppressedIntoLatest({
          records: state.records,
          eventTypeId: request.eventTypeId,
          now,
          reason: first.outcome.reason
        })
        if (folded !== undefined) {
          await persistWithDiagnostics({ ...state, records: folded.records })
          notifyChanged()
          return {
            kind: 'merged',
            recordId: folded.record.id,
            occurrenceCount: folded.record.occurrenceCount,
            mergedEventTypes: folded.record.mergedEventTypes ?? [folded.record.eventTypeId]
          }
        }
      }
      return first.outcome
    }

    // 合并目标要看窗口：`condition` 事件只在「最近一次更新还在窗口内」时合并，窗口外开新行。
    const duplicateEntry = deps.catalog?.get(request.eventTypeId)
    const duplicate = findActiveDuplicate(
      state.records,
      first.incoming,
      now,
      duplicateEntry?.dedupeUnit === 'condition' ? duplicateEntry.conditionWindowMs : undefined
    )
    const plan = duplicate
      ? planNotificationSubmit({
          catalog: deps.catalog,
          settings,
          desktopSupported: deps.desktopSupported?.() ?? true,
          request,
          sameEventToday,
          now,
          timeZone: deps.clock.timeZone(),
          duplicate
        })
      : first
    if (plan.kind === 'rejected') return plan.outcome

    if (plan.kind === 'merge') {
      reportNarrowingWidened({ duplicate: plan.duplicate, levels: plan.levels, eventTypeId: request.eventTypeId, diagnostics: deps.diagnostics, at: now })
      const merged = mergeDuplicateNotification(plan.duplicate, plan.incoming, now, {
        incrementCount: plan.incrementCount
      })
      // 契约 §16.3.4：合并不重推，但「同一件事更严重了」是新事实——严格升级才再推一次手机。
      // 只推手机这一面、不新建行、不动键；与 `redeliverPush` 是两条入口，互不调用。
      const upgradeEvent = deps.catalog?.get(request.eventTypeId)
      const upgrade = upgradeEvent === undefined
        ? ({ kind: 'none', why: 'not-condition' } as const)
        : decideSeverityUpgrade({ entry: upgradeEvent, duplicate: plan.duplicate, request })
      const next = upgrade.kind === 'upgrade'
        ? await delivery.deliverSeverityUpgrade(merged, settings, state.pushBackoff, upgrade.severity)
        : undefined
      const settled = next?.record ?? merged
      const records = state.records.map((item: NotificationRecord) => (item.id === settled.id ? settled : item))
      await persistWithDiagnostics({
        ...state,
        records,
        ...(next === undefined ? {} : { pushBackoff: next.pushBackoff })
      })
      notifyChanged()
      if (next?.transition !== undefined) {
        await emitBackoffEvent({ transition: next.transition, now, submit: submitEvent })
      }
      return {
        kind: 'merged',
        recordId: settled.id,
        occurrenceCount: settled.occurrenceCount,
        mergedEventTypes: settled.mergedEventTypes ?? [settled.eventTypeId],
        // 只有严重度升级那一次真的又推了手机；普通合并里旧记录的投递是历史，不是这次的结果。
        ...(next?.record.delivery.push === undefined ? {} : { delivery: { push: next.record.delivery.push } })
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
    // 同组两条的存量选择对不上：三面已按「都关」处理，这里补一行诊断——
    // 「都关」看起来跟读者自己关掉一模一样，不记就没人知道少了什么（契约 §5.5）。
    if (plan.surfaceConflict) {
      deps.diagnostics?.({
        code: 'surface-selection-conflict',
        at: now,
        eventTypeId: record.eventTypeId,
        recordId: record.id
      })
    }
    await persistWithDiagnostics({ ...state, records: [record, ...state.records], dailyCounters })
    notifyChanged()
    const delivered = await delivery.deliverNewRecord(record, settings, state.pushBackoff, request.signalSeverity, plan.quietHours)
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
      const blockedCopy = renderPlatformEventCopy({ eventTypeId: 'platform.desktop.blocked' })
      if (blockedCopy !== undefined) {
        await submitEvent({
          eventTypeId: 'platform.desktop.blocked',
          producerId: 'platform',
          dedupeVars: { builder: 'template', vars: { recordId: record.id } },
          rendered: blockedCopy,
          actions: [],
          occurredAt: now
        })
      }
    }
    // 手机那一档若被免打扰摘掉，路由表里没有它（它不在 record.channels 里），
    // 所以「没被尝试」要在这一层补齐：已批 channel、却没排上，且决定是免打扰。
    const narrowedByQuietHours = plan.quietHours.inside && !plan.quietHours.bypassed &&
      !(record.appliedLevels ?? []).includes('channel') &&
      (deps.catalog?.get(record.eventTypeId)?.approvedDisruptionLevels.includes('channel') ?? false)
    // 被本机开关挡在门外的档也一样要说清：「没测」不是「没到」。只在事件确实批过这一档时才算，
    // 且提示那一档要看是不是被「桌面优先」挤掉的（那不是读者的开关）。
    const declared = deps.catalog?.get(record.eventTypeId)?.approvedDisruptionLevels ?? []
    const applied = record.appliedLevels ?? []
    const switchedOff: NotificationSuppressedLevel[] = []
    if (!applied.includes('desktop') && declared.includes('desktop') && !settings.desktopEnabled) {
      switchedOff.push({ level: 'desktop', reason: 'desktop-disabled' })
    }
    if (!applied.includes('desktop') && !applied.includes('toast') && declared.includes('toast') && !settings.toastEnabled) {
      switchedOff.push({ level: 'toast', reason: 'toast-disabled' })
    }
    const suppressedLevels: readonly NotificationSuppressedLevel[] = [
      ...delivered.suppressedLevels,
      ...switchedOff,
      ...(narrowedByQuietHours ? [{ level: 'push', reason: 'quiet-hours' } as const] : [])
    ]
    // 投递证据与记录**同源**：四档原样抄记录上的那几条，不从别处反推。
    return { ...plan.outcome, suppressedLevels, delivery: delivered.record.delivery }
  }

  /** P4a/P4b 的提交点：抽出到 `notificationCredentialHealth.ts`，这里只接线。 */
  const reportProviderCredential = (input: ProviderCredentialSignal) => reportProviderCredentialFlip(input, { load, persistWithDiagnostics, notifyChanged, submit: submitEvent, now: nowIso })

  // 两个面（设置面 / 投递面）的装配搬到 `notificationRuntimeSurfaces.ts`：这里只留接线一条。
  const { settingsSurface, delivery } = composeNotificationRuntimeSurfaces(deps, {
    load,
    exclusive,
    persistWithDiagnostics,
    notifyChanged,
    now: nowIso
  })

  /**
   * 一条记录给渲染层的样子：句子在这里解析（读的那一刻），键与参数留在这边。
   *
   * `category` 从**事件目录**取而不是存在记录上：目录是类型标签唯一来源（契约 v2.34），
   * 记录只存 id。目录里没有这条事件（旧记录、已撤事件）就没有标签——界面不编一个。
   * `language` 可由调用方一次取好传进来：列表要解析一整页，不该每条读一次设置。
   */
  async function centerItem(
    record: NotificationRecord,
    content?: NotificationDeliveryContent
  ): Promise<NotificationCenterItem> {
    // 投递路径上正文刚解析过，直接传进来——不解析第二遍，否则同一屏可能出现两种说法。
    const resolved = content ?? await delivery.resolveContent(record)
    return toNotificationCenterItem(record, resolved, deps.catalog?.get(record.eventTypeId)?.category)
  }

  return {
    submit,
    /** 推送目标（唯一派生）：产品侧要读「发到哪条、几条可用」，别再造第二份三档判定。 */
    resolvePushChannel: deps.resolvePushChannel ?? (async () => NO_PUSH_CHANNEL),

    /**
     * 渲染层看到的那一份（落地约束 v1.2 §1）：应用内投递与列表共用**同一个**投影。
     * 同一记录在两处显示不同句子，比显示得难看严重得多。
     */
    toCenterItem: (record: NotificationRecord, content?: NotificationDeliveryContent): Promise<NotificationCenterItem> =>
      centerItem(record, content),

    ...composeSelfTestSurface({ resolvePushChannel: deps.resolvePushChannel ?? (async () => NO_PUSH_CHANNEL),
      submitRequest: (request) => submitEvent(request), now: nowIso }),
    ...settingsSurface,
    reportProviderCredential,

    ...composeRedeliverSurface({ getSettings: deps.getSettings, resolveContent: (record) => delivery.resolveContent(record), pushHook: deps.deliveryHooks?.push, now: nowIso, load, exclusive, persistWithDiagnostics, notifyChanged, diagnostics: deps.diagnostics, resolvePushChannel: deps.resolvePushChannel ?? (async () => NO_PUSH_CHANNEL) }),

    async initialize(): Promise<void> {
      await load()
    },

    /** 保留期清理（实现见 `notificationRuntimePrune.ts`）：只剪记录与计数桶，不碰判定状态。 */
    prune(): Promise<{ removedRecords: number; removedCounters: number }> {
      return pruneNotificationState({ load, retentionDays: async () => (await deps.getSettings()).retentionDays, persist, notifyChanged, exclusive, now: nowIso })
    },

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
    async submitSelfTest(request: NotificationRequest): Promise<{ record: NotificationCenterItem; delivery: DeliveryAttempt[] }> {
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
      // 正文先解析再路由：这条记录走的四个表面必须拿到同一份句子（测试通知以前会把键当标题发出去）。
      const content = await delivery.resolveContent(record)
      const attempts = await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock, content)
      return { record: await centerItem(record), delivery: attempts }
      })
    },

    ...composeNotificationReadSurface({
      load,
      exclusive,
      persist,
      notifyChanged,
      version: () => version,
      nowIso,
      centerItem,
      resolveContent: (record, language) => delivery.resolveContent(record, language),
      ...(deps.getLanguage === undefined ? {} : { getLanguage: () => deps.getLanguage!() }),
      ...(deps.readDesktopPermission === undefined
        ? {}
        : { readDesktopPermission: () => deps.readDesktopPermission!() })
    })
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
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>
