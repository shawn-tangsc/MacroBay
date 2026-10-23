import type { IntelligenceSourceGroup } from '../schema/intelligenceSource'
import type { IntelligenceAssessment } from '../schema/intelligenceAssessment'
import type {
  IntelligenceEventCluster,
  IntelligenceItem,
  IntelligenceItemRevision,
  SafeRawRecordSummary
} from '../schema/intelligenceRecord'
import type {
  IntelligenceSentimentAggregate,
  IntelligenceSentimentHorizon,
  IntelligenceSentimentLabel,
  IntelligenceSentimentScope
} from '../schema/intelligenceSentiment'
import type {
  IntelligenceDataDomain,
  IntelligenceEventFamily,
  IntelligenceImpactDirection,
  IntelligenceLayer,
  IntelligenceReliabilityTier
} from '../schema/intelligenceLayer'
import { parseImpactEvidence } from '../schema/intelligenceImpact'
import type { EventMatch, IntelligenceTimelineFilter, NormalizedMarketEvent } from '../schema/marketEvent'
import type { IntelligencePipeline } from './intelligencePipeline'
import type { IntelligenceSourcesService } from './intelligenceSourcesService'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import type { IntelligenceTranslationService } from './intelligenceTranslationService'
import type { IntelligenceTranslationStatus } from '../schema/intelligenceTranslation'
import { resolveSourceFreshnessStatus } from '../schema/intelligenceSourcesContracts'
import { getIntelligenceSourceDefinition, isDefillamaStablecoinRetiredPath } from './sourceCatalog'
import { isItemApplicableToFocusMarkets } from './intelligenceSourceApplicability'
import type { IntelligenceFocusMarket } from '../schema/intelligenceSource'
import {
  type IntelligenceAssessmentStatus,
  compareTimelineTimestamps,
  isBackfillItem,
  parseProcessingLabels,
  parseTimelineInstant,
  resolveEffectivePublishedAt,
  resolveTimelineTimestamp,
  sanitizeIntelligenceText
} from './intelligenceItemLabels'
import { isTimelineRelevant, matchMarketEvent } from './symbolExposureMatcher'
import { buildLayerDesk, buildWorkspaceStatus } from './intelligenceWorkspaceStatus'
import { buildSourceCoverage, type IntelligenceSourceCoverageView } from './intelligenceSourceCoverage'
import type { IntelligenceLayerDeskColumn, IntelligenceWorkspaceStatusView } from './intelligenceWorkspaceStatus'

export type IntelligenceWorkspaceView = 'overview' | 'timeline' | 'sentiment'

export type IntelligenceWorkspaceAlertRecord = {
  id: string
  correlationId?: string
  status: 'notify' | 'timeline-only' | 'suppressed'
  createdAt: string
  safeFacts: { eventId?: string }
}

export type IntelligenceWorkspaceTimeRange = '24h' | '7d' | '30d' | 'all'

export type IntelligenceWorkspaceFilters = {
  timeRange?: IntelligenceWorkspaceTimeRange
  sourceGroup?: IntelligenceSourceGroup | 'all'
  scope?: IntelligenceTimelineFilter
  symbol?: string
  status?: string
  eventType?: string
  alertDecision?: 'notify' | 'timeline-only' | 'suppress' | 'none' | 'all'
  horizon?: IntelligenceSentimentHorizon
  scopeType?: IntelligenceSentimentScope | 'all'
  aggregateLabel?: IntelligenceSentimentLabel | 'all'
  limit?: number
  includeBackfill?: boolean
  layer?: IntelligenceLayer | 'all'
  direction?: IntelligenceImpactDirection | 'all'
  eventFamily?: IntelligenceEventFamily | 'all'
  sourceReliability?: IntelligenceReliabilityTier | 'all'
}

export type IntelligenceTimelineRow = {
  rowId: string
  identityKind: 'cluster' | 'item'
  clusterId?: string
  itemId: string
  sourceId: string
  sourceName: string
  sourceGroup: IntelligenceSourceGroup | 'unknown'
  eventType: string
  title: string
  summary?: string
  displayTitle?: string
  originalTitle?: string
  translationStatus?: IntelligenceTranslationStatus
  publishedAt?: string
  detectedAt: string
  displayAt?: string
  timelineAt?: string
  isBackfill?: boolean
  assessmentStatus?: IntelligenceAssessmentStatus
  assessmentErrorCode?: string
  symbols: string[]
  alertStatus: 'suppressed' | 'timeline-only' | 'notify' | 'none'
  hasRevision: boolean
  clusterStatus?: IntelligenceEventCluster['status']
  relevance: EventMatch['relevance']
  match: EventMatch
  intelligenceLayer?: IntelligenceLayer
  dataDomain?: IntelligenceDataDomain
  eventFamily?: IntelligenceEventFamily
  direction?: IntelligenceImpactDirection
  magnitude?: number
  confidence?: number
  impactReason?: string
  impactScope?: string
  sourceReliability?: IntelligenceReliabilityTier
}

