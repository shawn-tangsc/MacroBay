import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import { compareIsoTime, isVisibleAsOf, isWithinEventTimeWindow, normalizeTimeWindow, VISIBLE_AT } from './asOfVisibility'
import { buildEvidenceRef } from './evidenceSnapshotBuilder'
import {
  aggregateMatchesQueryFilters,
  impactMatchesQueryFilters,
  itemMatchesImpactFilters
} from './queryFilters'
import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  type ImpactTimelineData,
  type MarketIntelligenceQueryCaveat,
  type AgentSafeEvidenceRef,
  type MarketIntelligenceQueryFilters,
  type PublicImpactView,
  type RelatedEventsData,
  type SentimentSeriesData,
  type SentimentSnapshotData
} from './queryContracts'
import { impactMatchesScope, itemMatchesScope, type ResolvedQueryScope } from './queryScopeResolver'

/**
 * The four query data shapes, built from pipeline rows.
 *
 * Split out of `publicQueryService` for size, not for a new concept: the service owns composition,
 * validation and the envelope; this module turns already-selected rows into the documented data
 * shapes. Nothing here reads storage, mints ids or decides visibility — a caller that needs those
 * still goes through the service.
 */

export function buildSentimentSnapshotData(input: {
  aggregates: IntelligenceSentimentAggregate[]
  items: IntelligenceItem[]
  scope: ResolvedQueryScope
  filters?: MarketIntelligenceQueryFilters
  asOf: string
  caveats: MarketIntelligenceQueryCaveat[]
}): SentimentSnapshotData {
  const horizon = input.filters?.horizon ?? '1h'
  const itemsById = new Map(input.items.map((item) => [item.itemId, item]))
  const matching = input.aggregates
    .filter((aggregate) => aggregate.horizon === horizon)
    .filter((aggregate) => aggregateMatchesScope(aggregate, input.scope))
    .filter((aggregate) => aggregateMatchesQueryFilters(aggregate, itemsById, input.filters))
    .sort((left, right) => compareIsoTime(right.updatedAt, left.updatedAt))

  const latest = matching[0]
  if (!latest) {
    input.caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf)
    return {
      status: 'unknown',
      scopeType: resolveScopeType(input.scope),
      scopeKey: resolveScopeKey(input.scope),
      horizon,
      supportingImpactCount: 0,
      supportingItemCount: 0,
      supportingClusterCount: 0
    }
  }

  return {
    status: 'available',
    scopeType: latest.scopeType,
    scopeKey: latest.scopeKey,
    horizon: latest.horizon,
    score: latest.aggregateScore,
    label: latest.aggregateLabel,
    computedAt: latest.updatedAt,
    supportingImpactCount: parseIdList(latest.supportingImpactIdsJson).length,
    supportingItemCount: parseIdList(latest.supportingItemIdsJson).length,
    supportingClusterCount: parseIdList(latest.supportingClusterIdsJson).length,
    layerBreakdown: parseJsonRecord(latest.layerBreakdownJson),
    directionBreakdown: parseJsonRecord(latest.directionBreakdownJson)
  }
}

export function buildSentimentSeriesData(input: {
  aggregates: IntelligenceSentimentAggregate[]
  items: IntelligenceItem[]
  scope: ResolvedQueryScope
  filters?: MarketIntelligenceQueryFilters
  timeWindow: ReturnType<typeof normalizeTimeWindow>
  maxItems: number
  asOf: string
  caveats: MarketIntelligenceQueryCaveat[]
}): SentimentSeriesData {
  const horizon = input.filters?.horizon ?? '1h'
  const itemsById = new Map(input.items.map((item) => [item.itemId, item]))
  const points = input.aggregates
    .filter((aggregate) => aggregate.horizon === horizon)
    .filter((aggregate) => aggregateMatchesScope(aggregate, input.scope))
    .filter((aggregate) => aggregateMatchesQueryFilters(aggregate, itemsById, input.filters))
    .filter((aggregate) => isWithinEventTimeWindow(aggregate.updatedAt, input.timeWindow))
    .sort((left, right) => compareIsoTime(left.updatedAt, right.updatedAt))
    .slice(-input.maxItems)
    .map((aggregate) => ({
      pointAsOf: aggregate.updatedAt,
      status: 'available' as const,
      score: aggregate.aggregateScore,
      label: aggregate.aggregateLabel,
      confidence: aggregate.confidence ?? 0.5,
      supportingImpactCount: parseIdList(aggregate.supportingImpactIdsJson).length,
      caveats: [] as MarketIntelligenceQueryCaveat[]
    }))

  if (points.length === 0) {
    input.caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf)
  }

  return { points }
}

