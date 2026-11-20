import type {
  EventBusDiagnosticsPage,
  EventBusDiagnosticsQuery,
  EventBusRuntime,
  EventConsumerRegistration,
  PlatformEventEnvelope,
  PlatformEventDelivery,
  PlatformEventHandler,
  PublishEventInput,
  EventBusStoreDiagnosticIntegrity
} from '../contracts/eventBusContracts'
import { validatePublishEventInput } from '../contracts/eventBusValidation'
import { createEventBusRegistry } from './eventBusRegistry'
import { pruneEventBusState } from '../store/eventBusRetention'
import { createEventBusStore, type EventBusStore, type EventBusStoreState } from '../store/eventBusStore'
import {
  createEventBusJsonStorage,
  eventBusJsonStoragePolicy,
  EventBusWriteBlockedError,
  type EventBusStorage,
  type EventBusStorageReadResult,
  type EventBusWriteBlockedReason
} from '../store/eventBusJsonStorage'

// 适配器搬去 `store/eventBusJsonStorage.ts`：落盘点只有一个文件，`writeFile` / `rename` 只在那里。
// 这两行再导出是为了不让既有调用点（IPC 注册、用例、模块出口）跟着改。
export { createEventBusJsonStorage, eventBusJsonStoragePolicy, EventBusWriteBlockedError }
export type { EventBusStorage, EventBusStorageReadResult }
import type { EventConsumerRetryPolicy } from '../contracts/eventBusContracts'
import { eventBusPersistentIdentityPolicy, synchronizeEventBusIdCounters } from '../contracts/eventBusContracts'

export const eventBusDurablePublishPolicy = {
  deliveryScheduling: 'background-after-persist'
} as const

export type EventBusRuntimeDependencies = {
  store?: EventBusStore
  storage?: EventBusStorage
}

