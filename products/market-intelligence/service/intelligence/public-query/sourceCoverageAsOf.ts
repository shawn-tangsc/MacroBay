import type { RuntimeStateRecord } from '@platform/jobs'

import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  type MarketIntelligenceQueryCaveat,
  type SourceCoverageAsOf
} from './queryContracts'
import { compareIsoTime, isVisibleAsOf, VISIBLE_AT } from './asOfVisibility'
import { isSourceStaleAsOf } from '../application/macroSourceHealth'
import { isDefillamaStablecoinRetiredPath } from '../application/sourceCatalog'

const DEFAULT_FRESHNESS_MS = 6 * 60 * 60 * 1000

export type SourceCoverageInput = {
  definitions: IntelligenceSourceDefinition[]
  runtimeStates: RuntimeStateRecord[]
  items: IntelligenceItem[]
  asOf: string
  enabledSourceIds?: Set<string>
  includedSourceIds?: Set<string>
}

export function buildSourceCoverageAsOf(input: SourceCoverageInput): SourceCoverageAsOf[] {
  const statesBySource = new Map<string, RuntimeStateRecord>()
  for (const state of input.runtimeStates) {
    if (state.resourceId) {
      statesBySource.set(state.resourceId, state)
    }
  }

  return input.definitions
    .filter((definition) => !isDefillamaStablecoinRetiredPath(definition.sourceId))
    .map((definition) =>
      buildOneSourceCoverage({
        definition,
        state: statesBySource.get(definition.sourceId),
        items: input.items,
        asOf: input.asOf,
        enabled: input.enabledSourceIds ? input.enabledSourceIds.has(definition.sourceId) : true,
        includedInResult: input.includedSourceIds ? input.includedSourceIds.has(definition.sourceId) : false
      })
    )
}

function buildOneSourceCoverage(input: {
  definition: IntelligenceSourceDefinition
  state?: RuntimeStateRecord
  items: IntelligenceItem[]
  asOf: string
  enabled: boolean
  includedInResult: boolean
}): SourceCoverageAsOf {
  const caveats: MarketIntelligenceQueryCaveat[] = []
  const readiness = input.definition.readiness ?? 'live'
  const visibleItems = input.items.filter(
    (item) =>
      item.sourceId === input.definition.sourceId &&
      isVisibleAsOf(VISIBLE_AT.item(item), input.asOf)
  )
  const latestVisibleItemAt = visibleItems
    .map((item) => item.detectedAt)
    .sort((left, right) => compareIsoTime(right, left))[0]

  const lastSuccessAt =
    input.state?.lastSuccessAt && isVisibleAsOf(input.state.lastSuccessAt, input.asOf)
      ? input.state.lastSuccessAt
      : undefined
  const lastFailureAt =
    input.state?.lastFailureAt && isVisibleAsOf(input.state.lastFailureAt, input.asOf)
      ? input.state.lastFailureAt
      : undefined

  if (input.state?.updatedAt && !isVisibleAsOf(input.state.updatedAt, input.asOf)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceStale)
  }

  let productionState: SourceCoverageAsOf['productionState'] = 'unknown'
  if (readiness === 'planned') {
    productionState = 'planned'
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.plannedSourceUnavailable)
  } else if (readiness === 'fixture-ready') {
    productionState = 'fixture-only'
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.fixtureOnlySourceExcluded)
  } else if (!input.enabled) {
    productionState = 'disabled'
  } else if (lastFailureAt && (!lastSuccessAt || compareIsoTime(lastFailureAt, lastSuccessAt) > 0)) {
    productionState = 'failed'
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceFailedBeforeAsOf)
  } else if (!lastSuccessAt) {
    productionState = 'pending'
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourcePendingFirstCollection)
  } else if (
    isSourceStaleAsOf({
      sourceId: input.definition.sourceId,
      adapterConfig: input.definition.adapterConfig,
      lastSuccessAt,
      asOf: input.asOf,
      defaultFreshnessMs: DEFAULT_FRESHNESS_MS
    })
  ) {
    productionState = 'stale'
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.sourceStale)
  } else {
    productionState = 'fresh'
  }

  const confidence = productionState === 'fresh' ? 0.9 : productionState === 'stale' ? 0.5 : 0.2

  return {
    sourceId: input.definition.sourceId,
    sourceKind: input.definition.sourceKind ?? input.definition.sourceGroup,
    layer: input.definition.intelligenceLayer ?? 'industry',
    focusMarkets: [...(input.definition.focusMarkets ?? [])],
    readiness,
    productionState,
    includedInResult: input.includedInResult,
    latestSuccessAt: lastSuccessAt,
    latestFailureAt: lastFailureAt,
    latestVisibleItemAt,
    confidence,
    caveats: [...new Set(caveats)]
  }
}

export function summarizeSourceCoverage(sources: SourceCoverageAsOf[]): {
  freshCount: number
  staleCount: number
  failedCount: number
  pendingCount: number
  fixtureOnlyCount: number
  plannedCount: number
} {
  return {
    freshCount: sources.filter((source) => source.productionState === 'fresh').length,
    staleCount: sources.filter((source) => source.productionState === 'stale').length,
    failedCount: sources.filter((source) => source.productionState === 'failed').length,
    pendingCount: sources.filter((source) => source.productionState === 'pending').length,
    fixtureOnlyCount: sources.filter((source) => source.productionState === 'fixture-only').length,
    plannedCount: sources.filter((source) => source.productionState === 'planned').length
  }
}