export type IntelligenceSentimentAggregateRow = {
  aggregateId: string
  scopeType: IntelligenceSentimentScope
  scopeKey: string
  horizon: IntelligenceSentimentHorizon
  aggregateScore: number
  aggregateLabel: IntelligenceSentimentLabel
  signalCount: number
  supportingItemIds: string[]
  supportingClusterIds: string[]
  layerBreakdown?: Record<string, number>
  directionBreakdown?: Record<string, number>
  updatedAt: string
}

export type IntelligenceOverviewView = {
  status: IntelligenceWorkspaceStatusView
  layerDesk: IntelligenceLayerDeskColumn[]
  sourceCoverage: IntelligenceSourceCoverageView[]
  recentEvents: IntelligenceTimelineRow[]
}

export type IntelligenceDetailView = {
  kind: 'timeline' | 'sentiment'
  clusterId?: string
  itemId?: string
  aggregateId?: string
  title: string
  summary?: string
  displayTitle?: string
  originalTitle?: string
  originalSummary?: string
  translationStatus?: IntelligenceTranslationStatus
  translationErrorCode?: string
  translatedAt?: string
  sources: Array<{ sourceId: string; sourceName: string }>
  latestRevision?: {
    revisionId: string
    revisionKind: IntelligenceItemRevision['revisionKind']
    detectedAt: string
  }
  latestAssessment?: {
    assessmentId: string
    direction?: string
    sentimentLabel?: string
    alertDecision: IntelligenceAssessment['alertDecision']
    createdAt: string
  }
  rawEvidence?: Array<{
    rawRecordId: string
    payloadFormat: string
    payloadRefType: string
    payloadHash: string
    processingState: string
  }>
  sentiment?: {
    scopeType: IntelligenceSentimentScope
    scopeKey: string
    horizon: IntelligenceSentimentHorizon
    aggregateScore: number
    aggregateLabel: IntelligenceSentimentLabel
    supportingItemIds: string[]
    supportingClusterIds: string[]
    supportingItems: Array<{
      itemId: string
      title: string
      sourceId: string
      sourceName: string
      layer?: IntelligenceLayer
      direction?: IntelligenceImpactDirection
      impactRuleIds: string[]
    }>
    omittedSupportingItemCount: number
    sourceGroupBreakdown?: Record<string, number>
    layerBreakdown?: Record<string, number>
    directionBreakdown?: Record<string, number>
  }
  impacts?: Array<{
    direction: IntelligenceImpactDirection
    magnitude: number
    confidence: number
    scopeType: string
    scopeKey: string
    reasoning: string
    evidence: ReturnType<typeof parseImpactEvidence>
    ruleId: string
    layer?: IntelligenceLayer
  }>
  metricEvent?: {
    metricName: string
    actual: number
    forecast?: number
    previous?: number
    unit?: string
    period?: string
    surpriseDirection: string
    forecastMissing?: boolean
  }
  sourceReliability?: IntelligenceReliabilityTier
}

export type IntelligenceOperationsHealthView = {
  sources: Array<{
    sourceId: string
    sourceName: string
    runtimeStatus: import('../schema/intelligenceSourcesContracts').IntelligenceSourceFreshnessStatus
    workerStatus?: string
    lastSuccessAt?: string
    lastFailureAt?: string
    consecutiveFailures: number
    lastRunSummary?: string
  }>
}

export type IntelligenceWorkspaceState = {
  activeView: IntelligenceWorkspaceView
  filters: IntelligenceWorkspaceFilters
  overview: IntelligenceOverviewView
  timelineRows: IntelligenceTimelineRow[]
  sentimentRows: IntelligenceSentimentAggregateRow[]
  updatedAt: string
}

const OPERATIONAL_EVENT_TYPES = new Set(['collection-run', 'worker-heartbeat', 'archive-job', 'runtime-log'])

