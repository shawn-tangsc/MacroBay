import type {
  EventConsumerRegistration,
  EventConsumerRetryPolicy,
  PlatformEventHandler
} from '../contracts/eventBusContracts'
import { DEFAULT_EVENT_CONSUMER_RETRY_POLICY } from '../contracts/eventBusContracts'

export type RegisteredEventConsumer = EventConsumerRegistration & {
  handler: PlatformEventHandler
}

export type EventBusRegistry = {
  register: (registration: EventConsumerRegistration, handler: PlatformEventHandler) => void
  unregister: (consumerId: string) => void
  has: (consumerId: string) => boolean
  list: () => RegisteredEventConsumer[]
  findByTopic: (topic: string) => RegisteredEventConsumer[]
  invoke: (
    consumerId: string,
    event: Parameters<PlatformEventHandler>[0],
    context: Parameters<PlatformEventHandler>[1]
  ) => Promise<void>
}

export function createEventBusRegistry(): EventBusRegistry {
  const consumers = new Map<string, RegisteredEventConsumer>()

  return {
    register(registration, handler) {
      const consumerId = registration.consumerId.trim()
      if (!consumerId) {
        throw new Error('consumerId is required.')
      }
      if (consumers.has(consumerId)) {
        throw new Error(`Event consumer "${consumerId}" is already registered.`)
      }
      consumers.set(consumerId, {
        ...registration,
        consumerId,
        topics: [...new Set(registration.topics.map((topic) => topic.trim()).filter(Boolean))],
        retryPolicy: normalizeRetryPolicy(registration.retryPolicy),
        handler
      })
    },
    unregister(consumerId) {
      consumers.delete(consumerId)
    },
    has(consumerId) {
      return consumers.has(consumerId)
    },
    list() {
      return [...consumers.values()]
    },
    findByTopic(topic) {
      return [...consumers.values()].filter((consumer) => consumer.topics.includes(topic))
    },
    async invoke(consumerId, event, context) {
      const consumer = consumers.get(consumerId)
      if (!consumer) {
        throw new Error(`Unknown event consumer "${consumerId}".`)
      }
      await consumer.handler(event, context)
    }
  }
}

function normalizeRetryPolicy(policy?: EventConsumerRetryPolicy): EventConsumerRetryPolicy {
  if (!policy) return DEFAULT_EVENT_CONSUMER_RETRY_POLICY
  return {
    maxAttempts: Math.max(1, Math.floor(policy.maxAttempts || DEFAULT_EVENT_CONSUMER_RETRY_POLICY.maxAttempts)),
    backoff: policy.backoff ?? DEFAULT_EVENT_CONSUMER_RETRY_POLICY.backoff,
    baseDelayMs: Math.max(0, policy.baseDelayMs ?? DEFAULT_EVENT_CONSUMER_RETRY_POLICY.baseDelayMs),
    maxDelayMs: Math.max(0, policy.maxDelayMs ?? DEFAULT_EVENT_CONSUMER_RETRY_POLICY.maxDelayMs)
  }
}
