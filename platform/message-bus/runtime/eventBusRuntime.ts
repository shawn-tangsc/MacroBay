import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import type {
  EventBusDiagnosticsPage,
  EventBusDiagnosticsQuery,
  EventBusRuntime,
  EventConsumerRegistration,
  PlatformEventEnvelope,
  PlatformEventDelivery,
  PlatformEventHandler,
  PublishEventInput
} from '../contracts/eventBusContracts'
import { validatePublishEventInput } from '../contracts/eventBusValidation'
import { createEventBusRegistry } from './eventBusRegistry'
import {
  createDefaultEventBusStoreState,
  createEventBusStore,
  normalizeEventBusStoreState,
  type EventBusStore,
  type EventBusStoreState
} from '../store/eventBusStore'
import type { EventConsumerRetryPolicy } from '../contracts/eventBusContracts'
import { eventBusPersistentIdentityPolicy, synchronizeEventBusIdCounters } from '../contracts/eventBusContracts'

export type EventBusStorage = JsonFileStorage<EventBusStoreState>

export const eventBusJsonStoragePolicy = {
  temporaryFileSuffix: '.next',
  writeOrdering: 'requested-order',
  backgroundFailureDiagnostic: 'Event bus background operation failed.'
} as const

export const eventBusDurablePublishPolicy = {
  deliveryScheduling: 'background-after-persist'
} as const

export function createEventBusJsonStorage(filePath: string): EventBusStorage {
  let writeTail = Promise.resolve()

  return {
    async read() {
      try {
        return normalizeEventBusStoreState(JSON.parse(await readFile(filePath, 'utf8')))
      } catch (error) {
        if (isMissingFileError(error) || isInvalidJsonError(error)) return createDefaultEventBusStoreState()
        throw error
      }
    },
    async write(value) {
      const requestedWrite = writeTail.then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        const temporaryPath = `${filePath}${eventBusJsonStoragePolicy.temporaryFileSuffix}`
        await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
        await rename(temporaryPath, filePath)
      })
      writeTail = requestedWrite.catch(() => undefined)
      await requestedWrite
    }
  }
}

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

  async function ensureHydrated(): Promise<void> {
    if (hydrated || !deps.storage) {
      hydrated = true
      return
    }
    if (!hydrationInFlight) {
      hydrationInFlight = (async () => {
        store.replaceState(await deps.storage!.read())
        synchronizeEventBusIdCounters(store.getState().events, store.getState().deliveries)
        hydrated = true
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
        checkpoints: checkpoints as EventBusDiagnosticsPage['checkpoints']
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

    const event = store.appendEvent(normalized, now)
    runtimePublishedEventIds.add(event.eventId)
    const consumerIds = registry.findByTopic(event.topic).map((consumer) => consumer.consumerId)
    if (consumerIds.length > 0) {
      store.appendDeliveries(event, consumerIds)
    }
    await persist()
    return event
  }

  async function dispatchPendingInternal(
    activeStore: EventBusStore,
    activeRegistry: ReturnType<typeof createEventBusRegistry>,
    persistState: () => Promise<void>
  ): Promise<void> {
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
