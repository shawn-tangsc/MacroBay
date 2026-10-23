import type { IntelligenceLayer, IntelligenceImpactDirection } from '../schema/intelligenceLayer'
import type {
  IntelligenceFocusMarket,
  IntelligenceSourceProfile,
  IntelligenceSourceReadiness
} from '../schema/intelligenceSource'
import { sourceRequiresCredential } from '../schema/intelligenceSource'
import type { IntelligenceSourceFreshnessStatus } from '../schema/intelligenceSourcesContracts'
import { resolveSourceFreshnessStatus } from '../schema/intelligenceSourcesContracts'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import {
  getIntelligenceSourceDefinition,
  isDefillamaStablecoinRetiredPath,
  listIntelligenceSourceDefinitions
} from './sourceCatalog'
import { isSourceApplicableToFocusMarkets } from './intelligenceSourceApplicability'
import type { IntelligencePipeline } from './intelligencePipeline'
import type {
  IntelligenceSentimentAggregateRow,
  IntelligenceTimelineRow,
  IntelligenceWorkspaceFilters
} from './intelligenceWorkspaceQueries'

export type IntelligenceWorkspaceEmptyReason =
  | 'no-sources-enabled'
  | 'enabled-never-run'
  | 'source-failed'
  | 'filters-too-narrow'
  | 'no-sentiment-signal'
  | 'no-recent-events'

export type IntelligenceWorkspaceAttentionKind =
  | 'source-failed'
  | 'source-pending'
  | 'credential-missing'
  | 'planned-source-visible'
  | 'fixture-ready-source-visible'

export type IntelligenceWorkspaceAttentionAction =
  | 'open-runtime'
  | 'open-settings'
  | 'clear-filters'
  | 'open-timeline'
  | 'none'

export type IntelligenceFearGreedBucket =
  | 'extreme-fear'
  | 'fear'
  | 'neutral'
  | 'greed'
  | 'extreme-greed'

export type IntelligenceFearGreedState = 'live' | 'pending' | 'failed' | 'not-collected'

export type IntelligenceWorkspaceStatusView = {
  matchingEventCount: number
  effectiveSignalCount: number
  liveSourceCount: number
  needsAttentionCount: number
  pendingSourceCount: number
  failedSourceCount: number
  plannedSourceCount: number
  fixtureReadySourceCount: number
  latestSuccessAt?: string
  activeFilterTokens: Array<{ kind: string; value: string }>
  emptyReason?: IntelligenceWorkspaceEmptyReason
  attentionItems: Array<{
    kind: IntelligenceWorkspaceAttentionKind
    sourceId?: string
    action: IntelligenceWorkspaceAttentionAction
  }>
  fearGreed?: {
    score?: number
    classification?: string
    bucket?: IntelligenceFearGreedBucket
    updatedAt?: string
    sourceId: 'alternative-fear-greed'
    readiness: IntelligenceSourceReadiness
    includedInAggregate: boolean
    state: IntelligenceFearGreedState
  }
}

export type IntelligenceLayerDeskSourceRow = {
  sourceId: string
  sourceName: string
  readiness: IntelligenceSourceReadiness
  runtimeStatus: IntelligenceSourceFreshnessStatus
  enabled: boolean
  lastSuccessAt?: string
}

export type IntelligenceLayerDeskColumn = {
  layer: Extract<IntelligenceLayer, 'macro' | 'industry' | 'asset'>
  collectionState: 'healthy' | 'degraded' | 'failed' | 'pending' | 'paused' | 'none-enabled'
  latestEventTitle?: string
  latestEventAt?: string
  latestImpactDirection?: IntelligenceImpactDirection
  lastSuccessAt?: string
  readinessCoverage: {
    live: number
    fixtureReady: number
    planned: number
  }
  sources: IntelligenceLayerDeskSourceRow[]
  plannedSourceIds: string[]
  fixtureReadySourceIds: string[]
}

