import { randomUUID } from 'node:crypto'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { listIntelligenceSourceDefinitions } from '../application/sourceCatalog'
import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceSentimentAggregate, IntelligenceSentimentHorizon } from '../schema/intelligenceSentiment'
import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import {
  compareIsoTime,
  isVisibleAsOf,
  isWithinEventTimeWindow,
  normalizeMaxItems,
  normalizeTimeWindow,
  VISIBLE_AT
} from './asOfVisibility'
import { parseCrossAssetSnapshot, type CrossAssetRange, type CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { buildEvidenceRef } from './evidenceSnapshotBuilder'
import { buildEvidenceExcerpt } from './evidenceSnapshotBuilder'
import {
  aggregateMatchesQueryFilters,
  impactMatchesQueryFilters,
  itemMatchesImpactFilters
} from './queryFilters'
import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  MARKET_INTELLIGENCE_QUERY_TYPES,
  type AgentSafeEvidenceRef,
  type FundingRateHistoryQueryInput,
  type FundingRateHistoryResult,
  type CapitalConditionsSnapshotQueryInput,
  type CapitalConditionsSnapshotResult,
  type EvidenceExcerptQueryInput,
  type FearGreedSnapshotQueryInput,
  type FearGreedSnapshotResult,
  type EvidenceExcerptResult,
  type ImpactTimelineData,
  type MarketIntelligenceQueryCaveat,
  type MarketIntelligenceQueryFilters,
  type MarketIntelligenceQueryResult,
  type MarketIntelligenceQueryScope,
  type MarketIntelligenceQueryType,
  type MarketIntelligenceTimeBoundQueryInput,
  type PublicImpactView,
  type RelatedEventsData,
  type SentimentSeriesData,
  type SentimentSnapshotData,
  type SourceHealthData
} from './queryContracts'
import { queryFearGreedSnapshot } from './fearGreedSnapshotQuery'
import { queryFundingRateHistoryAsync } from './fundingRateHistoryQuery'
import { queryOpenInterestHistoryAsync } from './openInterestHistoryQuery'
import { openInterestUnavailable, type OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { FundingRateHistoryStore } from '../store/fundingRateHistoryStore'
import type { PerpetualPositioningStore } from '../store/perpetualPositioningStore'
import { impactMatchesScope, itemMatchesScope, normalizeQueryScope, type ResolvedQueryScope } from './queryScopeResolver'
import { buildQueryResultHash } from './resultHash'
import { buildSourceCoverageAsOf, summarizeSourceCoverage } from './sourceCoverageAsOf'
import type { createCapitalConditionsSnapshotQueryService } from '../capital-conditions/capitalConditionsSnapshotQuery'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import type { MacroMarketSnapshot } from '../macro-market/macroMarketSnapshotQuery'
import type { MacroRatesSnapshot } from '../macro-rates/macroRatesSnapshotQuery'
import type { MarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'

export type MarketIntelligencePublicQueryService = {
  querySentimentSnapshot: (
    input: MarketIntelligenceTimeBoundQueryInput
  ) => Promise<MarketIntelligenceQueryResult<SentimentSnapshotData>>
  querySentimentSeries: (
    input: MarketIntelligenceTimeBoundQueryInput
  ) => Promise<MarketIntelligenceQueryResult<SentimentSeriesData>>
  queryRelatedEvents: (
    input: MarketIntelligenceTimeBoundQueryInput
  ) => Promise<MarketIntelligenceQueryResult<RelatedEventsData>>
  queryImpactTimeline: (
    input: MarketIntelligenceTimeBoundQueryInput
  ) => Promise<MarketIntelligenceQueryResult<ImpactTimelineData>>
  getSourceHealth: (
    input: MarketIntelligenceTimeBoundQueryInput
  ) => Promise<MarketIntelligenceQueryResult<SourceHealthData>>
  getEvidenceExcerpt: (
    input: EvidenceExcerptQueryInput
  ) => Promise<MarketIntelligenceQueryResult<EvidenceExcerptResult>>
  queryFearGreedSnapshot: (input: FearGreedSnapshotQueryInput) => Promise<FearGreedSnapshotResult>
  queryFundingRateHistory: (input: FundingRateHistoryQueryInput) => Promise<FundingRateHistoryResult>
  queryOpenInterestHistory: (input: { asOf: string; window: unknown }) => Promise<OpenInterestHistoryResult>
  queryCapitalConditionsSnapshot: (input: CapitalConditionsSnapshotQueryInput) => Promise<CapitalConditionsSnapshotResult>
  queryMacroEconomicCalendarMonth: (input: { month: string; asOf: string; maxEvents?: number }) => Promise<MacroEconomicCalendarMonthResult>
  setMacroEconomicCalendarQuery: (query: Pick<MacroEconomicCalendarQuery, 'queryMonth'> | undefined) => void
  queryMarketCalendarMonth: (input: unknown) => MarketCalendarPage
  setMarketCalendarQuery: (query: Pick<MarketCalendarQuery, 'queryMonth'> | undefined) => void
  /**
   * The cross-asset snapshot the analysis reads for price and relative returns.
   *
   * Late-bound like the calendar queries because the query instance is created in bootstrap,
   * where the cross-asset store and runtime live. The payload is validated with the same
   * parser the renderer uses, so the analysis can never read a shape the panel would reject.
   */
  queryCrossAssetSnapshot: (input: { range: CrossAssetRange; asOf: string }) => Promise<CrossAssetSnapshot | undefined>
  setCrossAssetQuery: (query: Pick<CrossAssetQuery, 'query'> | undefined) => void
  /**
   * The macro snapshot the 市场状态 block reads: the dollar row (licensed `dxy-real`, or the labelled
   * `dxy-synthetic` fallback) and gold's stored level with its window returns.
   *
   * Late-bound like the cross-asset query because the store and the live gold tick are created in
   * bootstrap. It is a *synchronous* read of an in-memory store, so the analysis can call it inside a
   * projection without making the projection async; an unwired query answers `undefined`, which the
   * projection reports as `query-unavailable` rather than as an empty market.
   */
  queryMacroMarketSnapshot: () => MacroMarketSnapshot | undefined
  setMacroMarketSnapshotQuery: (query: Pick<MacroMarketSnapshotQuery, 'snapshot'> | undefined) => void
  /**
   * FRED's daily rate readings for the same block. Synchronous for the same reason, and unwired means
   * unavailable rather than flat.
   */
  queryMacroRatesSnapshot: () => MacroRatesSnapshot | undefined
  setMacroRatesSnapshotQuery: (query: Pick<MacroRatesSnapshotQuery, 'snapshot'> | undefined) => void
}

type MacroEconomicCalendarQuery = {
  queryMonth: (input: unknown) => MacroEconomicCalendarMonthResult
}

type MarketCalendarQuery = {
  queryMonth: (input: unknown) => MarketCalendarPage
}

type CrossAssetQuery = {
  query: (input: { range: CrossAssetRange; asOf?: string }) => unknown
}

type MacroMarketSnapshotQuery = {
  snapshot: () => MacroMarketSnapshot
}

type MacroRatesSnapshotQuery = {
  snapshot: () => MacroRatesSnapshot
}

export type CreateMarketIntelligencePublicQueryServiceInput = {
  pipeline: IntelligencePipeline
  listSourceDefinitions?: () => IntelligenceSourceDefinition[]
  capitalConditionsQuery?: ReturnType<typeof createCapitalConditionsSnapshotQueryService>
  fundingRateHistoryStore?: Pick<FundingRateHistoryStore, 'read'>
  perpetualPositioningStore?: Pick<PerpetualPositioningStore, 'read'>
  macroEconomicCalendarQuery?: Pick<MacroEconomicCalendarQuery, 'queryMonth'>
  marketCalendarQuery?: Pick<MarketCalendarQuery, 'queryMonth'>
}

export function createMarketIntelligencePublicQueryService(
  input: CreateMarketIntelligencePublicQueryServiceInput
): MarketIntelligencePublicQueryService {
  const listSourceDefinitions = input.listSourceDefinitions ?? listIntelligenceSourceDefinitions
  let macroEconomicCalendarQuery = input.macroEconomicCalendarQuery
  let marketCalendarQuery = input.marketCalendarQuery
  let crossAssetQuery: CrossAssetQuery | undefined
  let macroMarketSnapshotQuery: MacroMarketSnapshotQuery | undefined
  let macroRatesSnapshotQuery: MacroRatesSnapshotQuery | undefined

  return {
    querySentimentSnapshot: (queryInput) =>
      executeQuery({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot,
        queryInput,
        pipeline: input.pipeline,
        listSourceDefinitions,
        buildData: ({ aggregates, items, scope, filters, asOf, caveats }) =>
          buildSentimentSnapshotData({ aggregates, items, scope, filters, asOf, caveats })
      }),
    querySentimentSeries: (queryInput) =>
      executeQuery({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSeries,
        queryInput,
        pipeline: input.pipeline,
        listSourceDefinitions,
        buildData: ({ aggregates, items, scope, filters, timeWindow, maxItems, asOf, caveats }) =>
          buildSentimentSeriesData({ aggregates, items, scope, filters, timeWindow, maxItems, asOf, caveats })
      }),
    queryRelatedEvents: (queryInput) =>
      executeQuery({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.relatedEvents,
        queryInput,
        pipeline: input.pipeline,
        listSourceDefinitions,
        buildData: ({ items, impacts, scope, filters, timeWindow, maxItems, asOf }) =>
          buildRelatedEventsData({
            items,
            impacts,
            scope,
            filters,
            timeWindow,
            maxItems,
            asOf,
            pipeline: input.pipeline
          })
      }),
    queryImpactTimeline: (queryInput) =>
      executeQuery({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.impactTimeline,
        queryInput,
        pipeline: input.pipeline,
        listSourceDefinitions,
        buildData: ({ items, impacts, scope, filters, timeWindow, maxItems, asOf }) =>
          buildImpactTimelineData({
            items,
            impacts,
            scope,
            filters,
            timeWindow,
            maxItems,
            asOf,
            pipeline: input.pipeline
          })
      }),
    getSourceHealth: (queryInput) =>
      executeQuery({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sourceHealth,
        queryInput,
        pipeline: input.pipeline,
        listSourceDefinitions,
        buildData: ({ sourceCoverage }) => ({
          sources: sourceCoverage,
          summary: summarizeSourceCoverage(sourceCoverage)
        })
      }),
    getEvidenceExcerpt: async (queryInput) => {
      const asOf = queryInput.asOf.trim()
      const items = input.pipeline.listItems()
      const { item, rawRecord } = resolveEvidenceTarget(input.pipeline, queryInput, items, asOf)
      const excerpt = buildEvidenceExcerpt({
        item,
        rawRecord,
        asOf,
        maxExcerptChars: queryInput.maxExcerptChars
      })
      const caveats: MarketIntelligenceQueryCaveat[] = []
      if (!excerpt) {
        caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
      }
      const sourceCoverage = buildSourceCoverageAsOf({
        definitions: listSourceDefinitions(),
        runtimeStates: input.pipeline.listRuntimeStatesAsOf(asOf),
        items,
        asOf,
        includedSourceIds: item ? new Set([item.sourceId]) : undefined
      })
      return buildEnvelope({
        queryType: MARKET_INTELLIGENCE_QUERY_TYPES.evidenceExcerpt,
        asOf,
        scope: {},
        timeWindow: { to: asOf },
        confidence: excerpt ? 0.8 : 0,
        caveats,
        sourceCoverage,
        evidenceRefs: excerpt ? [excerpt.evidenceRef] : [],
        data: excerpt ?? {
          evidenceRef: {
            evidenceRefId: queryInput.itemId ?? queryInput.evidenceRefId ?? 'unknown',
            sourceId: item?.sourceId ?? 'unknown',
            schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
            detectedAt: asOf,
            visibleAt: asOf,
            rendererSafeSummary: '',
            caveats: [MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf]
          },
          title: item?.title ?? ''
        }
      })
    },
    queryFearGreedSnapshot: async (queryInput) => queryFearGreedSnapshot({ ...queryInput, pipeline: input.pipeline }),
    queryFundingRateHistory: async (queryInput) => input.fundingRateHistoryStore
      ? queryFundingRateHistoryAsync({ ...queryInput, store: input.fundingRateHistoryStore })
      : { state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' },
    queryOpenInterestHistory: async (queryInput) => input.perpetualPositioningStore
      ? queryOpenInterestHistoryAsync({ ...queryInput, store: input.perpetualPositioningStore })
      : openInterestUnavailable(),
    queryCapitalConditionsSnapshot: async (queryInput) => input.capitalConditionsQuery?.query(queryInput) ?? ({
      state: 'unavailable', failureCode: 'capital-conditions-query-unavailable'
    }),
    queryMacroEconomicCalendarMonth: async (queryInput) => macroEconomicCalendarQuery?.queryMonth(queryInput) ?? ({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    }),
    setMacroEconomicCalendarQuery(query) {
      macroEconomicCalendarQuery = query
    },
    queryMarketCalendarMonth: (queryInput) => marketCalendarQuery?.queryMonth(queryInput) ?? ({
      state: 'unavailable', failureCode: 'query-unavailable'
    }),
    setMarketCalendarQuery(query) {
      marketCalendarQuery = query
    },
    async queryCrossAssetSnapshot(queryInput) {
      // Fail closed to `undefined`: a sparse or unvalidated snapshot must leave the domain
      // `not-comparable`, which is what the analysis already knows how to explain.
      try {
        return parseCrossAssetSnapshot(crossAssetQuery?.query({ range: queryInput.range, asOf: queryInput.asOf }))
      } catch {
        return undefined
      }
    },
    setCrossAssetQuery(query) {
      crossAssetQuery = query
    },
    // Fail closed to `undefined` exactly like the cross-asset read: an unwired or throwing snapshot
    // must leave the domain unavailable, never empty — "no data" and "no answer" are different facts.
    queryMacroMarketSnapshot() {
      try {
        return macroMarketSnapshotQuery?.snapshot()
      } catch {
        return undefined
      }
    },
    setMacroMarketSnapshotQuery(query) {
      macroMarketSnapshotQuery = query
    },
    queryMacroRatesSnapshot() {
      try {
        return macroRatesSnapshotQuery?.snapshot()
      } catch {
        return undefined
      }
    },
    setMacroRatesSnapshotQuery(query) {
      macroRatesSnapshotQuery = query
    }
  }
}

type QueryContext = {
  items: IntelligenceItem[]
  impacts: IntelligenceImpact[]
  aggregates: IntelligenceSentimentAggregate[]
  scope: ResolvedQueryScope
  filters?: MarketIntelligenceQueryFilters
  timeWindow: ReturnType<typeof normalizeTimeWindow>
  maxItems: number
  asOf: string
  caveats: MarketIntelligenceQueryCaveat[]
  sourceCoverage: ReturnType<typeof buildSourceCoverageAsOf>
}

async function executeQuery<TData>(input: {
  queryType: MarketIntelligenceQueryType
  queryInput: MarketIntelligenceTimeBoundQueryInput
  pipeline: IntelligencePipeline
  listSourceDefinitions: () => IntelligenceSourceDefinition[]
  buildData: (context: QueryContext) => TData
}): Promise<MarketIntelligenceQueryResult<TData>> {
  const timeWindow = normalizeTimeWindow(input.queryInput)
  const maxItemsResult = normalizeMaxItems(input.queryInput.maxItems)
  const scope = normalizeQueryScope(input.queryInput.scope)
  const caveats: MarketIntelligenceQueryCaveat[] = [...timeWindow.caveats, ...scope.caveats]
  if (maxItemsResult.truncated) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.maxItemsTruncated)
  }

  const asOf = timeWindow.asOf
  const items = input.pipeline
    .listItems()
    .filter((item) => isVisibleAsOf(VISIBLE_AT.item(item), asOf))
  const impacts = input.pipeline
    .listImpacts()
    .filter((impact) => isVisibleAsOf(VISIBLE_AT.impact(impact), asOf))
  const aggregates = input.pipeline
    .listSentimentAggregates()
    .filter((aggregate) => isVisibleAsOf(VISIBLE_AT.sentimentAggregate(aggregate), asOf))

  const includedSourceIds = new Set(items.map((item) => item.sourceId))
  const sourceCoverage = buildSourceCoverageAsOf({
    definitions: input.listSourceDefinitions(),
    runtimeStates: input.pipeline.listRuntimeStatesAsOf(asOf),
    items,
    asOf,
    includedSourceIds
  })

  if (sourceCoverage.every((entry) => entry.productionState !== 'fresh' && !entry.includedInResult)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.insufficientSourceCoverage)
  }

  const data = input.buildData({
    items,
    impacts,
    aggregates,
    scope,
    filters: input.queryInput.filters,
    timeWindow,
    maxItems: maxItemsResult.value,
    asOf,
    caveats,
    sourceCoverage
  })

  const evidenceRefs = collectEvidenceRefs(data)
  const confidence = computeConfidence(sourceCoverage, caveats)

  return buildEnvelope({
    queryType: input.queryType,
    asOf,
    scope: input.queryInput.scope ?? {},
    timeWindow: {
      from: timeWindow.from,
      to: timeWindow.to,
      lookbackWindowMs: timeWindow.lookbackWindowMs
    },
    confidence,
    caveats: [...new Set(caveats)] as MarketIntelligenceQueryCaveat[],
    sourceCoverage,
    evidenceRefs,
    data
  })
}

