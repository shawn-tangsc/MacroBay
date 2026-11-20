/**
 * 目录条目的构造器：补默认值（层/域/可信度/事件族/影响范围/就绪度），再附着适用范围。
 *
 * 从 `sourceCatalog.ts` 拆出来，因为两组条目文件都要用它；它不含任何条目数据。
 */
import type { IntelligenceSourceCatalogEntry, IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import { attachSourceApplicability } from './sourceCatalogApplicability'
import { defaultEventFamily, defaultImpactScopes, inferDataDomain, inferIntelligenceLayer, inferReliabilityTier } from './sourceCatalogMetadata'

export function source(
  input: Partial<IntelligenceSourceCatalogEntry> &
    Pick<
      IntelligenceSourceCatalogEntry,
      'sourceId' | 'displayName' | 'sourceGroup' | 'adapterType' | 'category' | 'parserStrategy' | 'adapterConfig'
    >
): IntelligenceSourceDefinition {
  const intelligenceLayer = input.intelligenceLayer ?? inferIntelligenceLayer(input.sourceGroup, input.category)
  const dataDomain = input.dataDomain ?? inferDataDomain(input.category)
  const reliabilityTier = input.reliabilityTier ?? inferReliabilityTier(input.adapterType)
  const eventFamily = defaultEventFamily(input.eventFamily, input.adapterType)
  const supportedImpactScopes = input.supportedImpactScopes ?? defaultImpactScopes(intelligenceLayer)
  const readiness = input.readiness ?? 'live'
  const supportsRunNow =
    readiness === 'planned' || readiness === 'fixture-ready' ? false : (input.supportsRunNow ?? true)

  return attachSourceApplicability({
    executionMode: 'polling',
    authMode: 'none',
    trustLevel: 'high',
    language: 'en',
    defaultCollectionPreset: 'balanced',
    defaultRetentionMode: 'balanced',
    defaultScopePolicy: 'watchlist-priority',
    supportsSentiment: true,
    supportsRunNow,
    supportsReplay: true,
    collectionOwner: 'adapter',
    sourceSpecificFields: [],
    visibility: 'visible',
    ...input,
    intelligenceLayer,
    dataDomain,
    reliabilityTier,
    eventFamily,
    supportedImpactScopes,
    readiness,
    readinessNote: input.readinessNote
  })
}