export function createEventBusRuntime(deps: EventBusRuntimeDependencies = {}): EventBusRuntime {
  const registry = createEventBusRegistry()
  const store = deps.store ?? createEventBusStore()
  let hydrated = Boolean(deps.store)
  let hydrationInFlight: Promise<void> | null = null
  let backgroundOperationTail = Promise.resolve()
  let dispatchInFlight: Promise<void> | null = null
  const runtimePublishedEventIds = new Set<string>()
  /**
   * 闸门状态：读到 `corrupt` / `future-version` 之后进入**阻断态**——半个字节都不写、不派发、
   * 不裁剪。内存保持空，但「空」与「读不到」分开记账：诊断（第三笔）读这里，不读文件内容。
   */
  let blocked: Readonly<{
    reason: EventBusWriteBlockedReason
    /** 写进日志的那一档（比 `reason` 细一档：`invalid-json` / `shape` / `checksum-mismatch` / `future-version`）。 */
    logReason: string
    integrity: 'corrupt' | 'future-version'
  }> | undefined
  /**
   * 文件本身的完整性结论，诊断原样读它。初始值：有存储的文件但还没读 → `empty`
   * （主文件不存在与「读坏了」不是一件事）；纯内存运行时（没有存储）→ `ok`。
   */
  let integrity: EventBusStoreDiagnosticIntegrity = deps.storage ? 'empty' : 'ok'

  /**
   * 按保留期裁剪当前状态；删到东西才落盘（没删就不写，避免启动时做一次无意义的整份写回）。
   * 返回删了多少，供任务日志与用例断言——不把「裁了没有」变成只有实现知道的秘密。
   */
  async function pruneRetainedState(
    options?: { now?: string }
  ): Promise<{ removedEvents: number; removedDeliveries: number }> {
    // 阻断态下裁剪**一个字节都不写**（防御性，与「任何 persist 都不写」同一道闸的第二次应用）。
    if (blocked) return { removedEvents: 0, removedDeliveries: 0 }
    const result = pruneEventBusState(store.getState(), options)
    if (result.removedEvents === 0 && result.removedDeliveries === 0) {
      return { removedEvents: 0, removedDeliveries: 0 }
    }
    store.replaceState(result.state)
    await persist()
    return { removedEvents: result.removedEvents, removedDeliveries: result.removedDeliveries }
  }

  async function ensureHydrated(): Promise<void> {
    if (hydrated || !deps.storage) {
      hydrated = true
      return
    }
    if (!hydrationInFlight) {
      hydrationInFlight = (async () => {
        const outcome = await deps.storage!.read()
        if (outcome.integrity === 'corrupt' || outcome.integrity === 'future-version') {
          // 读到了、但读不懂：进入阻断态。**不**把内存换成「空」去当默认值，也不写回。
          const logReason = outcome.integrity === 'future-version' ? 'future-version' : outcome.problem
          blocked = {
            reason: outcome.integrity === 'future-version'
              ? 'future-version'
              : outcome.problem === 'checksum-mismatch' ? 'checksum-mismatch' : 'corrupt',
            logReason,
            integrity: outcome.integrity
          }
          integrity = outcome.integrity
          // 一行日志，够排障用：不带文件内容、不带事件体。与诊断里的 `integrity`/`blocked` 是同一份事实。
          console.warn(`event-bus-store-blocked reason=${logReason}`)
          hydrated = true
          return
        }
        blocked = undefined
        integrity = outcome.integrity
        store.replaceState(outcome.state)
        synchronizeEventBusIdCounters(store.getState().events, store.getState().deliveries)
        hydrated = true
        // 启动即裁一次：老文件不必等到第一次每日任务才缩小。
        await pruneRetainedState()
      })()
    }
    try {
      await hydrationInFlight
    } finally {
      hydrationInFlight = null
    }
  }

  async function persist(): Promise<void> {
    if (!deps.storage) return
    await deps.storage.write(store.getState())
    // 写成功了：文件现在是本版本写出的 v1（旧文件也在这一次写里升级完毕）。
    integrity = 'ok'
  }

  function queueBackgroundOperation(operation: () => Promise<void>): void {
    backgroundOperationTail = backgroundOperationTail.then(operation).catch(() => {
      console.warn(eventBusJsonStoragePolicy.backgroundFailureDiagnostic)
    })
  }

  return {
    async publish(input) {
      const event = await appendAndPersist(input)
      await dispatchPendingInternal(store, registry, persist)
      return event
    },

    async publishDurably(input) {
      const event = await appendAndPersist(input)
      queueBackgroundOperation(async () => {
        await dispatchPendingInternal(store, registry, persist)
      })
      return event
    },

    registerConsumer(registration, handler) {
      registry.register(registration, handler)
      const eventIdsPublishedBeforeRegistration = new Set(runtimePublishedEventIds)
      const hydration = ensureHydrated()
      queueBackgroundOperation(async () => {
        await hydration
        store.ensureDeliveriesForConsumer(registration.consumerId, registration.topics)
        await persist()
        const pendingDeliveryIds = store.getState().deliveries
          .filter((delivery) => delivery.consumerId === registration.consumerId && delivery.status === 'pending')
          .filter((delivery) => (
            !runtimePublishedEventIds.has(delivery.eventId) || eventIdsPublishedBeforeRegistration.has(delivery.eventId)
          ))
          .map((delivery) => delivery.deliveryRecordId ?? delivery.deliveryId)
        if (pendingDeliveryIds.length > 0) {
          await dispatchSelectedPendingInternal(pendingDeliveryIds)
        }
      })
    },

    unregisterConsumer(consumerId) {
      registry.unregister(consumerId)
    },

    async dispatchPending() {
      await ensureHydrated()
      await dispatchPendingInternal(store, registry, persist)
    },

    async pruneRetained(options) {
      await ensureHydrated()
      return pruneRetainedState(options)
    },

    /**
     * 显式归档阻断态的主文件（读者/诊断动作）。启动时**绝不**自动做：自动改名等于替读者决定
     * 「数据不要了」。归档成功后主文件缺失，下一次读是 `empty`，写重新被允许。
     */
    async archiveCorruptStore() {
      await ensureHydrated()
      if (!blocked || !deps.storage?.archiveCorruptStore) return undefined
      const archived = await deps.storage.archiveCorruptStore()
      if (archived !== undefined) {
        blocked = undefined
        // 归档后主文件不存在 = 首次安装那一态；写重新被允许。
        integrity = 'empty'
      }
      return archived
    },

    async getDiagnostics(query: EventBusDiagnosticsQuery = {}): Promise<EventBusDiagnosticsPage> {
      await ensureHydrated()
      const recentEvents = store.listRecentEvents({ topic: query.topic, limit: query.limit })
      const failedDeliveries = store
        .listDeliveries({ consumerId: query.consumerId, status: 'pending', limit: query.limit })
        .filter((delivery) => delivery.attemptCount > 0)
      const deadLetterDeliveries = store.listDeliveries({
        consumerId: query.consumerId,
        status: 'dead-letter',
        limit: query.limit
      })
      const blockedDeliveries = store.listDeliveries({
        consumerId: query.consumerId,
        status: eventBusPersistentIdentityPolicy.legacyAmbiguousDeliveryStatus,
        limit: query.limit
      })
      const checkpoints = query.consumerId
        ? [store.getCheckpoint(query.consumerId)].filter((checkpoint) => Boolean(checkpoint))
        : store.getState().checkpoints

      return {
        recentEvents,
        failedDeliveries,
        deadLetterDeliveries,
        blockedDeliveries,
        checkpoints: checkpoints as EventBusDiagnosticsPage['checkpoints'],
        // 「文件坏了所以写被拒」与「新功能自己写失败」在日志里长得像，诊断里必须一眼分开：
        // `events: 0` + `integrity: 'corrupt'` + `blocked: true` 是两回事。
        integrity,
        blocked: blocked !== undefined
      }
    }
  }

  async function appendAndPersist<TPayload>(input: PublishEventInput<TPayload>): Promise<PlatformEventEnvelope<TPayload>> {
    await ensureHydrated()
    const normalized = validatePublishEventInput(input)
    const now = new Date().toISOString()

    if (normalized.idempotencyKey) {
      const existing = store.findEventByIdempotencyKey(normalized.idempotencyKey)
      if (existing) {
        return existing as PlatformEventEnvelope<TPayload>
      }
    }

    // 先记快照：写失败要把这一笔**从内存撤回**，否则「查询得到、重启后没有」——
    // 更糟的是后续一次成功写会把它带出去（幽灵事件）。
    const snapshot = store.getState()
    const event = store.appendEvent(normalized, now)
    runtimePublishedEventIds.add(event.eventId)
    const consumerIds = registry.findByTopic(event.topic).map((consumer) => consumer.consumerId)
    if (consumerIds.length > 0) {
      store.appendDeliveries(event, consumerIds)
    }
    try {
      await persist()
    } catch (error) {
      store.replaceState(snapshot)
      runtimePublishedEventIds.delete(event.eventId)
      throw error
    }
    return event
  }

  async function dispatchPendingInternal(
    activeStore: EventBusStore,
    activeRegistry: ReturnType<typeof createEventBusRegistry>,
    persistState: () => Promise<void>
  ): Promise<void> {
    // 阻断态下派发停：每一轮都要 persist，继续跑只会在日志里刷失败。
    if (blocked) return
    if (dispatchInFlight) {
      await dispatchInFlight
    }

    await runSingleDispatchRound(activeStore, activeRegistry, persistState)

    while (hasUntriedDeliveries(activeStore)) {
      if (dispatchInFlight) {
        await dispatchInFlight
      }
      await runSingleDispatchRound(activeStore, activeRegistry, persistState)
    }
  }

  async function dispatchSelectedPendingInternal(deliveryRecordIds: readonly string[]): Promise<void> {
    if (dispatchInFlight) {
      await dispatchInFlight
    }
    const selectedDeliveryRecordIds = new Set(deliveryRecordIds)
    const pending = store
      .listPendingDeliveries(new Date().toISOString())
      .filter((delivery) => selectedDeliveryRecordIds.has(delivery.deliveryRecordId ?? delivery.deliveryId))
      .sort(compareDeliveries)
    if (pending.length === 0) return
    dispatchInFlight = runDispatchPass(pending, store, registry, persist)
    try {
      await dispatchInFlight
    } finally {
      dispatchInFlight = null
    }
  }

  async function runSingleDispatchRound(
    activeStore: EventBusStore,
    activeRegistry: ReturnType<typeof createEventBusRegistry>,
    persistState: () => Promise<void>
  ): Promise<void> {
    const now = new Date().toISOString()
    const pending = activeStore
      .listPendingDeliveries(now)
      .sort(compareDeliveries)
    if (pending.length === 0) {
      return
    }

    dispatchInFlight = runDispatchPass(pending, activeStore, activeRegistry, persistState)
    try {
      await dispatchInFlight
    } finally {
      dispatchInFlight = null
    }
  }

  async function runDispatchPass(
    pending: ReturnType<EventBusStore['listPendingDeliveries']>,
    activeStore: EventBusStore,
    activeRegistry: ReturnType<typeof createEventBusRegistry>,
    persistState: () => Promise<void>
  ): Promise<void> {
    for (const delivery of pending) {
      const resolved = activeStore.resolveDeliveryEvent(delivery)
      if (resolved.state === 'blocked') {
        activeStore.updateDelivery(delivery, {
          status: eventBusPersistentIdentityPolicy.legacyAmbiguousDeliveryStatus,
          lastError: resolved.error,
          nextAttemptAt: undefined
        })
        await persistState()
        continue
      }
      const event = resolved.event

      const consumer = activeRegistry.list().find((item) => item.consumerId === delivery.consumerId)
      if (!consumer) continue

      const attempt = delivery.attemptCount + 1
      const startedAt = new Date().toISOString()
      activeStore.updateDelivery(delivery, {
        attemptCount: attempt,
        lastAttemptAt: startedAt
      })

      try {
        await activeRegistry.invoke(delivery.consumerId, event, {
          signal: new AbortController().signal,
          attempt,
          log: async () => undefined
        })
        activeStore.updateDelivery(delivery, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          nextAttemptAt: undefined,
          lastError: undefined
        })
        activeStore.upsertCheckpoint({
          consumerId: delivery.consumerId,
          lastCompletedRecordedAt: event.recordedAt,
          lastCompletedEventId: event.eventId,
          updatedAt: new Date().toISOString()
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Event consumer failed.'
        const retryPolicy = consumer.retryPolicy ?? DEFAULT_RETRY
        if (attempt >= retryPolicy.maxAttempts) {
          activeStore.updateDelivery(delivery, {
            status: 'dead-letter',
            deadLetteredAt: new Date().toISOString(),
            lastError: message,
            nextAttemptAt: undefined
          })
        } else {
          activeStore.updateDelivery(delivery, {
            lastError: message,
            nextAttemptAt: new Date(Date.now() + computeBackoffDelay(retryPolicy, attempt)).toISOString()
          })
        }
      }

      await persistState()
    }
  }
}

const DEFAULT_RETRY: EventConsumerRetryPolicy = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelayMs: 1_000,
  maxDelayMs: 30_000
}

function hasUntriedDeliveries(store: EventBusStore): boolean {
  const now = new Date().toISOString()
  return store.listPendingDeliveries(now).some((delivery) => delivery.attemptCount === 0)
}

function compareDeliveries(left: PlatformEventDelivery, right: PlatformEventDelivery): number {
  const leftEventKey = left.eventRecordId ?? left.eventId
  const rightEventKey = right.eventRecordId ?? right.eventId
  const leftEvent = left.eventRecordId ? left.eventRecordId : leftEventKey
  const rightEvent = right.eventRecordId ? right.eventRecordId : rightEventKey
  return leftEvent.localeCompare(rightEvent)
}

function computeBackoffDelay(policy: EventConsumerRetryPolicy, attempt: number): number {
  if (policy.backoff === 'none') return 0
  if (policy.backoff === 'fixed') return policy.baseDelayMs
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1)
  return Math.min(exponential, policy.maxDelayMs)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError
}