const DESK_LAYERS: IntelligenceLayerDeskColumn['layer'][] = ['macro', 'industry', 'asset']
const FEAR_GREED_SOURCE_ID = 'alternative-fear-greed'

export function buildWorkspaceStatus(input: {
  filters: IntelligenceWorkspaceFilters
  timelineRows: IntelligenceTimelineRow[]
  sentimentRows: IntelligenceSentimentAggregateRow[]
  profileById: Map<string, IntelligenceSourceProfile>
  pipeline: IntelligencePipeline
  totalTimelineCount: number
  enabledFocusMarkets?: IntelligenceFocusMarket[]
}): IntelligenceWorkspaceStatusView {
  const definitions = listIntelligenceSourceDefinitions().filter(
    (definition) => !isDefillamaStablecoinRetiredPath(definition.sourceId)
  )
  const effectiveRows = input.sentimentRows.filter((row) => row.signalCount > 0)
  const sourceRows = definitions.map((definition) => {
    const profile = input.profileById.get(definition.sourceId)
    const enabled = profile?.enabled ?? false
    const health = input.pipeline.getHealth(definition.sourceId)
    const focusMarketActive =
      !input.enabledFocusMarkets || isSourceApplicableToFocusMarkets(definition, input.enabledFocusMarkets)
    return {
      definition,
      profile,
      enabled,
      focusMarketActive,
      runtimeStatus: resolveSourceFreshnessStatus(enabled, health),
      lastSuccessAt: health?.lastSuccessAt
    }
  })

  const focusScopedRows = sourceRows.filter((row) => row.focusMarketActive)
  const runnableSources = focusScopedRows.filter((row) => row.definition.readiness === 'live')
  const enabledRunnable = runnableSources.filter((row) => row.enabled)
  const liveSourceCount = enabledRunnable.filter(
    (row) => row.runtimeStatus === 'healthy' || row.runtimeStatus === 'degraded'
  ).length
  const pendingSourceCount = enabledRunnable.filter((row) => row.runtimeStatus === 'pending').length
  const failedSourceCount = enabledRunnable.filter((row) => row.runtimeStatus === 'failed').length
  const plannedSourceCount = focusScopedRows.filter((row) => row.definition.readiness === 'planned').length
  const fixtureReadySourceCount = focusScopedRows.filter(
    (row) => row.definition.readiness === 'fixture-ready'
  ).length

  const attentionItems = buildAttentionItems(focusScopedRows)
  const latestSuccessAt = focusScopedRows
    .map((row) => row.lastSuccessAt)
    .filter(Boolean)
    .sort((left, right) => right!.localeCompare(left!))[0]

  const emptyReason = resolveEmptyReason({
    filters: input.filters,
    matchingEventCount: input.timelineRows.length,
    totalTimelineCount: input.totalTimelineCount,
    effectiveSignalCount: effectiveRows.length,
    enabledRunnableCount: enabledRunnable.length,
    pendingSourceCount,
    failedSourceCount
  })

  return {
    matchingEventCount: input.timelineRows.length,
    effectiveSignalCount: effectiveRows.length,
    liveSourceCount,
    needsAttentionCount: attentionItems.length,
    pendingSourceCount,
    failedSourceCount,
    plannedSourceCount,
    fixtureReadySourceCount,
    latestSuccessAt,
    activeFilterTokens: buildActiveFilterTokens(input.filters),
    emptyReason,
    attentionItems,
    fearGreed: buildFearGreedStatus(
      input.pipeline,
      input.profileById.get(FEAR_GREED_SOURCE_ID),
      effectiveRows,
      input.enabledFocusMarkets
    )
  }
}