function buildEnvelope<TData>(input: {
  queryType: MarketIntelligenceQueryType
  asOf: string
  scope: MarketIntelligenceQueryScope
  timeWindow: MarketIntelligenceQueryResult<TData>['timeWindow']
  confidence: number
  caveats: MarketIntelligenceQueryCaveat[]
  sourceCoverage: ReturnType<typeof buildSourceCoverageAsOf>
  evidenceRefs: AgentSafeEvidenceRef[]
  data: TData
}): MarketIntelligenceQueryResult<TData> {
  const queryId = randomUUID()
  const servedAt = new Date().toISOString()
  const hashInput = {
    schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
    queryType: input.queryType,
    asOf: input.asOf,
    scope: input.scope,
    timeWindow: input.timeWindow,
    confidence: input.confidence,
    caveats: input.caveats,
    sourceCoverage: input.sourceCoverage,
    evidenceRefs: input.evidenceRefs,
    data: input.data
  }

  return {
    schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
    queryId,
    queryType: input.queryType,
    asOf: input.asOf,
    servedAt,
    resultHash: buildQueryResultHash(hashInput),
    scope: input.scope,
    timeWindow: input.timeWindow,
    confidence: input.confidence,
    caveats: input.caveats,
    sourceCoverage: input.sourceCoverage,
    evidenceRefs: input.evidenceRefs,
    data: input.data
  }
}

