export type IntelligenceLayer =
  | 'macro'
  | 'industry'
  | 'asset'
  | 'exchange'
  | 'project'
  | 'infrastructure'

export type IntelligenceDataDomain =
  | 'macro'
  | 'crypto-market'
  | 'asset-market'
  | 'exchange'
  | 'project'

export type IntelligenceReliabilityTier =
  | 'official'
  | 'exchange-api'
  | 'aggregator'
  | 'page-extract'
  | 'community'

export type IntelligenceEventFamily = 'text-event' | 'metric-event' | 'mixed'

export type IntelligenceImpactScopeType =
  | 'market-wide'
  | 'risk-assets'
  | 'crypto-market'
  | 'sector'
  | 'symbol'
  | 'watchlist'
  | 'active-position'
  | 'exchange'

export type IntelligenceImpactDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type IntelligenceImpactHorizon = 'intraday' | '1d' | '1w' | '1m'
