import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import type { MarketIntelligenceQueryFilters } from './queryContracts'

function hasFilters(filters?: MarketIntelligenceQueryFilters): filters is MarketIntelligenceQueryFilters {
  if (!filters) return false
  return Boolean(
    filters.layers?.length ||
      filters.sourceIds?.length ||
      filters.directions?.length ||
      filters.minConfidence !== undefined ||
      filters.horizon
  )
}

export function itemMatchesQueryFilters(item: IntelligenceItem, filters?: MarketIntelligenceQueryFilters): boolean {
  if (!hasFilters(filters) || !filters.sourceIds?.length) return true
  return filters.sourceIds.includes(item.sourceId)
}

export function impactMatchesQueryFilters(
  impact: IntelligenceImpact,
  filters?: MarketIntelligenceQueryFilters,
  item?: IntelligenceItem
): boolean {
  if (!hasFilters(filters)) return true

  if (filters.sourceIds?.length) {
    if (!item || !filters.sourceIds.includes(item.sourceId)) {
      return false
    }
  }

  if (filters.layers?.length && !filters.layers.includes(impact.layer)) {
    return false
  }

  if (filters.directions?.length && !filters.directions.includes(impact.direction)) {
    return false
  }

  if (typeof filters.minConfidence === 'number' && impact.confidence < filters.minConfidence) {
    return false
  }

  return true
}

export function itemMatchesImpactFilters(
  item: IntelligenceItem,
  impacts: IntelligenceImpact[],
  filters?: MarketIntelligenceQueryFilters
): boolean {
  if (!itemMatchesQueryFilters(item, filters)) return false
  if (!hasFilters(filters)) return true

  const itemImpacts = impacts.filter((impact) => impact.itemId === item.itemId)
  if (itemImpacts.length === 0) {
    return !filters.layers?.length && !filters.directions?.length && filters.minConfidence === undefined
  }

  return itemImpacts.some((impact) => impactMatchesQueryFilters(impact, filters, item))
}

export function aggregateMatchesQueryFilters(
  aggregate: IntelligenceSentimentAggregate,
  itemsById: Map<string, IntelligenceItem>,
  filters?: MarketIntelligenceQueryFilters
): boolean {
  if (!hasFilters(filters)) return true

  if (filters.horizon && aggregate.horizon !== filters.horizon) {
    return false
  }

  if (typeof filters.minConfidence === 'number') {
    const confidence = aggregate.confidence ?? 0
    if (confidence < filters.minConfidence) return false
  }

  if (filters.sourceIds?.length) {
    const supportingItems = parseIdList(aggregate.supportingItemIdsJson)
      .map((itemId) => itemsById.get(itemId))
      .filter((item): item is IntelligenceItem => Boolean(item))
    if (!supportingItems.some((item) => filters.sourceIds!.includes(item.sourceId))) {
      return false
    }
  }

  if (filters.layers?.length) {
    const breakdown = parseJsonRecord(aggregate.layerBreakdownJson)
    const layers = breakdown ? Object.keys(breakdown) : []
    if (!layers.some((layer) => filters.layers!.includes(layer as IntelligenceImpact['layer']))) {
      return false
    }
  }

  if (filters.directions?.length) {
    const breakdown = parseJsonRecord(aggregate.directionBreakdownJson)
    const directions = breakdown ? Object.keys(breakdown) : []
    if (!directions.some((direction) => filters.directions!.includes(direction as IntelligenceImpact['direction']))) {
      return false
    }
  }

  return true
}

function parseIdList(value?: string): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function parseJsonRecord(value?: string): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