export function buildRelatedEventsData(input: {
  items: IntelligenceItem[]
  impacts: IntelligenceImpact[]
  scope: ResolvedQueryScope
  filters?: MarketIntelligenceQueryFilters
  timeWindow: ReturnType<typeof normalizeTimeWindow>
  maxItems: number
  asOf: string
  pipeline: IntelligencePipeline
}): RelatedEventsData {
  const impactsByItem = groupImpactsByItem(input.impacts)
  const events = input.items
    .filter((item) => itemMatchesScope(item, input.scope).matched)
    .filter((item) => itemMatchesImpactFilters(item, input.impacts, input.filters))
    .filter((item) => isWithinEventTimeWindow(item.publishedAt ?? item.detectedAt, input.timeWindow))
    .sort((left, right) => compareIsoTime(right.detectedAt, left.detectedAt))
    .slice(0, input.maxItems)
    .map((item) => {
      const scopeMatch = itemMatchesScope(item, input.scope)
      const visibleImpacts = (impactsByItem.get(item.itemId) ?? [])
        .filter((entry) => impactMatchesQueryFilters(entry, input.filters, item))
        .map((impact) => buildPublicImpactView(impact, item, input.asOf, input.pipeline))
      const pendingImpacts = input.pipeline
        .listImpacts()
        .filter((impact) => impact.itemId === item.itemId)
        .filter((impact) => !isVisibleAsOf(VISIBLE_AT.impact(impact), input.asOf))
      const caveats = [...scopeMatch.caveats]
      if (pendingImpacts.length > 0 && visibleImpacts.length === 0) {
        caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.impactNotComputedAsOf)
      }
      const evidenceRefs = [
        buildEvidenceRef({ item, asOf: input.asOf }),
        ...visibleImpacts.flatMap((impact) => impact.evidenceRefs)
      ].filter((ref): ref is AgentSafeEvidenceRef => Boolean(ref))

      return {
        eventRefId: item.itemId,
        itemId: item.itemId,
        clusterId: item.clusterId,
        sourceId: item.sourceId,
        layer: item.sourceCategory,
        eventType: item.eventType,
        title: item.title,
        summary: item.summary,
        occurredAt: item.publishedAt,
        publishedAt: item.publishedAt,
        detectedAt: item.detectedAt,
        visibleAt: VISIBLE_AT.item(item),
        impacts: visibleImpacts,
        evidenceRefs,
        caveats: [...new Set(caveats)] as MarketIntelligenceQueryCaveat[]
      }
    })

  return { events }
}

