export type IntelligenceSourceGroup =
  | 'exchange-announcement'
  | 'exchange-status'
  | 'official-source'
  | 'mainstream-news'
  | 'macro-regulation'
  | 'aggregate-data-provider'

export type IntelligenceScopePolicy = 'all' | 'watchlist-priority' | 'active-position-priority'

export type IntelligenceSourceAdapterType =
  | 'html-page-poller'
  | 'rss-poller'
  | 'rest-api-poller'
  | 'statuspage-poller'
  | 'websocket-stream-consumer'

export type IntelligenceExecutionMode = 'polling' | 'websocket'

export type IntelligenceCollectionPreset = 'manual' | 'balanced' | 'frequent'

export type IntelligenceRetentionMode = 'compact' | 'balanced' | 'extended'

export type IntelligenceSourceCategory =
  | 'exchange-announcement'
  | 'exchange-status'
  | 'official-post'
  | 'mainstream-news'
  | 'macro'
  | 'regulation'

export type IntelligenceTrustLevel = 'high' | 'medium' | 'low'

export type IntelligenceSourceReadiness = 'live' | 'fixture-ready' | 'planned'

export type IntelligenceFocusMarket =
  | 'global-macro'
  | 'digital-assets'
  | 'cn-a-shares'
  | 'us-equities'
  | 'china-futures'
  | 'fx'
  | 'commodities'

export type IntelligenceSourceKind =
  | 'official-macro'
  | 'official-regulator'
  | 'exchange-announcement'
  | 'market-media'
  | 'metric-aggregator'
  | 'data-aggregator'
  | 'project-official'
  | 'social-sentiment'
  | 'mixed-news-hub'

export type IntelligenceApplicabilityMode =
  | 'global'
  | 'market-domain'
  | 'multi-market'
  | 'venue'
  | 'instrument'
  | 'dynamic-detected'

export type IntelligenceSourceApplicability = {
  sourceKind: IntelligenceSourceKind
  applicabilityMode: IntelligenceApplicabilityMode
  focusMarkets: IntelligenceFocusMarket[]
  venueScopes?: string[]
  instrumentScopes?: string[]
  dynamicClassification?: boolean
}

export type {
  IntelligenceDataDomain,
  IntelligenceEventFamily,
  IntelligenceImpactScopeType,
  IntelligenceLayer,
  IntelligenceReliabilityTier
} from './intelligenceLayer'
import type {
  IntelligenceDataDomain,
  IntelligenceEventFamily,
  IntelligenceImpactScopeType,
  IntelligenceLayer,
  IntelligenceReliabilityTier
} from './intelligenceLayer'

export type IntelligenceAuthMode = 'none' | 'api-key' | 'optional-api-key'

/**
 * Who collects this source in production.
 *
 * - `adapter` (default): the generic source runtime schedules the registered adapter.
 * - `product`: a product-owned job/runtime collects it, so the reader's enable preference is stored
 *   on the profile for that runtime to read while the generic runtime still never schedules it.
 */
export type IntelligenceCollectionOwner = 'adapter' | 'product'

export type SourceRequestGovernancePolicy = {
  providerId: string
  quotaScope: 'source' | 'api-key'
  rollingWindow: {
    maxRequests: number
    windowMs: number
  }
  queue: {
    ordering: 'fifo'
    maxPending: number
    maxWaitMs: number
  }
  settingVisibility: 'visible' | 'hidden'
}

export function sourceSupportsCredentials(authMode: IntelligenceAuthMode): boolean {
  return authMode === 'api-key' || authMode === 'optional-api-key'
}

export function sourceRequiresCredential(authMode: IntelligenceAuthMode): boolean {
  return authMode === 'api-key'
}

export type IntelligenceSourceDefinition = {
  sourceId: string
  displayName: string
  sourceGroup: IntelligenceSourceGroup
  adapterType: IntelligenceSourceAdapterType
  executionMode: IntelligenceExecutionMode
  authMode: IntelligenceAuthMode
  category: IntelligenceSourceCategory
  trustLevel: IntelligenceTrustLevel
  language: string
  defaultCollectionPreset: IntelligenceCollectionPreset
  defaultRetentionMode: IntelligenceRetentionMode
  defaultScopePolicy: IntelligenceScopePolicy
  supportsSentiment: boolean
  supportsCredentialTest: boolean
  supportsRunNow: boolean
  supportsReplay: boolean
  collectionOwner: IntelligenceCollectionOwner
  sourceSpecificFields: string[]
  visibility: 'visible' | 'hidden'
  parserStrategy: string
  adapterConfig: Record<string, unknown>
  intelligenceLayer?: IntelligenceLayer
  dataDomain?: IntelligenceDataDomain
  reliabilityTier?: IntelligenceReliabilityTier
  eventFamily?: IntelligenceEventFamily
  supportedImpactScopes?: IntelligenceImpactScopeType[]
  readiness?: IntelligenceSourceReadiness
  readinessNote?: string
  sourceKind: IntelligenceSourceKind
  applicabilityMode: IntelligenceApplicabilityMode
  focusMarkets: IntelligenceFocusMarket[]
  venueScopes?: string[]
  instrumentScopes?: string[]
  dynamicClassification?: boolean
  requestGovernance?: SourceRequestGovernancePolicy
}

export type IntelligenceSourceCatalogEntry = Omit<
  IntelligenceSourceDefinition,
  'sourceKind' | 'applicabilityMode' | 'focusMarkets' | 'venueScopes' | 'instrumentScopes' | 'dynamicClassification'
> &
  Partial<IntelligenceSourceApplicability>

export type IntelligenceSourceProfile = {
  profileId: string
  sourceId: string
  enabled: boolean
  credentialRef?: string
  collectionPreset: IntelligenceCollectionPreset
  includeInSentiment: boolean
  scopePolicy: IntelligenceScopePolicy
  rawArchiveEnabled: boolean
  retentionMode: IntelligenceRetentionMode
  autoReplayAfterParserUpgrade: boolean
  monitoredSymbols?: string[]
  sourceSpecificConfigJson?: string
  updatedAt: string
}

export type IntelligenceDesiredRuntimeState = 'polling' | 'live' | 'paused'

export type IntelligenceSourceConfig = {
  sourceId: string
  sourceName: string
  sourceGroup: IntelligenceSourceGroup
  adapterType: IntelligenceSourceAdapterType
  executionMode: IntelligenceExecutionMode
  enabled: boolean
  credentialRef?: string
  category: IntelligenceSourceCategory
  trustLevel: IntelligenceTrustLevel
  language: string
  collectionPreset: IntelligenceCollectionPreset
  pollingIntervalSec?: number
  desiredRuntimeState: IntelligenceDesiredRuntimeState
  parserStrategy: string
  noisePolicy: 'strict' | 'balanced'
  includeInSentiment: boolean
  scopePolicy: IntelligenceScopePolicy
  rawArchiveEnabled: boolean
  retentionMode: IntelligenceRetentionMode
  autoReplayAfterParserUpgrade: boolean
  sentimentEligible: boolean
  adapterConfig: Record<string, unknown>
}

export type IntelligenceRuntimeValidationIssue = {
  code: string
  message: string
  field?: string
}