export function createIntelligenceWorkspaceQueries(deps: {
  pipeline: IntelligencePipeline
  sourcesService: IntelligenceSourcesService
  translationService?: IntelligenceTranslationService
  listLegacyEvents?: (limit?: number) => Promise<NormalizedMarketEvent[]>
}) {
  return {
    getWorkspaceState(input: {
      view?: IntelligenceWorkspaceView
      filters?: IntelligenceWorkspaceFilters
      matchContext: WorkspaceMatchContext
    }): IntelligenceWorkspaceState {
      const filters = normalizeFilters(input.filters)
      const timelineRows = buildTimelineRows(deps, filters, input.matchContext)
      const sentimentRows = buildSentimentRows(deps.pipeline, filters)
      const broadTimelineCount = buildTimelineRows(deps, broadenFilters(filters), input.matchContext).length

      return {
        activeView: input.view ?? 'overview',
        filters,
        overview: buildOverview(deps, filters, timelineRows, sentimentRows, new Map(), broadTimelineCount),
        timelineRows,
        sentimentRows,
        updatedAt: new Date().toISOString()
      }
    },

    async getWorkspaceStateAsync(input: {
      view?: IntelligenceWorkspaceView
      filters?: IntelligenceWorkspaceFilters
      matchContext: WorkspaceMatchContext
      textMode?: 'translated' | 'original'
    }): Promise<IntelligenceWorkspaceState> {
      const [profiles, focusMarketSettings] = await Promise.all([
        deps.sourcesService.listProfiles(),
        deps.sourcesService.getFocusSettings()
      ])
      const profileById = new Map(profiles.map((profile) => [profile.sourceId, profile]))
      const enabledFocusMarkets = focusMarketSettings.enabledFocusMarkets
      const filters = normalizeFilters(input.filters)
      const timelineRows = await enrichTimelineRows(
        buildTimelineRows(deps, filters, input.matchContext),
        deps.translationService,
        input.textMode
      )
      const sentimentRows = filterSentimentRowsByFocus(
        deps.pipeline,
        buildSentimentRows(deps.pipeline, filters),
        enabledFocusMarkets
      )
      const broadTimelineCount = buildTimelineRows(deps, broadenFilters(filters), input.matchContext).length

      return {
        activeView: input.view ?? 'overview',
        filters,
        overview: buildOverview(
          deps,
          filters,
          timelineRows,
          sentimentRows,
          profileById,
          broadTimelineCount,
          enabledFocusMarkets
        ),
        timelineRows,
        sentimentRows,
        updatedAt: new Date().toISOString()
      }
    },

    async getTimeline(
      filters: IntelligenceWorkspaceFilters,
      matchContext: WorkspaceMatchContext,
      textMode?: 'translated' | 'original'
    ): Promise<IntelligenceTimelineRow[]> {
      return enrichTimelineRows(
        buildTimelineRows(deps, normalizeFilters(filters), matchContext),
        deps.translationService,
        textMode
      )
    },

    getSentimentAggregates(filters: IntelligenceWorkspaceFilters): IntelligenceSentimentAggregateRow[] {
      return buildSentimentRows(deps.pipeline, normalizeFilters(filters))
    },

    async getDetail(input: {
      clusterId?: string
      itemId?: string
      aggregateId?: string
      textMode?: 'translated' | 'original'
    }): Promise<IntelligenceDetailView | undefined> {
      if (input.aggregateId) {
        return buildSentimentDetail(deps.pipeline, input.aggregateId)
      }

      const cluster = input.clusterId
        ? deps.pipeline.listClusters().find((entry) => entry.clusterId === input.clusterId)
        : undefined
      const item =
        deps.pipeline.listItems().find((entry) => entry.itemId === input.itemId) ??
        (cluster ? deps.pipeline.listItems().find((entry) => entry.itemId === cluster.primaryItemId) : undefined)

      if (!item && !cluster) return undefined
      return await buildTimelineDetail(deps.pipeline, cluster, item, deps.translationService, input.textMode)
    },

    async getOperationsHealth(): Promise<IntelligenceOperationsHealthView> {
      const [definitions, profiles] = await Promise.all([
        Promise.resolve(deps.sourcesService.listDefinitions()),
        deps.sourcesService.listProfiles()
      ])
      const profileById = new Map(profiles.map((profile) => [profile.sourceId, profile]))
      const sources = definitions
        .filter((definition) => !isDefillamaStablecoinRetiredPath(definition.sourceId))
        .map((definition) => {
          const profile = profileById.get(definition.sourceId)
          const enabled = profile?.enabled ?? false
          const pipelineHealth = deps.pipeline.getHealth(definition.sourceId)
          return {
            sourceId: definition.sourceId,
            sourceName: definition.displayName,
            runtimeStatus: resolveSourceFreshnessStatus(enabled, pipelineHealth),
            lastSuccessAt: pipelineHealth?.lastSuccessAt,
            lastFailureAt: pipelineHealth?.lastFailureAt,
            consecutiveFailures: pipelineHealth?.consecutiveFailures ?? 0,
            lastRunSummary: pipelineHealth?.lastRunSummary
          }
        })
      return { sources }
    }
  }
}