export function buildImpactTimelineData(input: {
  items: IntelligenceItem[]
  impacts: IntelligenceImpact[]
  scope: ResolvedQueryScope
  filters?: MarketIntelligenceQueryFilters
  timeWindow: ReturnType<typeof normalizeTimeWindow>
  maxItems: number
  asOf: string
  pipeline: IntelligencePipeline
}): ImpactTimelineData {
  const itemsById = new Map(input.items.map((item) => [item.itemId, item]))
  const impacts = input.impacts
    .filter((impact) => {
      const item = itemsById.get(impact.itemId) ?? input.pipeline.listItems().find((entry) => entry.itemId === impact.itemId)
      return impactMatchesQueryFilters(impact, input.filters, item)
    })
    .filter((impact) => {
      const item = itemsById.get(impact.itemId) ?? input.pipeline.listItems().find((entry) => entry.itemId === impact.itemId)
      if (!item || !isVisibleAsOf(VISIBLE_AT.item(item), input.asOf)) return false
      return impactMatchesScope(impact, item, input.scope).matched
    })
    .filter((impact) => {
      const item = itemsById.get(impact.itemId)
      return item ? isWithinEventTimeWindow(item.publishedAt ?? item.detectedAt, input.timeWindow) : true
    })
    .sort((left, right) => compareIsoTime(right.createdAt, left.createdAt))
    .slice(0, input.maxItems)
    .map((impact) => {
      const item = itemsById.get(impact.itemId) ?? input.pipeline.listItems().find((entry) => entry.itemId === impact.itemId)
      return buildPublicImpactView(impact, item, input.asOf, input.pipeline)
    })

  return { impacts }
}

function buildPublicImpactView(
  impact: IntelligenceImpact,
  item: IntelligenceItem | undefined,
  asOf: string,
  pipeline: IntelligencePipeline
): PublicImpactView {
  const evidenceRef = item ? buildEvidenceRef({ item, impact, asOf }) : null
  return {
    impactId: impact.impactId,
    itemId: impact.itemId,
    clusterId: impact.clusterId,
    sourceId: item?.sourceId ?? 'unknown',
    layer: impact.layer,
    direction: impact.direction,
    magnitude: impact.magnitude,
    confidence: impact.confidence,
    horizon: impact.horizon,
    affectedScopes: [{ type: impact.scopeType, id: impact.scopeKey }],
    reasoning: impact.reasoning,
    ruleId: impact.ruleId,
    ruleVersion: impact.ruleVersion,
    occurredAt: item?.publishedAt,
    publishedAt: item?.publishedAt,
    detectedAt: item?.detectedAt ?? impact.createdAt,
    computedAt: impact.createdAt,
    visibleAt: VISIBLE_AT.impact(impact),
    evidenceRefs: evidenceRef ? [evidenceRef] : []
  }
}

function aggregateMatchesScope(aggregate: IntelligenceSentimentAggregate, scope: ResolvedQueryScope): boolean {
  if (scope.isMarketWide) {
    return ['market-wide', 'crypto-market', 'risk-assets'].includes(aggregate.scopeType)
  }
  if (scope.symbol && aggregate.scopeType === 'symbol' && aggregate.scopeKey.toUpperCase() === scope.symbol) {
    return true
  }
  if (
    scope.canonicalInstrumentId &&
    aggregate.scopeType === 'symbol' &&
    aggregate.scopeKey.toUpperCase() === scope.canonicalInstrumentId.toUpperCase()
  ) {
    return true
  }
  if (scope.asset) {
    if (aggregate.scopeType === 'symbol' && aggregate.scopeKey.toUpperCase().startsWith(scope.asset)) return true
  }
  return false
}

function resolveScopeType(scope: ResolvedQueryScope): string {
  if (scope.symbol || scope.canonicalInstrumentId) return 'symbol'
  if (scope.asset) return 'asset'
  if (scope.sector) return 'sector'
  if (scope.market) return 'market'
  return 'market-wide'
}

function resolveScopeKey(scope: ResolvedQueryScope): string {
  return scope.symbol ?? scope.canonicalInstrumentId ?? scope.asset ?? scope.sector ?? scope.market ?? 'market-wide'
}

function groupImpactsByItem(impacts: IntelligenceImpact[]): Map<string, IntelligenceImpact[]> {
  const grouped = new Map<string, IntelligenceImpact[]>()
  for (const impact of impacts) {
    const current = grouped.get(impact.itemId) ?? []
    current.push(impact)
    grouped.set(impact.itemId, current)
  }
  return grouped
}

/** Row payloads arrive as JSON text from the store; a bad or empty value is "absent", not an error. */
export function parseIdList(value?: string): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function parseJsonRecord(value?: string): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