export function buildLayerDesk(input: {
  timelineRows: IntelligenceTimelineRow[]
  profileById: Map<string, IntelligenceSourceProfile>
  pipeline: IntelligencePipeline
  enabledFocusMarkets?: IntelligenceFocusMarket[]
}): IntelligenceLayerDeskColumn[] {
  const definitions = listIntelligenceSourceDefinitions().filter(
    (definition) =>
      !isDefillamaStablecoinRetiredPath(definition.sourceId) &&
      (!input.enabledFocusMarkets || isSourceApplicableToFocusMarkets(definition, input.enabledFocusMarkets))
  )

  return DESK_LAYERS.map((layer) => {
    const layerDefinitions = definitions.filter((definition) => (definition.intelligenceLayer ?? 'industry') === layer)
    const sources: IntelligenceLayerDeskSourceRow[] = layerDefinitions.map((definition) => {
      const profile = input.profileById.get(definition.sourceId)
      const enabled = profile?.enabled ?? false
      const health = input.pipeline.getHealth(definition.sourceId)
      return {
        sourceId: definition.sourceId,
        sourceName: definition.displayName,
        readiness: definition.readiness ?? 'live',
        runtimeStatus: resolveSourceFreshnessStatus(enabled, health),
        enabled,
        lastSuccessAt: health?.lastSuccessAt
      }
    })

    const enabledRunnable = sources.filter((source) => source.enabled && source.readiness === 'live')
    const collectionState = resolveLayerCollectionState(enabledRunnable)
    const layerEvents = input.timelineRows.filter((row) => row.intelligenceLayer === layer)
    const latestEvent = layerEvents[0]

    const readinessCoverage = {
      live: sources.filter((source) => source.readiness === 'live').length,
      fixtureReady: sources.filter((source) => source.readiness === 'fixture-ready').length,
      planned: sources.filter((source) => source.readiness === 'planned').length
    }

    const lastSuccessAt = sources
      .map((source) => source.lastSuccessAt)
      .filter(Boolean)
      .sort((left, right) => right!.localeCompare(left!))[0]

    return {
      layer,
      collectionState,
      latestEventTitle: latestEvent?.title,
      latestEventAt: latestEvent?.timelineAt ?? latestEvent?.detectedAt,
      latestImpactDirection: latestEvent?.direction,
      lastSuccessAt,
      readinessCoverage,
      sources,
      plannedSourceIds: sources.filter((source) => source.readiness === 'planned').map((source) => source.sourceId),
      fixtureReadySourceIds: sources
        .filter((source) => source.readiness === 'fixture-ready')
        .map((source) => source.sourceId)
    }
  })
}

function buildAttentionItems(
  sourceRows: Array<{
    definition: ReturnType<typeof listIntelligenceSourceDefinitions>[number]
    profile?: IntelligenceSourceProfile
    enabled: boolean
    runtimeStatus: IntelligenceSourceFreshnessStatus
  }>
): IntelligenceWorkspaceStatusView['attentionItems'] {
  const items: IntelligenceWorkspaceStatusView['attentionItems'] = []
  const layerLiveCoverage = buildLayerLiveCoverageMap(sourceRows)

  for (const row of sourceRows) {
    if (row.definition.readiness === 'planned') {
      if (row.enabled) {
        items.push({
          kind: 'planned-source-visible',
          sourceId: row.definition.sourceId,
          action: 'open-settings'
        })
      }
      continue
    }

    if (row.definition.readiness === 'fixture-ready') {
      const layer = row.definition.intelligenceLayer ?? 'industry'
      if (!layerLiveCoverage.get(layer)) {
        items.push({
          kind: 'fixture-ready-source-visible',
          sourceId: row.definition.sourceId,
          action: 'none'
        })
      }
      continue
    }

    if (!row.enabled) continue

    if (row.runtimeStatus === 'failed') {
      items.push({
        kind: 'source-failed',
        sourceId: row.definition.sourceId,
        action: 'open-runtime'
      })
    } else if (row.runtimeStatus === 'pending') {
      items.push({
        kind: 'source-pending',
        sourceId: row.definition.sourceId,
        action: 'open-runtime'
      })
    }

    if (sourceRequiresCredential(row.definition.authMode) && !row.profile?.credentialRef) {
      items.push({
        kind: 'credential-missing',
        sourceId: row.definition.sourceId,
        action: 'open-settings'
      })
    }
  }

  return items.slice(0, 12)
}

