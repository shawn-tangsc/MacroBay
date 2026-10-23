import type {
  EventDeliveryStatus,
  PlatformEventCheckpoint,
  PlatformEventDelivery,
  PlatformEventEnvelope
} from '../contracts/eventBusContracts'
import { createDeliveryId, createEventId, eventBusPersistentIdentityPolicy } from '../contracts/eventBusContracts'
import type { PublishEventInput } from '../contracts/eventBusContracts'

export type EventBusStoreState = {
  events: PlatformEventEnvelope[]
  deliveries: PlatformEventDelivery[]
  checkpoints: PlatformEventCheckpoint[]
}

export type EventBusStore = {
  getState: () => EventBusStoreState
  replaceState: (state: EventBusStoreState) => void
  findEventByIdempotencyKey: (idempotencyKey: string) => PlatformEventEnvelope | undefined
  appendEvent: <TPayload>(input: PublishEventInput<TPayload>, recordedAt: string) => PlatformEventEnvelope<TPayload>
  appendDeliveries: (event: PlatformEventEnvelope, consumerIds: string[]) => PlatformEventDelivery[]
  listPendingDeliveries: (now: string) => PlatformEventDelivery[]
  updateDelivery: (delivery: PlatformEventDelivery, patch: Partial<PlatformEventDelivery>) => PlatformEventDelivery | undefined
  upsertCheckpoint: (checkpoint: PlatformEventCheckpoint) => PlatformEventCheckpoint
  getCheckpoint: (consumerId: string) => PlatformEventCheckpoint | undefined
  listRecentEvents: (query?: { topic?: string; limit?: number }) => PlatformEventEnvelope[]
  listDeliveries: (query?: {
    consumerId?: string
    status?: EventDeliveryStatus
    limit?: number
  }) => PlatformEventDelivery[]
  ensureDeliveriesForConsumer: (consumerId: string, topics: readonly string[]) => PlatformEventDelivery[]
  resolveDeliveryEvent: (delivery: PlatformEventDelivery) =>
    | { state: 'resolved'; event: PlatformEventEnvelope }
    | { state: 'blocked'; error: string }
}

export function createDefaultEventBusStoreState(): EventBusStoreState {
  return {
    events: [],
    deliveries: [],
    checkpoints: []
  }
}

export function normalizeEventBusStoreState(value: unknown): EventBusStoreState {
  if (!value || typeof value !== 'object') return createDefaultEventBusStoreState()
  const candidate = value as Partial<EventBusStoreState>
  return {
    events: Array.isArray(candidate.events) ? candidate.events : [],
    deliveries: Array.isArray(candidate.deliveries) ? candidate.deliveries : [],
    checkpoints: Array.isArray(candidate.checkpoints) ? candidate.checkpoints : []
  }
}