export type WorkspaceMatchContext = {
  monitoringScope: Parameters<typeof matchMarketEvent>[1]
  matchPolicy: Parameters<typeof matchMarketEvent>[2]
  alerts: IntelligenceWorkspaceAlertRecord[]
}

function buildTimelineRows(
  deps: {
    pipeline: IntelligencePipeline
    listLegacyEvents?: (limit?: number) => Promise<NormalizedMarketEvent[]>
  },
  filters: IntelligenceWorkspaceFilters,
  matchContext: WorkspaceMatchContext
): IntelligenceTimelineRow[] {
  const clusters = deps.pipeline.listClusters()
  const items = deps.pipeline.listItems()
  const revisions = listRevisions(deps.pipeline)
  const rows: IntelligenceTimelineRow[] = []
  const consumedItems = new Set<string>()

  for (const cluster of clusters.sort((left, right) =>
    compareTimelineTimestamps(
      resolveTimelineTimestamp({
        publishedAt: left.lastPublishedAt,
        detectedAt: left.lastDetectedAt
      }),
      resolveTimelineTimestamp({
        publishedAt: right.lastPublishedAt,
        detectedAt: right.lastDetectedAt
      })
    )
  )) {
    const primaryItem = items.find((item) => item.itemId === cluster.primaryItemId)
    if (!primaryItem) continue
    if (OPERATIONAL_EVENT_TYPES.has(primaryItem.eventType)) continue

    const row = toTimelineRow(primaryItem, cluster, revisions, matchContext, deps.pipeline)
    if (!passesFilters(row, filters, matchContext)) continue
    rows.push(row)
    consumedItems.add(primaryItem.itemId)
    items.filter((item) => item.clusterId === cluster.clusterId).forEach((item) => consumedItems.add(item.itemId))
  }

  for (const item of items.sort((left, right) =>
    compareTimelineTimestamps(resolveTimelineTimestamp(left), resolveTimelineTimestamp(right))
  )) {
    if (consumedItems.has(item.itemId)) continue
    if (item.clusterId) continue
    if (OPERATIONAL_EVENT_TYPES.has(item.eventType)) continue

    const row = toTimelineRow(item, undefined, revisions, matchContext, deps.pipeline)
    if (!passesFilters(row, filters, matchContext)) continue
    rows.push(row)
  }

  return rows
    .sort((left, right) => compareTimelineTimestamps(left.timelineAt, right.timelineAt))
    .slice(0, filters.limit ?? 50)
}

function buildSentimentRows(
  pipeline: IntelligencePipeline,
  filters: IntelligenceWorkspaceFilters
): IntelligenceSentimentAggregateRow[] {
  return pipeline
    .listSentimentAggregates()
    .filter((aggregate) => passesSentimentFilters(aggregate, filters))
    .map(toSentimentRow)
    .filter((row) => row.signalCount > 0)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, filters.limit ?? 50)
}

function buildOverview(
  deps: { pipeline: IntelligencePipeline; sourcesService: IntelligenceSourcesService },
  filters: IntelligenceWorkspaceFilters,
  timelineRows: IntelligenceTimelineRow[],
  sentimentRows: IntelligenceSentimentAggregateRow[],
  profileById: Map<string, IntelligenceSourceProfile> = new Map(),
  totalTimelineCount = timelineRows.length,
  enabledFocusMarkets?: IntelligenceFocusMarket[]
): IntelligenceOverviewView {
  const status = buildWorkspaceStatus({
    filters,
    timelineRows,
    sentimentRows,
    profileById,
    pipeline: deps.pipeline,
    totalTimelineCount,
    enabledFocusMarkets
  })

  return {
    status,
    layerDesk: buildLayerDesk({
      timelineRows,
      profileById,
      pipeline: deps.pipeline,
      enabledFocusMarkets
    }),
    sourceCoverage: buildSourceCoverage({
      profileById,
      pipeline: deps.pipeline,
      enabledFocusMarkets
    }),
    recentEvents: timelineRows.slice(0, 8)
  }
}

