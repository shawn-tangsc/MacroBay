export type SourceRelevanceOutcome = 'ignore' | 'context-only' | 'full-intelligence'

export type SourceClassifierCaveat =
  | 'low-classifier-confidence'
  | 'asset-scope-fallback'
  | 'proxy-metric'
  | 'contrarian-metric'
  | 'generic-source-parser'

export type IntelligenceIgnoredReasonCode =
  | 'focus-market-disabled'
  | 'scope-not-matched'
  | 'classification-confidence-low'
  | 'duplicate-known-item'
  | 'noise-policy-filtered'
  | 'payload-too-large'
  | 'parser-unsupported-shape'
  | 'source-not-implemented'

export type ClassifiedSourceEvent = {
  outcome: SourceRelevanceOutcome
  eventSubtype: string
  confidence: number
  entities?: string[]
  symbols?: string[]
  affectedScopes: Array<{ type: string; id: string }>
  sentimentEligible: boolean
  impactHint?: {
    direction?: 'bullish' | 'bearish' | 'neutral' | 'mixed'
    reasonCode?: string
    horizon?: 'intraday' | '1d' | '1w' | '1m'
  }
  ignoredReasonCode?: IntelligenceIgnoredReasonCode
  caveats: SourceClassifierCaveat[]
}

export type SourceClassifierInput = {
  sourceId: string
  title: string
  summary?: string
  bodyText?: string
  eventType?: string
  metricKey?: string
  metricKind?: string
  metricActual?: number
  metricPrevious?: number
  comparisonBasis?: string
  incidentStatus?: string
  venue?: string
  symbols?: string[]
}
