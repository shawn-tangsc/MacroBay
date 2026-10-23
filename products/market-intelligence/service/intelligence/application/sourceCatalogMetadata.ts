import type {
  IntelligenceDataDomain,
  IntelligenceEventFamily,
  IntelligenceImpactScopeType,
  IntelligenceLayer,
  IntelligenceReliabilityTier
} from '../schema/intelligenceLayer'
import type {
  IntelligenceSourceAdapterType,
  IntelligenceSourceCategory,
  IntelligenceSourceGroup
} from '../schema/intelligenceSource'

export function inferIntelligenceLayer(
  sourceGroup: IntelligenceSourceGroup,
  category: IntelligenceSourceCategory
): IntelligenceLayer {
  if (category === 'macro') return 'macro'
  if (category === 'regulation') return 'industry'
  if (category === 'exchange-status') return 'exchange'
  if (category === 'exchange-announcement') return 'asset'
  if (sourceGroup === 'official-source') return 'project'
  if (sourceGroup === 'macro-regulation') return 'industry'
  return 'industry'
}

export function inferDataDomain(category: IntelligenceSourceCategory): IntelligenceDataDomain {
  switch (category) {
    case 'macro':
      return 'macro'
    case 'exchange-announcement':
    case 'exchange-status':
      return 'exchange'
    case 'official-post':
      return 'project'
    default:
      return 'crypto-market'
  }
}

export function inferReliabilityTier(adapterType: IntelligenceSourceAdapterType): IntelligenceReliabilityTier {
  switch (adapterType) {
    case 'html-page-poller':
      return 'page-extract'
    case 'rest-api-poller':
      return 'exchange-api'
    case 'rss-poller':
      return 'official'
    case 'statuspage-poller':
      return 'official'
    default:
      return 'aggregator'
  }
}

export function defaultImpactScopes(layer: IntelligenceLayer): IntelligenceImpactScopeType[] {
  switch (layer) {
    case 'macro':
      return ['risk-assets', 'crypto-market', 'symbol']
    case 'industry':
      return ['crypto-market', 'sector']
    case 'asset':
      return ['symbol', 'watchlist']
    default:
      return ['market-wide']
  }
}

export function defaultEventFamily(
  eventFamily: IntelligenceEventFamily | undefined,
  adapterType: IntelligenceSourceAdapterType
): IntelligenceEventFamily {
  if (eventFamily) return eventFamily
  if (adapterType === 'rest-api-poller') return 'metric-event'
  return 'text-event'
}