function filterSentimentRowsByFocus(
  pipeline: IntelligencePipeline,
  rows: IntelligenceSentimentAggregateRow[],
  enabledFocusMarkets: IntelligenceFocusMarket[]
): IntelligenceSentimentAggregateRow[] {
  const itemsById = new Map(pipeline.listItems().map((item) => [item.itemId, item]))
  return rows.filter((row) =>
    row.supportingItemIds.some((itemId) => {
      const item = itemsById.get(itemId)
      if (!item) return false
      const definition = getIntelligenceSourceDefinition(item.sourceId)
      if (!definition) return false
      return isItemApplicableToFocusMarkets(item, definition, enabledFocusMarkets)
    })
  )
}

function broadenFilters(filters: IntelligenceWorkspaceFilters): IntelligenceWorkspaceFilters {
  return {
    ...filters,
    sourceGroup: 'all',
    scope: 'all',
    symbol: undefined,
    layer: 'all',
    direction: 'all',
    eventFamily: 'all',
    sourceReliability: 'all',
    alertDecision: 'all',
    status: 'all',
    eventType: 'all',
    limit: 500
  }
}

function buildTimelineDetail(
  pipeline: IntelligencePipeline,
  cluster: IntelligenceEventCluster | undefined,
  item: IntelligenceItem | undefined,
  translationService?: IntelligenceTranslationService,
  textMode?: 'translated' | 'original'
): IntelligenceDetailView | Promise<IntelligenceDetailView> {
  const revisions = listRevisions(pipeline).filter((revision) => revision.itemId === item?.itemId)
  const latestRevision = revisions.sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))[0]
  const latestAssessment = pipeline
    .listAssessments()
    .filter((assessment) => assessment.itemId === item?.itemId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const itemImpacts = item
    ? pipeline.listImpacts().filter((impact) => impact.itemId === item.itemId)
    : []
  const metricEvent = item
    ? pipeline.listMetricEvents().find((entry) => entry.itemId === item.itemId)
    : undefined
  const definition = item ? getIntelligenceSourceDefinition(item.sourceId) : undefined

  const relatedItems = cluster
    ? pipeline.listItems().filter((entry) => entry.clusterId === cluster.clusterId)
    : item
      ? [item]
      : []

  const base: IntelligenceDetailView = {
    kind: 'timeline',
    clusterId: cluster?.clusterId,
    itemId: item?.itemId,
    title: cluster?.title ?? item?.title ?? '',
    summary: item?.summary,
    originalTitle: cluster?.title ?? item?.title ?? '',
    originalSummary: item?.summary,
    sources: relatedItems.map((entry) => ({
      sourceId: entry.sourceId,
      sourceName: getIntelligenceSourceDefinition(entry.sourceId)?.displayName ?? entry.sourceId
    })),
    latestRevision: latestRevision
      ? {
          revisionId: latestRevision.revisionId,
          revisionKind: latestRevision.revisionKind,
          detectedAt: latestRevision.detectedAt
        }
      : undefined,
    latestAssessment: latestAssessment
      ? {
          assessmentId: latestAssessment.assessmentId,
          direction: latestAssessment.direction,
          sentimentLabel: latestAssessment.sentimentLabel,
          alertDecision: latestAssessment.alertDecision,
          createdAt: latestAssessment.createdAt
        }
      : undefined,
    impacts: itemImpacts.map((impact) => ({
      direction: impact.direction,
      magnitude: impact.magnitude,
      confidence: impact.confidence,
      scopeType: impact.scopeType,
      scopeKey: impact.scopeKey,
      reasoning: impact.reasoning,
      evidence: parseImpactEvidence(impact.evidenceJson),
      ruleId: impact.ruleId,
      layer: impact.layer
    })),
    metricEvent: metricEvent
      ? {
          metricName: metricEvent.metricName,
          actual: metricEvent.actual,
          forecast: metricEvent.forecast,
          previous: metricEvent.previous,
          unit: metricEvent.unit,
          period: metricEvent.period,
          surpriseDirection: metricEvent.surpriseDirection,
          forecastMissing: metricEvent.comparisonBasis === 'actual-vs-previous' && metricEvent.forecast === undefined
        }
      : undefined,
    sourceReliability: definition?.reliabilityTier,
    rawEvidence: item
      ? [
          {
            rawRecordId: item.primaryRawRecordId,
            payloadFormat: 'rss-item',
            payloadRefType: 'inline',
            payloadHash: item.canonicalDedupeKey.slice(0, 16),
            processingState: item.timelineStatus
          }
        ]
      : undefined
  }

  if (!item || !translationService) return base

  return translationService.resolveDisplayText({ itemId: item.itemId, textMode }).then((display) => {
    if (!display) return base
    return {
      ...base,
      title: display.title,
      summary: display.summary,
      displayTitle: display.title,
      originalTitle: display.originalTitle,
      originalSummary: display.originalSummary,
      translationStatus: display.status,
      translationErrorCode: display.errorCode,
      translatedAt: display.translatedAt
    }
  })
}