function buildLayerLiveCoverageMap(
  sourceRows: Array<{
    definition: ReturnType<typeof listIntelligenceSourceDefinitions>[number]
    enabled: boolean
    runtimeStatus: IntelligenceSourceFreshnessStatus
  }>
): Map<IntelligenceLayer, boolean> {
  const coverage = new Map<IntelligenceLayer, boolean>()
  for (const row of sourceRows) {
    if (row.definition.readiness !== 'live' || !row.enabled) continue
    if (row.runtimeStatus !== 'healthy' && row.runtimeStatus !== 'degraded' && row.runtimeStatus !== 'pending') {
      continue
    }
    const layer = row.definition.intelligenceLayer ?? 'industry'
    coverage.set(layer, true)
  }
  return coverage
}

function resolveEmptyReason(input: {
  filters: IntelligenceWorkspaceFilters
  matchingEventCount: number
  totalTimelineCount: number
  effectiveSignalCount: number
  enabledRunnableCount: number
  pendingSourceCount: number
  failedSourceCount: number
}): IntelligenceWorkspaceEmptyReason | undefined {
  if (input.enabledRunnableCount === 0) return 'no-sources-enabled'
  if (input.matchingEventCount === 0 && input.totalTimelineCount > 0) return 'filters-too-narrow'
  if (input.matchingEventCount === 0 && input.pendingSourceCount > 0) return 'enabled-never-run'
  if (input.matchingEventCount === 0 && input.failedSourceCount > 0) return 'source-failed'
  if (input.matchingEventCount === 0) return 'no-recent-events'
  if (input.effectiveSignalCount === 0 && input.matchingEventCount > 0) return 'no-sentiment-signal'
  return undefined
}

function buildActiveFilterTokens(filters: IntelligenceWorkspaceFilters): Array<{ kind: string; value: string }> {
  const tokens: Array<{ kind: string; value: string }> = [
    { kind: 'timeRange', value: filters.timeRange ?? '7d' },
    { kind: 'sourceGroup', value: filters.sourceGroup ?? 'all' },
    { kind: 'scope', value: filters.scope ?? 'all' },
    { kind: 'layer', value: filters.layer ?? 'all' },
    { kind: 'direction', value: filters.direction ?? 'all' },
    { kind: 'horizon', value: filters.horizon ?? '1h' }
  ]

  if (filters.symbol?.trim()) {
    tokens.push({ kind: 'symbol', value: filters.symbol.trim().toUpperCase() })
  }
  if (filters.eventFamily && filters.eventFamily !== 'all') {
    tokens.push({ kind: 'eventFamily', value: filters.eventFamily })
  }
  if (filters.sourceReliability && filters.sourceReliability !== 'all') {
    tokens.push({ kind: 'sourceReliability', value: filters.sourceReliability })
  }

  return tokens
}

function buildFearGreedStatus(
  pipeline: IntelligencePipeline,
  profile: IntelligenceSourceProfile | undefined,
  effectiveRows: IntelligenceSentimentAggregateRow[],
  enabledFocusMarkets?: IntelligenceFocusMarket[]
): IntelligenceWorkspaceStatusView['fearGreed'] {
  const definition = getIntelligenceSourceDefinition(FEAR_GREED_SOURCE_ID)
  if (!definition) return undefined
  if (enabledFocusMarkets && !isSourceApplicableToFocusMarkets(definition, enabledFocusMarkets)) {
    return undefined
  }

  const enabled = profile?.enabled ?? false
  const health = pipeline.getHealth(FEAR_GREED_SOURCE_ID)
  const runtimeStatus = resolveSourceFreshnessStatus(enabled, health)
  const latestMetric = findLatestFearGreedMetric(pipeline.listMetricEvents())
  const includedInAggregate = isFearGreedIncludedInAggregate({
    pipeline,
    profile,
    effectiveRows
  })

  let state: IntelligenceFearGreedState = 'not-collected'
  if (latestMetric) {
    state = runtimeStatus === 'failed' ? 'failed' : runtimeStatus === 'pending' ? 'pending' : 'live'
  } else if (enabled) {
    state = runtimeStatus === 'failed' ? 'failed' : 'pending'
  }

  const classification = parseFearGreedClassification(latestMetric)
  const score = latestMetric?.actual

  return {
    sourceId: FEAR_GREED_SOURCE_ID,
    score,
    classification,
    bucket: score !== undefined ? resolveFearGreedBucket(score) : undefined,
    updatedAt: latestMetric?.releaseTime ?? health?.lastSuccessAt,
    readiness: definition.readiness ?? 'live',
    includedInAggregate,
    state
  }
}

