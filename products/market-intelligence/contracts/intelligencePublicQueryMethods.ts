/**
 * Stable Market Intelligence public query IPC method ids.
 * Cross-product service consumers must use these ids with product IPC invoke.
 */

export const INTELLIGENCE_PUBLIC_QUERY_METHODS = {
  querySentimentSnapshot: 'intelligence.querySentimentSnapshot',
  querySentimentSeries: 'intelligence.querySentimentSeries',
  queryRelatedEvents: 'intelligence.queryRelatedEvents',
  queryImpactTimeline: 'intelligence.queryImpactTimeline',
  queryFearGreedSnapshot: 'intelligence.queryFearGreedSnapshot',
  queryFundingRateHistory: 'intelligence.queryFundingRateHistory',
  queryOpenInterestHistory: 'intelligence.queryOpenInterestHistory',
  queryCapitalConditionsSnapshot: 'intelligence.queryCapitalConditionsSnapshot',
  getSourceHealth: 'intelligence.getSourceHealth',
  getEvidenceExcerpt: 'intelligence.getEvidenceExcerpt'
} as const

export type IntelligencePublicQueryMethod =
  (typeof INTELLIGENCE_PUBLIC_QUERY_METHODS)[keyof typeof INTELLIGENCE_PUBLIC_QUERY_METHODS]
