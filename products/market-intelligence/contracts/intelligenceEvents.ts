/**
 * Public Market Intelligence event contracts.
 * Producers and cross-product consumers must import from this module only.
 */

export const INTELLIGENCE_EVENT_SCHEMA_VERSION = 1

export type IntelligenceEventAffectedScope = {
  type: 'risk-assets' | 'market' | 'venue' | 'sector' | 'symbol'
  id: string
}

export type IntelligenceLayer =
  | 'macro'
  | 'industry'
  | 'asset'
  | 'exchange'
  | 'project'
  | 'infrastructure'

export type IntelligenceImpactDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type IntelligenceImpactHorizon = 'intraday' | '1d' | '1w' | '1m'

export type IntelligenceSentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed'

export type IntelligenceSentimentHorizon = '15m' | '1h' | '4h' | '24h'

export type IntelligenceItemCreatedEvent = {
  itemId: string
  clusterId?: string
  sourceId: string
  title: string
  summary?: string
  occurredAt: string
}

export type IntelligenceClusterUpdatedEvent = {
  clusterId: string
  clusterType: string
  title: string
  status: string
  primaryItemId: string
  primarySourceId: string
  updatedAt: string
}

export type IntelligenceImpactCreatedEvent = {
  impactId: string
  itemId: string
  clusterId?: string
  sourceId: string
  layer: IntelligenceLayer
  direction: IntelligenceImpactDirection
  confidence: number
  magnitude?: number
  horizon?: IntelligenceImpactHorizon
  affectedScopes: IntelligenceEventAffectedScope[]
  title: string
  summary?: string
  occurredAt: string
}

export type IntelligenceSentimentUpdatedEvent = {
  aggregateId: string
  scope: {
    type: 'global' | 'market' | 'symbol' | 'sector'
    id: string
  }
  score: number
  label: IntelligenceSentimentLabel
  previousScore?: number
  previousLabel?: IntelligenceSentimentLabel
  changedAt: string
  supportingImpactCount: number
  horizon: IntelligenceSentimentHorizon
}

export type IntelligenceSourceHealthChangedEvent = {
  sourceId: string
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  previousStatus?: 'healthy' | 'degraded' | 'failed' | 'paused'
  changedAt: string
  consecutiveFailures: number
  lastSuccessAt?: string
  lastFailureAt?: string
}

export const INTELLIGENCE_EVENT_TOPICS = {
  itemCreated: 'market-intelligence.item.created',
  clusterUpdated: 'market-intelligence.cluster.updated',
  impactCreated: 'market-intelligence.impact.created',
  sentimentUpdated: 'market-intelligence.sentiment.updated',
  sourceHealthChanged: 'market-intelligence.source.health.changed'
} as const