async function enrichTimelineRows(
  rows: IntelligenceTimelineRow[],
  translationService?: IntelligenceTranslationService,
  textMode?: 'translated' | 'original'
): Promise<IntelligenceTimelineRow[]> {
  if (!translationService) return rows
  const displays = await translationService.resolveDisplayTexts({
    itemIds: rows.map((row) => row.itemId),
    textMode
  })
  return rows.map((row) => {
    const display = displays[row.itemId]
    if (!display) return row
    return {
      ...row,
      title: display.title,
      summary: display.summary,
      displayTitle: display.title,
      originalTitle: display.originalTitle,
      translationStatus: display.status
    }
  })
}

function buildSentimentDetail(pipeline: IntelligencePipeline, aggregateId: string): IntelligenceDetailView | undefined {
  const aggregate = pipeline.listSentimentAggregates().find((entry) => entry.aggregateId === aggregateId)
  if (!aggregate) return undefined

  const row = toSentimentRow(aggregate)
  const supportingSummary = buildSupportingItemSummaries(pipeline, row.supportingItemIds)
  return {
    kind: 'sentiment',
    aggregateId: aggregate.aggregateId,
    title: `${aggregate.scopeType}:${aggregate.scopeKey}`,
    sources: [],
    sentiment: {
      scopeType: aggregate.scopeType,
      scopeKey: aggregate.scopeKey,
      horizon: aggregate.horizon,
      aggregateScore: aggregate.aggregateScore,
      aggregateLabel: aggregate.aggregateLabel,
      supportingItemIds: row.supportingItemIds,
      supportingClusterIds: row.supportingClusterIds,
      supportingItems: supportingSummary.items,
      omittedSupportingItemCount: supportingSummary.omittedCount,
      sourceGroupBreakdown: parseRecord(aggregate.sourceGroupBreakdownJson),
      layerBreakdown: parseRecord(aggregate.layerBreakdownJson),
      directionBreakdown: parseRecord(aggregate.directionBreakdownJson)
    }
  }
}

