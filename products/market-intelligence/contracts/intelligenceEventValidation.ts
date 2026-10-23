import type {
  IntelligenceClusterUpdatedEvent,
  IntelligenceImpactCreatedEvent,
  IntelligenceItemCreatedEvent,
  IntelligenceSentimentUpdatedEvent,
  IntelligenceSourceHealthChangedEvent
} from './intelligenceEvents'

export function isIntelligenceImpactCreatedEvent(payload: unknown): payload is IntelligenceImpactCreatedEvent {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<IntelligenceImpactCreatedEvent>
  return Boolean(
    value.impactId?.trim() &&
      value.itemId?.trim() &&
      value.sourceId?.trim() &&
      value.direction &&
      typeof value.confidence === 'number' &&
      value.title?.trim() &&
      value.occurredAt?.trim() &&
      Array.isArray(value.affectedScopes)
  )
}

export function isIntelligenceSentimentUpdatedEvent(payload: unknown): payload is IntelligenceSentimentUpdatedEvent {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<IntelligenceSentimentUpdatedEvent>
  return Boolean(
    value.aggregateId?.trim() &&
      value.scope?.id?.trim() &&
      value.scope?.type &&
      typeof value.score === 'number' &&
      value.label &&
      value.changedAt?.trim() &&
      typeof value.supportingImpactCount === 'number' &&
      value.horizon
  )
}

export function isIntelligenceClusterUpdatedEvent(payload: unknown): payload is IntelligenceClusterUpdatedEvent {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<IntelligenceClusterUpdatedEvent>
  return Boolean(
    value.clusterId?.trim() &&
      value.clusterType?.trim() &&
      value.title?.trim() &&
      value.status?.trim() &&
      value.primaryItemId?.trim() &&
      value.primarySourceId?.trim() &&
      value.updatedAt?.trim()
  )
}

export function isIntelligenceItemCreatedEvent(payload: unknown): payload is IntelligenceItemCreatedEvent {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<IntelligenceItemCreatedEvent>
  return Boolean(
    value.itemId?.trim() &&
      value.sourceId?.trim() &&
      value.title?.trim() &&
      value.occurredAt?.trim()
  )
}

export function isIntelligenceSourceHealthChangedEvent(
  payload: unknown
): payload is IntelligenceSourceHealthChangedEvent {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<IntelligenceSourceHealthChangedEvent>
  return Boolean(
    value.sourceId?.trim() &&
      value.runtimeStatus &&
      value.changedAt?.trim() &&
      typeof value.consecutiveFailures === 'number'
  )
}
