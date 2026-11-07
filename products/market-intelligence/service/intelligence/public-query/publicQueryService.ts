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
import { crossAssetNotWired, crossAssetRejected, crossAssetThrew, readCrossAssetFailure, recordCrossAssetFailure } from './crossAssetFailureReason'
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
import {
  buildSentimentSnapshotData,
  buildSentimentSeriesData,
  buildRelatedEventsData,
  buildImpactTimelineData,
  parseIdList,
  parseJsonRecord
} from './publicQueryDataBuilders'
import { queryFearGreedSnapshot } from './fearGreedSnapshotQuery'
import { queryFundingRateHistoryAsync } from './fundingRateHistoryQuery'
import { queryOpenInterestHistoryAsync } from './openInterestHistoryQuery'
import { openInterestUnavailable, type OpenInterestHistoryResult, type OpenInterestWindow } from '../../../contracts/openInterestHistory'
import { divergenceUnavailable, type MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { queryMarketDivergenceAsync, readSentimentLeg, type DivergenceLegReader } from '../divergence/marketDivergenceQuery'
import { attachModuleSignals, type SignalAnalysisReader } from '../signals/attachModuleSignals'
import type { ModuleSignalAnalysisRead } from '../analysis/signalAnalysisRead'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { ModuleSignalProducer } from '../signals/moduleSignalQuery'
import { createPriceLegReader } from '../divergence/priceLegReading'
import type { NewsSentimentView } from '../news-sentiment/newsSentimentQuery'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import type { FundingRateHistoryStore } from '../store/fundingRateHistoryStore'
import type { PerpetualPositioningStore } from '../store/perpetualPositioningStore'
import { impactMatchesScope, itemMatchesScope, normalizeQueryScope, type ResolvedQueryScope } from './queryScopeResolver'
import { buildQueryResultHash } from './resultHash'
import { buildSourceCoverageAsOf, summarizeSourceCoverage } from './sourceCoverageAsOf'
import type { createCapitalConditionsSnapshotQueryService } from '../capital-conditions/capitalConditionsSnapshotQuery'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import type {
  MacroHistoryAsOfQuery,
  MacroHistoryAsOfRequest,
  MacroHistoryAsOfResult
} from './macroHistoryAsOf'
import type { MacroMarketSnapshot } from '../macro-market/macroMarketSnapshotQuery'
import type { MacroRatesSnapshot } from '../macro-rates/macroRatesSnapshotQuery'
import type { MarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MarketCalendarFreshness } from '../../../contracts/macro/marketCalendarQueryContracts'
import { createMarketCalendarReadSurface, type MarketCalendarBinding } from './marketCalendarReadSurface'
import type { PolicyPathContextRead } from '../policy-path/policyPathQueryService'

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
  queryMarketDivergence: (input: { asOf: string }) => Promise<MarketDivergenceResult>
  /**
   * The module rules' signals at one instant, for the chips the dashboard reads.
   *
   * A list, not a tree: a leg that can answer adds itself here when its wiring lands, so the page
   * reads one shape whether one rule or four can speak today.
   */
  queryModuleSignals: (input: { asOf: string; window?: OpenInterestWindow }) => Promise<readonly SignalWithWindow[]>
  /** Late-bound for the same reason the other readers are: the leg's store is built in bootstrap. */
  addModuleSignalProducer: (producer: ModuleSignalProducer) => void
  /**
   * The analysis state of the signals above, mounted at assembly time for the same reason: the
   * store is built in the bootstrap. A whole screenful costs two queries — the ledger once, the
   * runs once — because a lookup per chip would put a query behind every card.
   */
  addSignalAnalysisReader: (reader: SignalAnalysisReader) => void
  /** Signals and their states together, so the page reads one body. */
  queryModuleSignalRead: (input: { asOf: string; window?: OpenInterestWindow }) => Promise<ModuleSignalAnalysisRead>
  queryCapitalConditionsSnapshot: (input: CapitalConditionsSnapshotQueryInput) => Promise<CapitalConditionsSnapshotResult>
  queryMacroEconomicCalendarMonth: (input: { month: string; asOf: string; maxEvents?: number }) => Promise<MacroEconomicCalendarMonthResult>
  setMacroEconomicCalendarQuery: (query: Pick<MacroEconomicCalendarQuery, 'queryMonth'> | undefined) => void
  queryMarketCalendarMonth: (input: unknown) => MarketCalendarPage
  setMarketCalendarQuery: (query: MarketCalendarBinding | undefined) => void
  /** 日历实际有多旧、最后一次尝试为什么结束（`A0.8`）；语义与两种失败见 `marketCalendarReadSurface`。 */
  queryMarketCalendarFreshness: () => Promise<MarketCalendarFreshness>
  /**
   * The cross-asset snapshot the analysis reads for price and relative returns.
   *
   * Late-bound like the calendar queries because the query instance is created in bootstrap,
   * where the cross-asset store and runtime live. The payload is validated with the same
   * parser the renderer uses, so the analysis can never read a shape the panel would reject.
   */
  /** `knowledgeAt` is required: a caller that forgets it silently asks the frozen as-of view. */
  queryCrossAssetSnapshot: (input: { range: CrossAssetRange; asOf: string; knowledgeAt: string }) => Promise<CrossAssetSnapshot | undefined>
  /** Why the last cross-asset read answered nothing; see `crossAssetFailureReason`. */
  getCrossAssetQueryFailure?: () => string | null
  setCrossAssetQuery: (query: Pick<CrossAssetQuery, 'query'> | undefined) => void
  /** The scored-headline reader the news page and the analysis already share. */
  setNewsSentimentQuery: (query: { query: (input: NewsSentimentQuery) => Promise<NewsSentimentView> } | undefined) => void
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
  /**
   * The dollar, gold and the two 10-year yields as they stood at an instant: the one historical read
   * of those series, and the reader the daily brief's backfill tool is built on.
   *
   * Late-bound and synchronous for the same reasons as the two snapshots above. `undefined` means no
   * historical reader is wired in this build — a caller has to report that as unavailable, never as
   * an empty store and never by substituting the current snapshot.
   */
  queryMacroHistoryAsOf: (input: MacroHistoryAsOfRequest) => MacroHistoryAsOfResult | undefined
  setMacroHistoryAsOfQuery: (query: Pick<MacroHistoryAsOfQuery, 'read'> | undefined) => void
  /**
   * The policy path the analysis reads: the next FOMC meeting, the market's odds for it, the target
   * range, the latest SEP and the last vote. Late-bound like the rate blocks because the policy
   * query is created in bootstrap; the implementation also checks the source switch, so a disabled
   * source answers `disabled` rather than handing the analysis stale odds.
   */
  queryPolicyPath: (input: { asOf: string }) => Promise<PolicyPathContextRead>
  setPolicyPathQuery: (query: { read: (input: { asOf: string }) => Promise<PolicyPathContextRead> } | undefined) => void
}