function isFearGreedIncludedInAggregate(input: {
  pipeline: IntelligencePipeline
  profile?: IntelligenceSourceProfile
  effectiveRows: IntelligenceSentimentAggregateRow[]
}): boolean {
  if (!input.profile?.includeInSentiment || input.effectiveRows.length === 0) {
    return false
  }

  const fearGreedItemIds = new Set(
    input.pipeline
      .listItems()
      .filter((item) => item.sourceId === FEAR_GREED_SOURCE_ID)
      .map((item) => item.itemId)
  )
  if (fearGreedItemIds.size === 0) {
    return false
  }

  const fearGreedImpactIds = new Set(
    input.pipeline
      .listImpacts()
      .filter((impact) => {
        const item = input.pipeline.listItems().find((entry) => entry.itemId === impact.itemId)
        return item?.sourceId === FEAR_GREED_SOURCE_ID
      })
      .map((impact) => impact.impactId)
  )

  return input.effectiveRows.some((row) => {
    if (row.supportingItemIds.some((itemId) => fearGreedItemIds.has(itemId))) {
      return true
    }

    const aggregate = input.pipeline
      .listSentimentAggregates()
      .find((entry) => entry.aggregateId === row.aggregateId)
    if (!aggregate?.supportingImpactIdsJson) return false

    try {
      const impactIds = JSON.parse(aggregate.supportingImpactIdsJson) as string[]
      return impactIds.some((impactId) => fearGreedImpactIds.has(impactId))
    } catch {
      return false
    }
  })
}

function findLatestFearGreedMetric(metrics: MetricIntelligenceEvent[]): MetricIntelligenceEvent | undefined {
  return metrics
    .filter((metric) => metric.sourceId === FEAR_GREED_SOURCE_ID || metric.metricKey === 'FEAR_GREED_INDEX')
    .sort((left, right) => right.releaseTime.localeCompare(left.releaseTime))[0]
}

function parseFearGreedClassification(metric?: MetricIntelligenceEvent): string | undefined {
  if (!metric?.rawValueJson) return undefined
  try {
    const parsed = JSON.parse(metric.rawValueJson) as { classification?: string }
    return parsed.classification
  } catch {
    return undefined
  }
}

export function resolveFearGreedBucket(score: number): IntelligenceFearGreedBucket {
  if (score <= 24) return 'extreme-fear'
  if (score <= 49) return 'fear'
  if (score === 50) return 'neutral'
  if (score <= 74) return 'greed'
  return 'extreme-greed'
}

function resolveLayerCollectionState(
  enabledRunnable: IntelligenceLayerDeskSourceRow[]
): IntelligenceLayerDeskColumn['collectionState'] {
  if (enabledRunnable.length === 0) return 'none-enabled'
  if (enabledRunnable.some((source) => source.runtimeStatus === 'failed')) return 'failed'
  if (enabledRunnable.some((source) => source.runtimeStatus === 'pending')) return 'pending'
  if (enabledRunnable.some((source) => source.runtimeStatus === 'degraded')) return 'degraded'
  if (enabledRunnable.every((source) => source.runtimeStatus === 'paused')) return 'paused'
  return 'healthy'
}
