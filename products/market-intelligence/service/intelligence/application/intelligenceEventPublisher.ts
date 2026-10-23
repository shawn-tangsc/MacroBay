import type { EventBusRuntime } from '@platform/message-bus'

import type { IntelligenceEventCluster, IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import {
  INTELLIGENCE_EVENT_SCHEMA_VERSION,
  INTELLIGENCE_EVENT_TOPICS,
  type IntelligenceClusterUpdatedEvent,
  type IntelligenceImpactCreatedEvent,
  type IntelligenceItemCreatedEvent,
  type IntelligenceSentimentUpdatedEvent,
  type IntelligenceSourceHealthChangedEvent
} from '../schema/intelligenceEvents'
import type { IntelligencePipelineHealth } from './intelligencePipeline'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceEventPublisher = {
  publishItemCreated: (item: IntelligenceItem) => Promise<void>
  publishClusterUpdated: (cluster: IntelligenceEventCluster) => Promise<void>
  publishImpactCreated: (input: {
    impact: IntelligenceImpact
    item: IntelligenceItem
    title: string
    summary?: string
  }) => Promise<void>
  publishSentimentUpdated: (input: {
    aggregate: IntelligenceSentimentAggregate
    previous?: IntelligenceSentimentAggregate
  }) => Promise<void>
  publishSourceHealthChanged: (input: {
    health: IntelligencePipelineHealth
    previousStatus?: IntelligencePipelineHealth['runtimeStatus']
  }) => Promise<void>
}

export function createIntelligenceEventPublisher(eventBus: EventBusRuntime): IntelligenceEventPublisher {
  return {
    async publishItemCreated(item) {
      const payload: IntelligenceItemCreatedEvent = {
        itemId: item.itemId,
        clusterId: item.clusterId,
        sourceId: item.sourceId,
        title: item.title,
        summary: item.summary,
        occurredAt: item.publishedAt ?? item.detectedAt
      }
      await eventBus.publishDurably({
        topic: INTELLIGENCE_EVENT_TOPICS.itemCreated,
        producer: { owner: 'product', productId: PRODUCT_ID },
        schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
        idempotencyKey: `market-intelligence:item:${item.itemId}:v${INTELLIGENCE_EVENT_SCHEMA_VERSION}`,
        occurredAt: payload.occurredAt,
        payload
      })
    },

    async publishClusterUpdated(cluster) {
      const payload: IntelligenceClusterUpdatedEvent = {
        clusterId: cluster.clusterId,
        clusterType: cluster.clusterType,
        title: cluster.title,
        status: cluster.status,
        primaryItemId: cluster.primaryItemId,
        primarySourceId: cluster.primarySourceId,
        updatedAt: cluster.lastDetectedAt
      }
      await eventBus.publishDurably({
        topic: INTELLIGENCE_EVENT_TOPICS.clusterUpdated,
        producer: { owner: 'product', productId: PRODUCT_ID },
        schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
        idempotencyKey: `market-intelligence:cluster:${cluster.clusterId}:${cluster.lastDetectedAt}:v${INTELLIGENCE_EVENT_SCHEMA_VERSION}`,
        occurredAt: cluster.lastDetectedAt,
        payload
      })
    },

    async publishImpactCreated({ impact, item, title, summary }) {
      const payload: IntelligenceImpactCreatedEvent = {
        impactId: impact.impactId,
        itemId: impact.itemId,
        clusterId: impact.clusterId,
        sourceId: item.sourceId,
        layer: impact.layer,
        direction: impact.direction,
        confidence: impact.confidence,
        magnitude: impact.magnitude,
        horizon: impact.horizon,
        affectedScopes: mapImpactScope(impact.scopeType, impact.scopeKey),
        title,
        summary,
        occurredAt: impact.createdAt
      }
      await eventBus.publishDurably({
        topic: INTELLIGENCE_EVENT_TOPICS.impactCreated,
        producer: { owner: 'product', productId: PRODUCT_ID },
        schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
        idempotencyKey: `market-intelligence:impact:${impact.impactId}:v${INTELLIGENCE_EVENT_SCHEMA_VERSION}`,
        correlationId: impact.clusterId ?? impact.itemId,
        occurredAt: impact.createdAt,
        payload
      })
    },

    async publishSentimentUpdated({ aggregate, previous }) {
      const payload: IntelligenceSentimentUpdatedEvent = {
        aggregateId: aggregate.aggregateId,
        scope: mapSentimentScope(aggregate.scopeType, aggregate.scopeKey),
        score: aggregate.aggregateScore,
        label: aggregate.aggregateLabel,
        previousScore: previous?.aggregateScore,
        previousLabel: previous?.aggregateLabel,
        changedAt: aggregate.updatedAt,
        supportingImpactCount: countSupportingImpacts(aggregate.supportingImpactIdsJson),
        horizon: aggregate.horizon
      }
      await eventBus.publishDurably({
        topic: INTELLIGENCE_EVENT_TOPICS.sentimentUpdated,
        producer: { owner: 'product', productId: PRODUCT_ID },
        schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
        idempotencyKey: `market-intelligence:sentiment:${aggregate.aggregateId}:${aggregate.updatedAt}:v${INTELLIGENCE_EVENT_SCHEMA_VERSION}`,
        occurredAt: aggregate.updatedAt,
        payload
      })
    },

    async publishSourceHealthChanged({ health, previousStatus }) {
      const payload: IntelligenceSourceHealthChangedEvent = {
        sourceId: health.sourceId,
        runtimeStatus: health.runtimeStatus,
        previousStatus,
        changedAt: new Date().toISOString(),
        consecutiveFailures: health.consecutiveFailures,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt
      }
      await eventBus.publishDurably({
        topic: INTELLIGENCE_EVENT_TOPICS.sourceHealthChanged,
        producer: { owner: 'product', productId: PRODUCT_ID },
        schemaVersion: INTELLIGENCE_EVENT_SCHEMA_VERSION,
        idempotencyKey: `market-intelligence:source-health:${health.sourceId}:${health.runtimeStatus}:${payload.changedAt}:v${INTELLIGENCE_EVENT_SCHEMA_VERSION}`,
        occurredAt: payload.changedAt,
        payload
      })
    }
  }
}

function mapImpactScope(
  scopeType: IntelligenceImpact['scopeType'],
  scopeKey: string
): IntelligenceImpactCreatedEvent['affectedScopes'] {
  if (scopeType === 'symbol') return [{ type: 'symbol', id: scopeKey }]
  if (scopeType === 'sector') return [{ type: 'sector', id: scopeKey }]
  if (scopeType === 'risk-assets') return [{ type: 'risk-assets', id: scopeKey }]
  if (scopeType === 'exchange') return [{ type: 'venue', id: scopeKey }]
  return [{ type: 'market', id: scopeKey }]
}

function mapSentimentScope(
  scopeType: IntelligenceSentimentAggregate['scopeType'],
  scopeKey: string
): IntelligenceSentimentUpdatedEvent['scope'] {
  if (scopeType === 'symbol') return { type: 'symbol', id: scopeKey }
  if (scopeType === 'sector') return { type: 'sector', id: scopeKey }
  if (scopeType === 'market-wide' || scopeType === 'risk-assets' || scopeType === 'crypto-market') {
    return { type: 'market', id: scopeKey }
  }
  return { type: 'global', id: scopeKey }
}

function countSupportingImpacts(value?: string): number {
  if (!value?.trim()) return 0
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}
