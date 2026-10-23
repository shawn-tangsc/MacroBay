export type IntelligenceSentimentScope =
  | 'market-wide'
  | 'risk-assets'
  | 'crypto-market'
  | 'sector'
  | 'symbol'
  | 'watchlist'
  | 'active-position'
  | 'exchange'

export type IntelligenceSentimentHorizon = '15m' | '1h' | '4h' | '24h'

export type IntelligenceSentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed'

export type { IntelligenceImpactDirection, IntelligenceLayer } from './intelligenceLayer'
import type { IntelligenceImpactDirection, IntelligenceLayer } from './intelligenceLayer'

export type IntelligenceSentimentSignal = {
  signalId: string
  itemId: string
  clusterId?: string
  assessmentId?: string
  effectiveRevisionId?: string
  scopeType: IntelligenceSentimentScope
  scopeKey: string
  horizon: IntelligenceSentimentHorizon
  sourceGroup: string
  sentimentScore: number
  sentimentLabel: IntelligenceSentimentLabel
  confidence?: number
  weight?: number
  createdAt: string
  signalVersion: string
}

export type IntelligenceSentimentAggregate = {
  aggregateId: string
  scopeType: IntelligenceSentimentScope
  scopeKey: string
  horizon: IntelligenceSentimentHorizon
  aggregateScore: number
  aggregateLabel: IntelligenceSentimentLabel
  confidence?: number
  signalCount: number
  supportingItemIdsJson: string
  sourceGroupBreakdownJson?: string
  supportingClusterIdsJson?: string
  layerBreakdownJson?: string
  directionBreakdownJson?: string
  supportingImpactIdsJson?: string
  updatedAt: string
  aggregateVersion: string
}

export type SentimentSignalInput = {
  signalId: string
  itemId: string
  clusterId?: string
  assessmentId?: string
  impactId?: string
  effectiveRevisionId?: string
  scopeType: IntelligenceSentimentScope
  scopeKey: string
  horizon: IntelligenceSentimentHorizon
  sourceGroup: string
  sentimentLabel: IntelligenceSentimentLabel
  strength?: number
  confidence?: number
  trustLevel: 'high' | 'medium' | 'low'
  layer?: IntelligenceLayer
  direction?: IntelligenceImpactDirection
  magnitude?: number
  reasoning?: string
  evidenceJson?: string
  createdAt: string
}

export const TRUST_WEIGHTS: Record<'high' | 'medium' | 'low', number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.4
}

export const SCOPE_WEIGHTS: Record<IntelligenceSentimentScope, number> = {
  'active-position': 1.0,
  watchlist: 0.85,
  symbol: 0.8,
  sector: 0.6,
  'crypto-market': 0.75,
  'risk-assets': 0.7,
  'market-wide': 0.7,
  exchange: 0.75
}

export const LAYER_WEIGHTS: Record<IntelligenceLayer, number> = {
  macro: 1.0,
  industry: 0.8,
  asset: 0.9,
  exchange: 0.7,
  project: 0.8,
  infrastructure: 0.7
}

export const LABEL_BASE_SCORE: Record<IntelligenceSentimentLabel, number> = {
  positive: 1,
  neutral: 0,
  mixed: 0,
  negative: -1
}

export const HORIZON_MS: Record<IntelligenceSentimentHorizon, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000
}