type MacroEconomicCalendarQuery = {
  queryMonth: (input: unknown) => MacroEconomicCalendarMonthResult
}

type CrossAssetQuery = {
  query: (input: { range: CrossAssetRange; asOf?: string; knowledgeAt?: string }) => unknown
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
  marketCalendarQuery?: MarketCalendarBinding
}

export function createMarketIntelligencePublicQueryService(
  input: CreateMarketIntelligencePublicQueryServiceInput
): MarketIntelligencePublicQueryService {
  const listSourceDefinitions = input.listSourceDefinitions ?? listIntelligenceSourceDefinitions
  let macroEconomicCalendarQuery = input.macroEconomicCalendarQuery
  const marketCalendar = createMarketCalendarReadSurface(input.marketCalendarQuery)
  let crossAssetQuery: CrossAssetQuery | undefined
  let newsSentimentQuery: { query: (input: NewsSentimentQuery) => Promise<NewsSentimentView> } | undefined
  let macroMarketSnapshotQuery: MacroMarketSnapshotQuery | undefined
  let macroRatesSnapshotQuery: MacroRatesSnapshotQuery | undefined
  let macroHistoryAsOfQuery: Pick<MacroHistoryAsOfQuery, 'read'> | undefined
  let policyPathContextQuery: { read: (input: { asOf: string }) => Promise<PolicyPathContextRead> } | undefined

  const service = {
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
    queryMarketCalendarMonth: (queryInput) => marketCalendar.queryMonth(queryInput),
    setMarketCalendarQuery: (query) => marketCalendar.bind(query),
    queryMarketCalendarFreshness: () => marketCalendar.freshness(),
    async queryCrossAssetSnapshot(queryInput) {
      // Fail closed, but never silently: the snapshot stays `undefined` (every consumer keeps its
      // behaviour) and the reason is recorded, because "not wired", "threw" and "failed validation"
      // have three different fixes and used to be one sentence at every surface.
      if (!crossAssetQuery) {
        recordCrossAssetFailure(crossAssetNotWired())
        return undefined
      }
      let raw: unknown
      try {
        // Forwarded whole: dropping `knowledgeAt` reverted every caller to the frozen as-of view.
        raw = crossAssetQuery.query({ range: queryInput.range, asOf: queryInput.asOf, knowledgeAt: queryInput.knowledgeAt })
      } catch (error) {
        recordCrossAssetFailure(crossAssetThrew(error))
        return undefined
      }
      const rejection: { field?: string } = {}
      const parsed = parseCrossAssetSnapshot(raw, rejection)
      recordCrossAssetFailure(parsed ? null : crossAssetRejected(rejection.field))
      return parsed
    },
    getCrossAssetQueryFailure: () => readCrossAssetFailure(),
    setCrossAssetQuery(query) {
      crossAssetQuery = query
    },
    setNewsSentimentQuery(query) {
      newsSentimentQuery = query
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
    },
    // Fail closed to `undefined` like the two snapshots: an unwired reader is "no historical answer
    // exists in this build", which the caller reports as a gap rather than as a stored zero.
    queryMacroHistoryAsOf(input) {
      try {
        return macroHistoryAsOfQuery?.read(input)
      } catch {
        return undefined
      }
    },
    setMacroHistoryAsOfQuery(query) {
      macroHistoryAsOfQuery = query
    },
    async queryPolicyPath(input) {
      if (!policyPathContextQuery) return { state: 'unavailable' as const }
      try {
        return await policyPathContextQuery.read(input)
      } catch {
        return { state: 'unavailable' as const }
      }
    },
    setPolicyPathQuery(query) {
      policyPathContextQuery = query
    }
  } as MarketIntelligencePublicQueryService

  attachModuleSignals(service)

  // Reads the service's own legs rather than reaching into stores again: one implementation of
  // "what the dashboard already knows", and the divergence rule never sees a second view of it.
  service.queryMarketDivergence = async (queryInput) => queryMarketDivergenceAsync({
    asOf: queryInput.asOf,
    read: divergenceReader(service, queryInput.asOf, newsSentimentQuery)
  })
  return service
}

