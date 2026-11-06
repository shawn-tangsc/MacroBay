/**
 * Public Market Intelligence query contracts.
 * Cross-product consumers must import from this module only.
 */

export const MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION = 1

export const MARKET_INTELLIGENCE_QUERY_TYPES = {
  sentimentSnapshot: 'query_sentiment_snapshot',
  sentimentSeries: 'query_sentiment_series',
  relatedEvents: 'query_related_events',
  impactTimeline: 'query_impact_timeline',
  sourceHealth: 'get_source_health',
  evidenceExcerpt: 'get_evidence_excerpt',
  fearGreedSnapshot: 'query_fear_greed_snapshot',
  fundingRateHistory: 'query_funding_rate_history',
  capitalConditionsSnapshot: 'query_capital_conditions_snapshot'
} as const

export type MarketIntelligenceQueryType =
  (typeof MARKET_INTELLIGENCE_QUERY_TYPES)[keyof typeof MARKET_INTELLIGENCE_QUERY_TYPES]

export const MARKET_INTELLIGENCE_QUERY_CAVEATS = {
  insufficientSourceCoverage: 'insufficient-source-coverage',
  sourceStale: 'source-stale',
  sourceFailedBeforeAsOf: 'source-failed-before-as-of',
  sourcePendingFirstCollection: 'source-pending-first-collection',
  sentimentNotComputedAsOf: 'sentiment-not-computed-as-of',
  impactNotComputedAsOf: 'impact-not-computed-as-of',
  eventDetectedAfterActionTime: 'event-detected-after-action-time',
  lowConfidenceAggregation: 'low-confidence-aggregation',
  fixtureOnlySourceExcluded: 'fixture-only-source-excluded',
  plannedSourceUnavailable: 'planned-source-unavailable',
  /**
   * A source whose only granularity is an official daily close. FRED's rate series are one
   * observation per trading day, so a conclusion may use them for a level and a day-over-day change
   * but never to explain an intraday move.
   */
  officialDailyClose: 'official-daily-close',
  scopeResolvedByAssetFallback: 'scope-resolved-by-asset-fallback',
  explicitWindowOverrodeLookback: 'explicit-window-overrode-lookback',
  maxItemsTruncated: 'max-items-truncated',
  evidenceNotVisibleAsOf: 'evidence-not-visible-as-of',
  invalidVisibleTimestamp: 'invalid-visible-timestamp'
} as const

export type MarketIntelligenceQueryCaveat =
  (typeof MARKET_INTELLIGENCE_QUERY_CAVEATS)[keyof typeof MARKET_INTELLIGENCE_QUERY_CAVEATS]

export type MarketIntelligenceQueryScope = {
  canonicalInstrumentId?: string
  venue?: string
  symbol?: string
  asset?: string
  sector?: string
  market?: string
}

export type MarketIntelligenceQueryFilters = {
  layers?: Array<'macro' | 'industry' | 'asset' | 'exchange' | 'project' | 'infrastructure'>
  sourceIds?: string[]
  directions?: Array<'bullish' | 'bearish' | 'neutral' | 'mixed'>
  minConfidence?: number
  horizon?: '15m' | '1h' | '4h' | '24h'
}

export type MarketIntelligenceTimeBoundQueryInput = {
  asOf: string
  from?: string
  to?: string
  lookbackWindowMs?: number
  maxItems?: number
  scope?: MarketIntelligenceQueryScope
  filters?: MarketIntelligenceQueryFilters
}

export type EvidenceExcerptQueryInput = {
  asOf: string
  evidenceRefId?: string
  itemId?: string
  impactId?: string
  clusterId?: string
  maxExcerptChars?: number
}

export type FearGreedSnapshotQueryInput = {
  asOf: string
}

export type FearGreedSnapshotBucket = 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed'

export type FearGreedSnapshotResult =
  | { state: 'available'; asOf: string; score: number; bucket: FearGreedSnapshotBucket; observedAt: string }
  | { state: 'empty'; asOf: string }
  | { state: 'unavailable'; failureCode: 'fear-greed-query-unavailable' }

