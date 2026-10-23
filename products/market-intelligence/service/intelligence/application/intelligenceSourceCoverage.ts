import type { IntelligenceLayer } from '../schema/intelligenceLayer'
import type {
  IntelligenceFocusMarket,
  IntelligenceSourceProfile,
  IntelligenceSourceReadiness
} from '../schema/intelligenceSource'
import { resolveSourceFreshnessStatus } from '../schema/intelligenceSourcesContracts'
import { isDefillamaStablecoinRetiredPath, listIntelligenceSourceDefinitions } from './sourceCatalog'
import { isSourceApplicableToFocusMarkets } from './intelligenceSourceApplicability'
import { resolveMacroFreshnessWindowMs } from './macroSourceHealth'
import type { IntelligencePipeline } from './intelligencePipeline'
import { V2_REQUIRED_LIVE_SOURCE_IDS } from './v2RequiredSources'

export type IntelligenceSourceProductionState =
  | 'fresh'
  | 'stale'
  | 'pending'
  | 'failed'
  | 'disabled'
  | 'fixture-only'
  | 'planned'

export type IntelligenceSourceCoverageAction =
  | 'open-settings'
  | 'open-runtime'
  | 'run-now'
  | 'replay-fixture'
  | 'none'

export type IntelligenceSourceCoverageView = {
  sourceId: string
  sourceName: string
  layer: IntelligenceLayer
  readiness: IntelligenceSourceReadiness
  v2Required: boolean
  productionState: IntelligenceSourceProductionState
  enabled: boolean
  latestSuccessAt?: string
  latestFailureAt?: string
  latestItemCount: number
  latestImpactCount: number
  focusMarketActive: boolean
  action: IntelligenceSourceCoverageAction
}

const STALE_AFTER_SECONDS: Record<string, number> = {
  'alternative-fear-greed': 36 * 60 * 60,
  'binance-spot-market': 60 * 60,
  'binance-futures-positioning': 8 * 60 * 60,
  'binance-announcements': 2 * 60 * 60,
  'coindesk-rss': 6 * 60 * 60,
  'federal-reserve-rss': 12 * 60 * 60,
  'sec-rss': 6 * 60 * 60,
  'cftc-rss': 6 * 60 * 60,
  'defillama-stablecoins': 6 * 60 * 60,
  'defillama-tvl': 6 * 60 * 60
}

export function buildSourceCoverage(input: {
  profileById: Map<string, IntelligenceSourceProfile>
  pipeline: IntelligencePipeline
  enabledFocusMarkets?: IntelligenceFocusMarket[]
}): IntelligenceSourceCoverageView[] {
  const items = input.pipeline.listItems()
  const impacts = input.pipeline.listImpacts()
  const itemCountBySource = countByKey(items, (item) => item.sourceId)
  const impactCountBySource = countImpactsBySource(items, impacts)
  const enabledFocusMarkets = input.enabledFocusMarkets

  return listIntelligenceSourceDefinitions()
    .filter((definition) => definition.visibility !== 'hidden')
    .filter((definition) => !isDefillamaStablecoinRetiredPath(definition.sourceId))
    .map((definition) => {
      const profile = input.profileById.get(definition.sourceId)
      const enabled = profile?.enabled ?? false
      const health = input.pipeline.getHealth(definition.sourceId)
      const readiness = definition.readiness ?? 'live'
      const runtimeStatus = resolveSourceFreshnessStatus(enabled, health)
      const focusMarketActive =
        !enabledFocusMarkets || isSourceApplicableToFocusMarkets(definition, enabledFocusMarkets)

      return {
        sourceId: definition.sourceId,
        sourceName: definition.displayName,
        layer: definition.intelligenceLayer ?? 'industry',
        readiness,
        v2Required: V2_REQUIRED_LIVE_SOURCE_IDS.includes(
          definition.sourceId as (typeof V2_REQUIRED_LIVE_SOURCE_IDS)[number]
        ),
        productionState: resolveProductionState({
          sourceId: definition.sourceId,
          adapterConfig: definition.adapterConfig,
          readiness,
          enabled,
          runtimeStatus,
          latestSuccessAt: health?.lastSuccessAt
        }),
        enabled,
        latestSuccessAt: health?.lastSuccessAt,
        latestFailureAt: health?.lastFailureAt,
        latestItemCount: itemCountBySource.get(definition.sourceId) ?? 0,
        latestImpactCount: impactCountBySource.get(definition.sourceId) ?? 0,
        focusMarketActive,
        action: resolveCoverageAction({ readiness, enabled, runtimeStatus })
      }
    })
    .filter((row) => row.focusMarketActive)
    .sort(
      (left, right) =>
        Number(right.v2Required) - Number(left.v2Required) || left.sourceName.localeCompare(right.sourceName)
    )
}

function resolveProductionState(input: {
  sourceId: string
  adapterConfig: Record<string, unknown>
  readiness: IntelligenceSourceReadiness
  enabled: boolean
  runtimeStatus: ReturnType<typeof resolveSourceFreshnessStatus>
  latestSuccessAt?: string
}): IntelligenceSourceProductionState {
  if (input.readiness === 'planned') return 'planned'
  if (input.readiness === 'fixture-ready') return 'fixture-only'
  if (!input.enabled) return 'disabled'
  if (input.runtimeStatus === 'failed') return 'failed'
  if (input.runtimeStatus === 'pending' || !input.latestSuccessAt) return 'pending'
  if (input.runtimeStatus === 'degraded') return 'stale'

  const staleAfterSeconds = resolveStaleAfterSeconds(input.sourceId, input.adapterConfig)
  if (staleAfterSeconds && input.latestSuccessAt) {
    const ageMs = Date.now() - new Date(input.latestSuccessAt).getTime()
    if (ageMs > staleAfterSeconds * 1000) return 'stale'
  }

  return 'fresh'
}

function resolveStaleAfterSeconds(sourceId: string, adapterConfig: Record<string, unknown>): number {
  const macroMs = resolveMacroFreshnessWindowMs(sourceId, adapterConfig)
  if (macroMs) return Math.floor(macroMs / 1000)
  return STALE_AFTER_SECONDS[sourceId] ?? 6 * 60 * 60
}

function resolveCoverageAction(input: {
  readiness: IntelligenceSourceReadiness
  enabled: boolean
  runtimeStatus: ReturnType<typeof resolveSourceFreshnessStatus>
}): IntelligenceSourceCoverageAction {
  if (input.readiness === 'planned') return 'none'
  if (input.readiness === 'fixture-ready') return 'replay-fixture'
  if (!input.enabled) return 'open-settings'
  if (input.runtimeStatus === 'failed' || input.runtimeStatus === 'pending') return 'open-runtime'
  return 'run-now'
}

function countByKey<T>(rows: T[], pickKey: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = pickKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function countImpactsBySource(
  items: ReturnType<IntelligencePipeline['listItems']>,
  impacts: ReturnType<IntelligencePipeline['listImpacts']>
): Map<string, number> {
  const itemSourceById = new Map(items.map((item) => [item.itemId, item.sourceId]))
  const counts = new Map<string, number>()
  for (const impact of impacts) {
    const sourceId = itemSourceById.get(impact.itemId)
    if (!sourceId) continue
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }
  return counts
}