function buildSupportingItemSummaries(
  pipeline: IntelligencePipeline,
  supportingItemIds: string[]
): {
  items: NonNullable<IntelligenceDetailView['sentiment']>['supportingItems']
  omittedCount: number
} {
  const limit = 20
  const selectedIds = supportingItemIds.slice(0, limit)
  const items = pipeline.listItems()
  const impacts = pipeline.listImpacts()

  const summaries = selectedIds
    .map((itemId) => {
      const item = items.find((entry) => entry.itemId === itemId)
      if (!item) return undefined
      const definition = getIntelligenceSourceDefinition(item.sourceId)
      const itemImpacts = impacts.filter((impact) => impact.itemId === itemId)
      const primaryImpact = pickPrimaryImpact(itemImpacts)
      return {
        itemId,
        title: item.title,
        sourceId: item.sourceId,
        sourceName: definition?.displayName ?? item.sourceId,
        layer: primaryImpact?.layer ?? definition?.intelligenceLayer,
        direction: primaryImpact?.direction,
        impactRuleIds: [...new Set(itemImpacts.map((impact) => impact.ruleId).filter(Boolean))]
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  return {
    items: summaries,
    omittedCount: Math.max(0, supportingItemIds.length - summaries.length)
  }
}

function toTimelineRow(
  item: IntelligenceItem,
  cluster: IntelligenceEventCluster | undefined,
  revisions: IntelligenceItemRevision[],
  matchContext: WorkspaceMatchContext,
  pipeline: IntelligencePipeline
): IntelligenceTimelineRow {
  const event = itemToMarketEvent(item)
  const match = matchMarketEvent(event, matchContext.monitoringScope, matchContext.matchPolicy)
  const alert = findAlert(matchContext.alerts, item.itemId, cluster?.clusterId)
  const definition = getIntelligenceSourceDefinition(item.sourceId)
  const labels = parseProcessingLabels(item.processingLabelsJson)
  const itemImpacts = pipeline.listImpacts().filter((impact) => impact.itemId === item.itemId)
  const primaryImpact = pickPrimaryImpact(itemImpacts)
  const displayTitle = sanitizeIntelligenceText(cluster?.title ?? item.title)
  const publishedAt = resolveEffectivePublishedAt({
    publishedAt: item.publishedAt,
    detectedAt: item.detectedAt,
    title: displayTitle
  })
  const timelineAt = publishedAt ?? item.detectedAt
  const displayAt = timelineAt
  const isBackfill =
    labels.isBackfill ??
    (publishedAt && item.detectedAt ? isBackfillItem(publishedAt, item.detectedAt) : false)

  return {
    rowId: cluster?.clusterId ?? item.itemId,
    identityKind: cluster ? 'cluster' : 'item',
    clusterId: cluster?.clusterId,
    itemId: item.itemId,
    sourceId: item.sourceId,
    sourceName: definition?.displayName ?? item.sourceId,
    sourceGroup: definition?.sourceGroup ?? 'unknown',
    eventType: item.eventType,
    title: displayTitle,
    summary: item.summary ? sanitizeIntelligenceText(item.summary) : undefined,
    publishedAt,
    detectedAt: item.detectedAt,
    displayAt,
    timelineAt,
    isBackfill,
    assessmentStatus: labels.assessmentStatus ?? (item.timelineStatus === 'evaluated' ? 'evaluated' : 'pending'),
    assessmentErrorCode: labels.assessmentErrorCode,
    symbols: parseJsonArray(item.symbolsJson),
    alertStatus: alert?.status ?? 'none',
    hasRevision: revisions.some((revision) => revision.itemId === item.itemId && revision.revisionKind !== 'initial'),
    clusterStatus: cluster?.status,
    relevance: match.relevance,
    match,
    intelligenceLayer: labels.intelligenceLayer ?? definition?.intelligenceLayer,
    dataDomain: labels.dataDomain ?? definition?.dataDomain,
    eventFamily: labels.eventFamily ?? definition?.eventFamily,
    direction: primaryImpact?.direction,
    magnitude: primaryImpact?.magnitude,
    confidence: primaryImpact?.confidence,
    impactReason: primaryImpact?.reasoning,
    impactScope: primaryImpact ? `${primaryImpact.scopeType}:${primaryImpact.scopeKey}` : undefined,
    sourceReliability: definition?.reliabilityTier
  }
}

function pickPrimaryImpact(impacts: ReturnType<IntelligencePipeline['listImpacts']>) {
  if (impacts.length === 0) return undefined
  return [...impacts].sort((left, right) => right.magnitude * right.confidence - left.magnitude * left.confidence)[0]
}

function toSentimentRow(aggregate: IntelligenceSentimentAggregate): IntelligenceSentimentAggregateRow {
  return {
    aggregateId: aggregate.aggregateId,
    scopeType: aggregate.scopeType,
    scopeKey: aggregate.scopeKey,
    horizon: aggregate.horizon,
    aggregateScore: aggregate.aggregateScore,
    aggregateLabel: aggregate.aggregateLabel,
    signalCount: aggregate.signalCount,
    supportingItemIds: parseJsonArray(aggregate.supportingItemIdsJson),
    supportingClusterIds: parseJsonArray(aggregate.supportingClusterIdsJson),
    layerBreakdown: parseRecord(aggregate.layerBreakdownJson),
    directionBreakdown: parseRecord(aggregate.directionBreakdownJson),
    updatedAt: aggregate.updatedAt
  }
}

function passesFilters(
  row: IntelligenceTimelineRow,
  filters: IntelligenceWorkspaceFilters,
  matchContext: WorkspaceMatchContext
): boolean {
  if (filters.sourceGroup && filters.sourceGroup !== 'all' && row.sourceGroup !== filters.sourceGroup) return false
  if (filters.symbol && !row.symbols.some((symbol) => symbol.includes(filters.symbol!.toUpperCase()))) return false
  if (filters.eventType && filters.eventType !== 'all' && row.eventType !== filters.eventType) return false
  if (filters.status && filters.status !== 'all' && row.clusterStatus !== filters.status) return false
  if (filters.alertDecision && filters.alertDecision !== 'all' && row.alertStatus !== filters.alertDecision) return false
  if (!filters.includeBackfill && row.isBackfill) return false
  if (filters.layer && filters.layer !== 'all' && row.intelligenceLayer !== filters.layer) return false
  if (filters.direction && filters.direction !== 'all' && row.direction !== filters.direction) return false
  if (filters.eventFamily && filters.eventFamily !== 'all' && row.eventFamily !== filters.eventFamily) return false
  if (
    filters.sourceReliability &&
    filters.sourceReliability !== 'all' &&
    row.sourceReliability !== filters.sourceReliability
  ) {
    return false
  }
  const timelineAt = row.timelineAt ?? row.displayAt ?? row.publishedAt ?? row.detectedAt
  if (!timelineAt || !withinTimeRange(timelineAt, filters.timeRange)) return false

  const scope = filters.scope ?? 'both'
  if (scope !== 'all' && !isTimelineRelevant(row.match, scope)) return false

  return true
}

function passesSentimentFilters(
  aggregate: IntelligenceSentimentAggregate,
  filters: IntelligenceWorkspaceFilters
): boolean {
  if (filters.horizon && aggregate.horizon !== filters.horizon) return false
  if (filters.scopeType && filters.scopeType !== 'all' && aggregate.scopeType !== filters.scopeType) return false
  if (filters.aggregateLabel && filters.aggregateLabel !== 'all' && aggregate.aggregateLabel !== filters.aggregateLabel) {
    return false
  }
  if (filters.symbol && aggregate.scopeKey.toUpperCase() !== filters.symbol.toUpperCase() && aggregate.scopeType !== 'market-wide') {
    return false
  }
  return true
}

function normalizeFilters(filters: IntelligenceWorkspaceFilters = {}): IntelligenceWorkspaceFilters {
  return {
    timeRange: filters.timeRange ?? '7d',
    sourceGroup: filters.sourceGroup ?? 'all',
    scope: filters.scope ?? 'all',
    symbol: filters.symbol?.trim().toUpperCase() || undefined,
    status: filters.status ?? 'all',
    eventType: filters.eventType ?? 'all',
    alertDecision: filters.alertDecision ?? 'all',
    horizon: filters.horizon ?? '1h',
    scopeType: filters.scopeType ?? 'all',
    aggregateLabel: filters.aggregateLabel ?? 'all',
    limit: filters.limit ?? 50,
    includeBackfill: filters.includeBackfill ?? false,
    layer: filters.layer ?? 'all',
    direction: filters.direction ?? 'all',
    eventFamily: filters.eventFamily ?? 'all',
    sourceReliability: filters.sourceReliability ?? 'all'
  }
}

function withinTimeRange(timelineAt: string, timeRange: IntelligenceWorkspaceTimeRange = '7d'): boolean {
  if (timeRange === 'all') return true
  const timelineMs = parseTimelineInstant(timelineAt)
  if (!Number.isFinite(timelineMs) || timelineMs <= 0) return false
  const now = Date.now()
  const ranges: Record<Exclude<IntelligenceWorkspaceTimeRange, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  }
  return now - timelineMs <= ranges[timeRange]
}

function itemToMarketEvent(item: IntelligenceItem): NormalizedMarketEvent {
  const marketWideCritical =
    item.sourceCategory === 'exchange-announcement' ||
    item.sourceCategory === 'regulation' ||
    item.sourceCategory === 'macro'

  return {
    id: item.itemId,
    sourceId: item.sourceId,
    sourceType: item.sourceCategory,
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt ?? item.detectedAt,
    detectedAt: item.detectedAt,
    category: item.sourceCategory,
    symbols: parseJsonArray(item.symbolsJson),
    assets: parseJsonArray(item.entitiesJson),
    sourceTrust: item.sourceTrust as NormalizedMarketEvent['sourceTrust'],
    marketWideCritical
  }
}

function findAlert(alerts: IntelligenceWorkspaceAlertRecord[], itemId: string, clusterId?: string) {
  return alerts.find(
    (alert) =>
      alert.correlationId === clusterId ||
      alert.correlationId === itemId ||
      alert.safeFacts.eventId === itemId
  )
}

function listRevisions(pipeline: IntelligencePipeline): IntelligenceItemRevision[] {
  return pipeline.listRevisions()
}

function parseJsonArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseRecord(value?: string): Record<string, number> | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as Record<string, number>
  } catch {
    return undefined
  }
}

export type IntelligenceWorkspaceQueries = ReturnType<typeof createIntelligenceWorkspaceQueries>