export function createEventBusStore(initialState: EventBusStoreState = createDefaultEventBusStoreState()): EventBusStore {
  let state = ensurePersistentRecordIdentities(normalizeEventBusStoreState(initialState))

  return {
    getState() {
      return state
    },
    replaceState(next) {
      state = ensurePersistentRecordIdentities(normalizeEventBusStoreState(next))
    },
    findEventByIdempotencyKey(idempotencyKey) {
      return state.events.find((event) => event.idempotencyKey === idempotencyKey)
    },
    appendEvent<TPayload>(input: PublishEventInput<TPayload>, recordedAt: string): PlatformEventEnvelope<TPayload> {
      const event: PlatformEventEnvelope<TPayload> = {
        eventId: createEventId(),
        eventRecordId: createPersistentRecordId(eventBusPersistentIdentityPolicy.eventRecordIdPrefix, state.events.map((item) => item.eventRecordId)),
        topic: input.topic,
        producer: input.producer,
        schemaVersion: input.schemaVersion,
        occurredAt: input.occurredAt ?? recordedAt,
        recordedAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        safeMetadata: input.safeMetadata
      }
      state = { ...state, events: [...state.events, event] }
      return event
    },
    appendDeliveries(event, consumerIds) {
      const occupiedRecordIds = state.deliveries.map((item) => item.deliveryRecordId)
      const created = consumerIds.map((consumerId) => {
        const deliveryRecordId = createPersistentRecordId(
          eventBusPersistentIdentityPolicy.deliveryRecordIdPrefix,
          occupiedRecordIds
        )
        occupiedRecordIds.push(deliveryRecordId)
        return {
          deliveryId: createDeliveryId(),
          deliveryRecordId,
          eventId: event.eventId,
          eventRecordId: event.eventRecordId,
          consumerId,
          status: 'pending' as const,
          attemptCount: 0
        }
      })
      state = { ...state, deliveries: [...state.deliveries, ...created] }
      return created
    },
    listPendingDeliveries(now) {
      return state.deliveries.filter(
        (delivery) =>
          delivery.status === 'pending' && (!delivery.nextAttemptAt || delivery.nextAttemptAt <= now)
      )
    },
    updateDelivery(delivery, patch) {
      const index = state.deliveries.findIndex((item) => item.deliveryRecordId === delivery.deliveryRecordId)
      if (index < 0) return undefined
      const next = { ...state.deliveries[index]!, ...patch }
      const deliveries = [...state.deliveries]
      deliveries[index] = next
      state = { ...state, deliveries }
      return next
    },
    upsertCheckpoint(checkpoint) {
      const index = state.checkpoints.findIndex((item) => item.consumerId === checkpoint.consumerId)
      if (index < 0) {
        state = { ...state, checkpoints: [...state.checkpoints, checkpoint] }
        return checkpoint
      }
      const checkpoints = [...state.checkpoints]
      checkpoints[index] = checkpoint
      state = { ...state, checkpoints }
      return checkpoint
    },
    getCheckpoint(consumerId) {
      return state.checkpoints.find((checkpoint) => checkpoint.consumerId === consumerId)
    },
    listRecentEvents(query = {}) {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      const filtered = query.topic
        ? state.events.filter((event) => event.topic === query.topic)
        : state.events
      return [...filtered].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)).slice(0, limit)
    },
    listDeliveries(query = {}) {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      const filtered = state.deliveries.filter((delivery) => {
        if (query.consumerId && delivery.consumerId !== query.consumerId) return false
        if (query.status && delivery.status !== query.status) return false
        return true
      })
      return filtered.slice(-limit)
    },
    ensureDeliveriesForConsumer(consumerId, topics) {
      const topicSet = new Set(topics)
      const existingEventRecordIds = new Set(
        state.deliveries
          .filter((delivery) => delivery.consumerId === consumerId)
          .map((delivery) => delivery.eventRecordId ?? delivery.eventId)
      )
      const missingEvents = state.events
        .filter((event) => topicSet.has(event.topic) && !existingEventRecordIds.has(event.eventRecordId ?? event.eventId))
      if (missingEvents.length === 0) return []
      const created: PlatformEventDelivery[] = []
      for (const event of missingEvents) {
        created.push({
          deliveryId: createDeliveryId(),
          deliveryRecordId: createPersistentRecordId(eventBusPersistentIdentityPolicy.deliveryRecordIdPrefix, [
            ...state.deliveries.map((item) => item.deliveryRecordId),
            ...created.map((item) => item.deliveryRecordId)
          ]),
          eventId: event.eventId,
          eventRecordId: event.eventRecordId,
          consumerId,
          status: 'pending',
          attemptCount: 0
        })
      }
      state = { ...state, deliveries: [...state.deliveries, ...created] }
      return created
    },
    resolveDeliveryEvent(delivery) {
      if (delivery.eventRecordId) {
        const event = state.events.find((item) => item.eventRecordId === delivery.eventRecordId)
        return event
          ? { state: 'resolved', event }
          : { state: 'blocked', error: eventBusPersistentIdentityPolicy.legacyMissingDeliveryError }
      }
      const matchingEvents = state.events.filter((event) => event.eventId === delivery.eventId)
      return matchingEvents.length === 1
        ? { state: 'resolved', event: matchingEvents[0]! }
        : { state: 'blocked', error: matchingEvents.length === 0
          ? eventBusPersistentIdentityPolicy.legacyMissingDeliveryError
          : eventBusPersistentIdentityPolicy.legacyAmbiguousDeliveryError }
    }
  }
}

function createPersistentRecordId(prefix: string, existingIds: readonly (string | undefined)[]): string {
  let ordinal = existingIds.length + 1
  let candidate = `${prefix}-${ordinal}`
  const occupied = new Set(existingIds.filter((value): value is string => Boolean(value)))
  while (occupied.has(candidate)) {
    ordinal += 1
    candidate = `${prefix}-${ordinal}`
  }
  return candidate
}

function ensurePersistentRecordIdentities(state: EventBusStoreState): EventBusStoreState {
  return {
    ...state,
    events: state.events,
    deliveries: state.deliveries.map((delivery, index) => ({
      ...delivery,
      deliveryRecordId: delivery.deliveryRecordId ?? `${eventBusPersistentIdentityPolicy.deliveryRecordIdPrefix}-${index + 1}`
    }))
  }
}