function divergenceReader(service: MarketIntelligencePublicQueryService, asOf: string, newsSentimentQuery: { query: (input: NewsSentimentQuery) => Promise<NewsSentimentView> } | undefined): DivergenceLegReader {
  // The divergence legs read the window's own view: the price leg's instant is its knowledge cutoff.
  const readPriceLeg = createPriceLegReader((input) => service.queryCrossAssetSnapshot({ ...input, knowledgeAt: input.asOf }))
  return {
    stablecoin: async () => {
      const snapshot = await service.queryCapitalConditionsSnapshot({ asOf })
      return snapshot.state === 'available'
        ? { change7dPercent: snapshot.coreStablecoins.change7dPercent, observedAt: snapshot.coreStablecoins.observedAt }
        : undefined
    },
    etf: async () => {
      const snapshot = await service.queryCapitalConditionsSnapshot({ asOf })
      if (snapshot.state !== 'available' || snapshot.etf === undefined || !('btc' in snapshot.etf)) return undefined
      return { rows: snapshot.etf.btc.rows }
    },
    openInterest: async () => {
      const result = await service.queryOpenInterestHistory({ asOf, window: '24h' })
      const latest = result.state === 'available' ? result.btc.at(-1) : undefined
      const change = result.state === 'available' ? result.change?.btc.h24Pct : undefined
      return latest && change !== undefined ? { change24hPct: change, observedAt: latest.observedAt } : undefined
    },
    funding: async () => {
      const result = await service.queryFundingRateHistory({ asOf })
      const latest = result.state === 'available' ? result.btc.at(-1) : undefined
      return latest ? { ratePercent: latest.ratePercent, observedAt: latest.observedAt } : undefined
    },
    // Anchored on the newest close the store can answer, not on the instant the card was opened:
    // the bar closing exactly at `floor(asOf)` is not written yet for the first seconds after every
    // five-minute boundary, and that made the card say "no price" while the price card showed one.
    price: () => readPriceLeg(asOf),
    sentiment: async () => {
      // An unwired reader is a fault, not a quiet day: the card must say it could not read.
      if (!newsSentimentQuery) return { state: 'unavailable' }
      const view = await newsSentimentQuery.query({ asOf, window: '24h', scope: 'market', direction: 'all', limit: 100 })
      return readSentimentLeg(view)
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