export const fearGreedSnapshotPolicy = {
  sourceId: 'alternative-fear-greed',
  metricKey: 'FEAR_GREED_INDEX',
  score: { minimum: 0, maximum: 100, integer: true },
  /**
   * The band a score falls in, with the tone that band prints in.
   *
   * One row per band: the range, its key and its colour. Giving the colour a table of its own is how a
   * threshold moves in one and not the other, and a reader sees 恐惧 painted green.
   */
  buckets: [
    { maximum: 24, key: 'extreme-fear', tone: 'down' },
    { maximum: 49, key: 'fear', tone: 'down' },
    { maximum: 50, key: 'neutral', tone: 'flat' },
    { maximum: 74, key: 'greed', tone: 'up' },
    { maximum: 100, key: 'extreme-greed', tone: 'up' }
  ] as const,
  unavailableFailureCode: 'fear-greed-query-unavailable',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export function isCanonicalFearGreedSnapshotTime(value: unknown): value is string {
  if (typeof value !== 'string' || !fearGreedSnapshotPolicy.canonicalUtcMillisPattern.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

export function isFearGreedSnapshotScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= fearGreedSnapshotPolicy.score.minimum && value <= fearGreedSnapshotPolicy.score.maximum
}

export function resolveFearGreedSnapshotBucket(value: unknown): FearGreedSnapshotBucket | undefined {
  if (!isFearGreedSnapshotScore(value)) return undefined
  return fearGreedSnapshotPolicy.buckets.find((bucket) => value <= bucket.maximum)?.key
}

/**
 * The tone a band prints in, read from the same row that answers which band it is.
 *
 * These hexes are the move colours, but here they colour a *judgement*, not a direction: 恐惧 red is not
 * "falling". The two meanings share a palette deliberately — one red, not a fifth — which is why the note
 * lives here and beside the CSS rule.
 */
export function fearGreedBucketTone(value: unknown): 'up' | 'down' | 'flat' | undefined {
  if (!isFearGreedSnapshotScore(value)) return undefined
  return fearGreedSnapshotPolicy.buckets.find((bucket) => value <= bucket.maximum)?.tone
}

export type FundingRateHistoryQueryInput = { asOf: string }
export type FundingRateHistoryPoint = Readonly<{ observedAt: string; ratePercent: number }>
export type FundingRateHistoryResult =
  | Readonly<{ state: 'available'; asOf: string; btc: readonly FundingRateHistoryPoint[]; eth: readonly FundingRateHistoryPoint[] }>
  | Readonly<{ state: 'empty'; asOf: string }>
  | Readonly<{ state: 'unavailable'; failureCode: 'funding-rate-history-query-unavailable' }>

export const fundingRateHistoryPolicy = Object.freeze({
  sourceId: 'binance-futures-positioning',
  maximumPointsPerAsset: 22,
  maximumDtoBytes: 8 * 1024,
  unavailableFailureCode: 'funding-rate-history-query-unavailable' as const,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export function isCanonicalFundingRateHistoryTime(value: unknown): value is string {
  if (typeof value !== 'string' || !fundingRateHistoryPolicy.canonicalUtcMillisPattern.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

export type {
  CapitalConditionsSnapshotQueryInput,
  CapitalConditionsSnapshotResult,
  EtfPublicAssetSnapshot,
  EtfPublicFlow,
  EtfPublicSnapshot
} from './capitalConditionsQueryTypes'

export function isFundingRateHistoryRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100
}

// The capital-conditions DTOs and their validators live in their own module since this barrel crossed
// its size budget; the public surface is unchanged, so consumers keep importing from here.
export {
  capitalConditionsDailyFlowPolicy,
  capitalConditionsSnapshotPolicy,
  etfPublicSnapshotPolicy,
  isCanonicalCapitalConditionsSnapshotTime,
  isCanonicalEtfPublicTime,
  isValidCapitalConditionsDailyFlows,
  isValidEtfPublicSnapshot,
  isVisibleEtfPublicSnapshot,
  isWithinCapitalConditionsSnapshotDtoBudget,
  isWithinEtfPublicSnapshotDtoBudget,
  toEtfPublicSnapshot
} from './capitalConditionsQueryContracts'
export { isWithinUtf8JsonBudget } from './queryDtoBudget'

export type SourceCoverageAsOf = {
  sourceId: string
  sourceKind: string
  layer: string
  focusMarkets: string[]
  readiness: 'live' | 'fixture-ready' | 'planned'
  productionState:
    | 'fresh'
    | 'stale'
    | 'pending'
    | 'failed'
    | 'disabled'
    | 'fixture-only'
    | 'planned'
    | 'unknown'
  includedInResult: boolean
  latestSuccessAt?: string
  latestFailureAt?: string
  latestVisibleItemAt?: string
  confidence: number
  caveats: MarketIntelligenceQueryCaveat[]
}

export type AgentSafeEvidenceRef = {
  evidenceRefId: string
  sourceId: string
  itemId?: string
  impactId?: string
  clusterId?: string
  schemaVersion: number
  occurredAt?: string
  publishedAt?: string
  detectedAt: string
  computedAt?: string
  visibleAt: string
  rendererSafeSummary: string
  excerptHash?: string
  /** The public page behind the evidence, when the projection knows one. Never model-facing. */
  sourceUrl?: string
  caveats: MarketIntelligenceQueryCaveat[]
}

export type SentimentSnapshotData = {
  status: 'available' | 'unknown'
  scopeType: string
  scopeKey: string
  horizon: '15m' | '1h' | '4h' | '24h'
  score?: number
  label?: 'positive' | 'negative' | 'neutral' | 'mixed'
  computedAt?: string
  supportingImpactCount: number
  supportingItemCount: number
  supportingClusterCount: number
  layerBreakdown?: Record<string, unknown>
  directionBreakdown?: Record<string, unknown>
}

export type SentimentSeriesData = {
  points: Array<{
    pointAsOf: string
    status: 'available' | 'unknown'
    score?: number
    label?: 'positive' | 'negative' | 'neutral' | 'mixed'
    confidence: number
    supportingImpactCount: number
    caveats: MarketIntelligenceQueryCaveat[]
  }>
}

export type PublicImpactView = {
  impactId: string
  itemId: string
  clusterId?: string
  sourceId: string
  layer: string
  direction: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  magnitude: 1 | 2 | 3 | 4 | 5
  confidence: number
  horizon: 'intraday' | '1d' | '1w' | '1m'
  affectedScopes: Array<{ type: string; id: string }>
  reasoning: string
  ruleId: string
  ruleVersion: string
  occurredAt?: string
  publishedAt?: string
  detectedAt: string
  computedAt: string
  visibleAt: string
  evidenceRefs: AgentSafeEvidenceRef[]
}

export type RelatedEventsData = {
  events: Array<{
    eventRefId: string
    itemId: string
    clusterId?: string
    sourceId: string
    layer: string
    eventType: string
    title: string
    summary?: string
    occurredAt?: string
    publishedAt?: string
    detectedAt: string
    visibleAt: string
    impacts: PublicImpactView[]
    evidenceRefs: AgentSafeEvidenceRef[]
    caveats: MarketIntelligenceQueryCaveat[]
  }>
}

export type ImpactTimelineData = {
  impacts: PublicImpactView[]
}

export type SourceHealthData = {
  sources: SourceCoverageAsOf[]
  summary: {
    freshCount: number
    staleCount: number
    failedCount: number
    pendingCount: number
    fixtureOnlyCount: number
    plannedCount: number
  }
}

export type EvidenceExcerptResult = {
  evidenceRef: AgentSafeEvidenceRef
  title: string
  excerpt?: string
  sourceUrl?: string
  language?: string
  translated?: boolean
}

export type MarketIntelligenceQueryResult<TData> = {
  schemaVersion: number
  queryId: string
  queryType: MarketIntelligenceQueryType
  asOf: string
  servedAt: string
  resultHash: string
  scope: MarketIntelligenceQueryScope
  timeWindow: {
    from?: string
    to: string
    lookbackWindowMs?: number
  }
  confidence: number
  caveats: MarketIntelligenceQueryCaveat[]
  sourceCoverage: SourceCoverageAsOf[]
  evidenceRefs: AgentSafeEvidenceRef[]
  data: TData
}