function buildSentimentSnapshotData(input: {
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

function buildSentimentSeriesData(input: {
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

function buildRelatedEventsData(input: {
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

function buildImpactTimelineData(input: {
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

function collectEvidenceRefs(data: unknown): AgentSafeEvidenceRef[] {
  const refs: AgentSafeEvidenceRef[] = []
  if (!data || typeof data !== 'object') return refs

  const record = data as Record<string, unknown>
  if (Array.isArray(record.events)) {
    for (const event of record.events) {
      if (event && typeof event === 'object' && Array.isArray((event as { evidenceRefs?: unknown }).evidenceRefs)) {
        refs.push(...((event as { evidenceRefs: AgentSafeEvidenceRef[] }).evidenceRefs ?? []))
      }
    }
  }
  if (Array.isArray(record.impacts)) {
    for (const impact of record.impacts) {
      if (impact && typeof impact === 'object' && Array.isArray((impact as { evidenceRefs?: unknown }).evidenceRefs)) {
        refs.push(...((impact as { evidenceRefs: AgentSafeEvidenceRef[] }).evidenceRefs ?? []))
      }
    }
  }
  if (record.evidenceRef && typeof record.evidenceRef === 'object') {
    refs.push(record.evidenceRef as AgentSafeEvidenceRef)
  }

  const deduped = new Map<string, AgentSafeEvidenceRef>()
  for (const ref of refs) {
    deduped.set(ref.evidenceRefId, ref)
  }
  return [...deduped.values()]
}

function computeConfidence(
  sourceCoverage: ReturnType<typeof buildSourceCoverageAsOf>,
  caveats: MarketIntelligenceQueryCaveat[]
): number {
  if (caveats.includes(MARKET_INTELLIGENCE_QUERY_CAVEATS.sentimentNotComputedAsOf)) return 0
  if (caveats.includes(MARKET_INTELLIGENCE_QUERY_CAVEATS.insufficientSourceCoverage)) return 0.2
  const included = sourceCoverage.filter((entry) => entry.includedInResult)
  if (included.length === 0) return 0.3
  const average = included.reduce((sum, entry) => sum + entry.confidence, 0) / included.length
  return Number(average.toFixed(2))
}

function resolveEvidenceTarget(
  pipeline: IntelligencePipeline,
  queryInput: EvidenceExcerptQueryInput,
  items: IntelligenceItem[],
  asOf: string
): { item?: IntelligenceItem; rawRecord?: ReturnType<IntelligencePipeline['listRawRecordSummaries']>[number] } {
  if (queryInput.itemId) {
    return { item: items.find((entry) => entry.itemId === queryInput.itemId) }
  }

  if (queryInput.evidenceRefId) {
    const item = items.find((entry) => entry.itemId === queryInput.evidenceRefId)
    if (item) return { item }
    const rawRecord = pipeline
      .listRawRecordSummaries()
      .find(
        (entry) =>
          entry.rawRecordId === queryInput.evidenceRefId && isVisibleAsOf(VISIBLE_AT.rawRecord(entry), asOf)
      )
    if (rawRecord) return { rawRecord }
  }

  if (queryInput.impactId) {
    const impact = pipeline
      .listImpacts()
      .find((entry) => entry.impactId === queryInput.impactId && isVisibleAsOf(VISIBLE_AT.impact(entry), asOf))
    if (impact) {
      return { item: items.find((entry) => entry.itemId === impact.itemId) }
    }
  }

  if (queryInput.clusterId) {
    const cluster = pipeline
      .listClusters()
      .find(
        (entry) =>
          entry.clusterId === queryInput.clusterId && isVisibleAsOf(entry.lastDetectedAt, asOf)
      )
    const item =
      (cluster ? items.find((entry) => entry.itemId === cluster.primaryItemId) : undefined) ??
      items.find((entry) => entry.clusterId === queryInput.clusterId)
    if (item) return { item }
  }

  return {}
}
