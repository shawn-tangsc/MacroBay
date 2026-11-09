export type PlatformEventProducer = {
  owner: 'platform' | 'product'
  productId?: string
}

export type PlatformEventEnvelope<TPayload = unknown> = {
  eventId: string
  eventRecordId?: string
  topic: string
  producer: PlatformEventProducer
  schemaVersion: number
  occurredAt: string
  recordedAt: string
  correlationId?: string
  causationId?: string
  /**
   * 发布去重键。**去重窗口与事件保留期相同**（30 天 / 5,000 条，见 `eventBusRetentionPolicy`）：
   * 被裁掉的事件不再参与去重，同一键在窗口之外再次出现会被当作**新事件**接受。
   * 想要「永远不重复」的调用方，必须自己保证键在窗口内不复用。
   */
  idempotencyKey?: string
  payload: TPayload
  safeMetadata?: Record<string, unknown>
}

export type PublishEventInput<TPayload = unknown> = {
  topic: string
  producer: PlatformEventProducer
  schemaVersion: number
  occurredAt?: string
  correlationId?: string
  causationId?: string
  idempotencyKey?: string
  payload: TPayload
  safeMetadata?: Record<string, unknown>
}

export type PlatformEventHandlerContext = {
  signal: AbortSignal
  attempt: number
  log: (entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }) => Promise<void>
}

export type PlatformEventHandler<TPayload = unknown> = (
  event: PlatformEventEnvelope<TPayload>,
  context: PlatformEventHandlerContext
) => Promise<void>

export type EventConsumerRetryPolicy = {
  maxAttempts: number
  backoff: 'none' | 'fixed' | 'exponential'
  baseDelayMs: number
  maxDelayMs: number
}

export type EventConsumerRegistration = {
  consumerId: string
  owner: 'platform' | 'product'
  productId?: string
  topics: string[]
  retryPolicy?: EventConsumerRetryPolicy
}

export type EventDeliveryStatus = 'pending' | 'completed' | 'dead-letter' | 'blocked'

export type PlatformEventDelivery = {
  deliveryId: string
  deliveryRecordId?: string
  eventId: string
  eventRecordId?: string
  consumerId: string
  status: EventDeliveryStatus
  attemptCount: number
  nextAttemptAt?: string
  lastAttemptAt?: string
  lastError?: string
  completedAt?: string
  deadLetteredAt?: string
}

export type PlatformEventCheckpoint = {
  consumerId: string
  lastCompletedRecordedAt: string
  lastCompletedEventId: string
  updatedAt: string
}

export type EventBusDiagnosticsQuery = {
  topic?: string
  consumerId?: string
  status?: EventDeliveryStatus
  limit?: number
}

export type EventBusDiagnosticsPage = {
  recentEvents: PlatformEventEnvelope[]
  failedDeliveries: PlatformEventDelivery[]
  deadLetterDeliveries: PlatformEventDelivery[]
  blockedDeliveries: PlatformEventDelivery[]
  checkpoints: PlatformEventCheckpoint[]
}

export type EventBusRuntime = {
  publish: <TPayload>(input: PublishEventInput<TPayload>) => Promise<PlatformEventEnvelope<TPayload>>
  publishDurably: <TPayload>(input: PublishEventInput<TPayload>) => Promise<PlatformEventEnvelope<TPayload>>
  registerConsumer: (registration: EventConsumerRegistration, handler: PlatformEventHandler) => void
  unregisterConsumer: (consumerId: string) => void
  dispatchPending: () => Promise<void>
  getDiagnostics: (query?: EventBusDiagnosticsQuery) => Promise<EventBusDiagnosticsPage>
  /**
   * 按保留期裁剪已落盘的事件与投递（幂等、可重入）。
   *
   * 启动时 hydration 之后自动跑一次，平台保留期任务每日再跑一次；`pending` 投递及其事件永不裁。
   */
  pruneRetained: (options?: { now?: string }) => Promise<{ removedEvents: number; removedDeliveries: number }>
}

export const DEFAULT_EVENT_CONSUMER_RETRY_POLICY: EventConsumerRetryPolicy = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelayMs: 1_000,
  maxDelayMs: 30_000
}

export const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024
export const MAX_EVENT_SAFE_METADATA_BYTES = 4_096

export const eventBusPersistentIdentityPolicy = {
  eventIdPrefix: 'evt',
  deliveryIdPrefix: 'dlv',
  eventRecordIdPrefix: 'event-record',
  deliveryRecordIdPrefix: 'delivery-record',
  legacyAmbiguousDeliveryStatus: 'blocked',
  legacyAmbiguousDeliveryError: 'legacy-event-identity-ambiguous',
  legacyMissingDeliveryError: 'legacy-event-identity-missing'
} as const

let eventIdCounter = 0
let deliveryIdCounter = 0

export function resetEventBusIdCountersForTests(nextEvent = 0, nextDelivery = 0): void {
  eventIdCounter = nextEvent
  deliveryIdCounter = nextDelivery
}

export function createEventId(prefix = eventBusPersistentIdentityPolicy.eventIdPrefix): string {
  eventIdCounter += 1
  return `${prefix}-${eventIdCounter}`
}

export function createDeliveryId(prefix = eventBusPersistentIdentityPolicy.deliveryIdPrefix): string {
  deliveryIdCounter += 1
  return `${prefix}-${deliveryIdCounter}`
}

export function synchronizeEventBusIdCounters(
  events: readonly Pick<PlatformEventEnvelope, 'eventId'>[],
  deliveries: readonly Pick<PlatformEventDelivery, 'deliveryId'>[]
): void {
  eventIdCounter = Math.max(eventIdCounter, readSequentialIdMaximum(events.map((event) => event.eventId), eventBusPersistentIdentityPolicy.eventIdPrefix))
  deliveryIdCounter = Math.max(deliveryIdCounter, readSequentialIdMaximum(deliveries.map((delivery) => delivery.deliveryId), eventBusPersistentIdentityPolicy.deliveryIdPrefix))
}

function readSequentialIdMaximum(ids: readonly string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  return ids.reduce((maximum, id) => {
    const matched = pattern.exec(id)
    return matched ? Math.max(maximum, Number(matched[1])) : maximum
  }, 0)
}
