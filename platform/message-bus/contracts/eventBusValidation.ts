import type { PublishEventInput, PlatformEventProducer } from './eventBusContracts'
import { MAX_EVENT_PAYLOAD_BYTES, MAX_EVENT_SAFE_METADATA_BYTES } from './eventBusContracts'

export class EventBusValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventBusValidationError'
  }
}

export function normalizeEventProducer(producer: PlatformEventProducer): PlatformEventProducer {
  if (producer.owner !== 'platform' && producer.owner !== 'product') {
    throw new EventBusValidationError('Producer owner must be "platform" or "product".')
  }
  if (producer.owner === 'product' && !producer.productId?.trim()) {
    throw new EventBusValidationError('Product producers must include productId.')
  }
  if (producer.owner === 'platform' && producer.productId) {
    return { owner: 'platform' }
  }
  return {
    owner: producer.owner,
    productId: producer.productId?.trim() || undefined
  }
}

export function validatePublishEventInput<TPayload>(input: PublishEventInput<TPayload>): PublishEventInput<TPayload> {
  const topic = input.topic?.trim()
  if (!topic) {
    throw new EventBusValidationError('Event topic is required.')
  }
  if (!Number.isFinite(input.schemaVersion) || input.schemaVersion < 1) {
    throw new EventBusValidationError('schemaVersion must be a positive number.')
  }

  const payloadSize = measureJsonBytes(input.payload)
  if (payloadSize > MAX_EVENT_PAYLOAD_BYTES) {
    throw new EventBusValidationError(`Event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`)
  }

  const safeMetadata = input.safeMetadata ? sanitizeSafeMetadata(input.safeMetadata) : undefined

  return {
    topic,
    producer: normalizeEventProducer(input.producer),
    schemaVersion: Math.floor(input.schemaVersion),
    occurredAt: input.occurredAt?.trim() || undefined,
    correlationId: input.correlationId?.trim() || undefined,
    causationId: input.causationId?.trim() || undefined,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
    payload: input.payload,
    safeMetadata
  }
}

export function sanitizeSafeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(metadata)
  if (serialized.length > MAX_EVENT_SAFE_METADATA_BYTES) {
    return { truncated: true }
  }
  const blocked = /(api[_-]?key|api[_-]?secret|authorization|password|token)/i
  if (blocked.test(serialized)) {
    return { redacted: true }
  }
  return metadata
}

function measureJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
}
