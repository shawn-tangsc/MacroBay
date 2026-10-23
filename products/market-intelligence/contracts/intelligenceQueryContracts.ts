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
  buckets: [
    { maximum: 24, key: 'extreme-fear' },
    { maximum: 49, key: 'fear' },
    { maximum: 50, key: 'neutral' },
    { maximum: 74, key: 'greed' },
    { maximum: 100, key: 'extreme-greed' }
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

export function isFundingRateHistoryRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100
}

export type CapitalConditionsSnapshotQueryInput = {
  asOf: string
}

export type EtfPublicFlow = Readonly<{
  tradingDate: string
  netFlowUsd: number
  observedAt: string
}>

export type EtfPublicAssetSnapshot = Readonly<{
  asset: 'BTC' | 'ETH'
  rows: readonly EtfPublicFlow[]
}>

export type EtfPublicSnapshot = Readonly<{
  state: 'available'
  schemaVersion: 1
  sourceId: '0xrouter'
  windowEnd: string
  verifiedAt: string
  btc: EtfPublicAssetSnapshot
  eth: EtfPublicAssetSnapshot
}>

export type CapitalConditionsSnapshotResult =
  | {
      state: 'available'
      asOf: string
      etf: EtfPublicSnapshot | { state: 'unavailable' }
      coreStablecoins: {
        observedAt: string
        verifiedAt: string
        currentUsd: number
        change1dUsd: number
        change1dPercent: number
        change7dUsd: number
        change7dPercent: number
        change30dUsd: number
        change30dPercent: number
        dailyFlows?: readonly { tradingDate: string; netFlowUsd: number }[]
      }
      usdStablecoinSupplyUsd?: number
      conclusion: 'partial' | 'unavailable'
    }
  | { state: 'empty'; asOf: string }
  | { state: 'unavailable'; failureCode: 'capital-conditions-query-unavailable' }

export const capitalConditionsSnapshotPolicy = {
  sourceId: 'defillama-stablecoins',
  maximumAgeMs: 6 * 60 * 60 * 1_000,
  maximumDtoBytes: 12 * 1024,
  unavailableFailureCode: 'capital-conditions-query-unavailable',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export const capitalConditionsDailyFlowPolicy = {
  minimumRows: 5,
  maximumRows: 30,
  dayMilliseconds: 24 * 60 * 60 * 1_000,
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export function isValidCapitalConditionsDailyFlows(value: unknown, asOf: unknown): value is readonly { tradingDate: string; netFlowUsd: number }[] {
  if (!Array.isArray(value) || value.length < capitalConditionsDailyFlowPolicy.minimumRows || value.length > capitalConditionsDailyFlowPolicy.maximumRows || !isCanonicalCapitalConditionsSnapshotTime(asOf)) return false
  const currentDate = asOf.slice(0, 10)
  return value.every((row, index) => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ['tradingDate', 'netFlowUsd']) || !isTradingDate(row.tradingDate) || row.tradingDate >= currentDate ||
      typeof row.netFlowUsd !== 'number' || !Number.isFinite(row.netFlowUsd) || Object.is(row.netFlowUsd, -0)) return false
    return index === 0 || Date.parse(`${row.tradingDate}T00:00:00.000Z`) - Date.parse(`${value[index - 1]!.tradingDate}T00:00:00.000Z`) === capitalConditionsDailyFlowPolicy.dayMilliseconds
  })
}

/** The complete capital-conditions result crosses service, IPC, and renderer boundaries. */
export function isWithinCapitalConditionsSnapshotDtoBudget(value: unknown): boolean {
  return isWithinUtf8JsonBudget(value, capitalConditionsSnapshotPolicy.maximumDtoBytes)
}

export const etfPublicSnapshotPolicy = {
  schemaVersion: 1,
  sourceId: '0xrouter',
  maximumAgeMs: 48 * 60 * 60 * 1_000,
  maximumRowsPerAsset: 30,
  minimumRowsPerAsset: 5,
  maximumDtoBytes: 12 * 1024,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export function isWithinEtfPublicSnapshotDtoBudget(value: unknown): boolean {
  return isWithinUtf8JsonBudget(value, etfPublicSnapshotPolicy.maximumDtoBytes)
}

export function isValidEtfPublicSnapshot(value: unknown): value is EtfPublicSnapshot {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ['state', 'schemaVersion', 'sourceId', 'windowEnd', 'verifiedAt', 'btc', 'eth']) ||
      value.state !== 'available' || value.schemaVersion !== etfPublicSnapshotPolicy.schemaVersion || value.sourceId !== etfPublicSnapshotPolicy.sourceId ||
      !isTradingDate(value.windowEnd) || !isCanonicalEtfPublicTime(value.verifiedAt)) return false
    if (!isEtfPublicAsset(value.btc, 'BTC', value.verifiedAt) || !isEtfPublicAsset(value.eth, 'ETH', value.verifiedAt)) return false
    const btc = value.btc as EtfPublicAssetSnapshot
    const eth = value.eth as EtfPublicAssetSnapshot
    if (btc.rows.length !== eth.rows.length || !btc.rows.every((row, index) => row.tradingDate === eth.rows[index]?.tradingDate)) return false
    return btc.rows.at(-1)?.tradingDate === value.windowEnd && eth.rows.at(-1)?.tradingDate === value.windowEnd &&
      isWithinEtfPublicSnapshotDtoBudget(value)
  } catch {
    return false
  }
}

export function toEtfPublicSnapshot(value: unknown): EtfPublicSnapshot | undefined {
  if (!isValidEtfPublicSnapshot(value)) return undefined
  return Object.freeze({
    state: 'available', schemaVersion: etfPublicSnapshotPolicy.schemaVersion, sourceId: etfPublicSnapshotPolicy.sourceId,
    windowEnd: value.windowEnd, verifiedAt: value.verifiedAt,
    btc: copyEtfPublicAsset(value.btc), eth: copyEtfPublicAsset(value.eth)
  })
}

export function isCanonicalEtfPublicTime(value: unknown): value is string {
  if (typeof value !== 'string' || !etfPublicSnapshotPolicy.canonicalUtcMillisPattern.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

export function isVisibleEtfPublicSnapshot(value: unknown, asOf: unknown): value is EtfPublicSnapshot {
  if (!isValidEtfPublicSnapshot(value) || !isCanonicalEtfPublicTime(asOf)) return false
  const ageMs = Date.parse(asOf) - Date.parse(value.verifiedAt)
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= etfPublicSnapshotPolicy.maximumAgeMs
}

function isEtfPublicAsset(value: unknown, asset: 'BTC' | 'ETH', verifiedAt: string): value is EtfPublicAssetSnapshot {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['asset', 'rows']) || value.asset !== asset || !Array.isArray(value.rows) ||
    value.rows.length < etfPublicSnapshotPolicy.minimumRowsPerAsset || value.rows.length > etfPublicSnapshotPolicy.maximumRowsPerAsset) return false
  const rows = value.rows as readonly unknown[]
  if (Object.keys(rows).length !== rows.length || Object.getOwnPropertySymbols(rows).length > 0) return false
  return rows.every((row, index) => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ['tradingDate', 'netFlowUsd', 'observedAt']) || !isTradingDate(row.tradingDate) ||
      typeof row.netFlowUsd !== 'number' || !Number.isFinite(row.netFlowUsd) || Object.is(row.netFlowUsd, -0) || !isCanonicalEtfPublicTime(row.observedAt) ||
      index > 0 && previousTradingDate(rows[index - 1]) >= row.tradingDate) return false
    return row.observedAt <= verifiedAt
  })
}

function copyEtfPublicAsset(value: EtfPublicAssetSnapshot): EtfPublicAssetSnapshot {
  return Object.freeze({
    asset: value.asset,
    rows: Object.freeze(value.rows.map((row) => Object.freeze({
      tradingDate: row.tradingDate, netFlowUsd: row.netFlowUsd, observedAt: row.observedAt
    })))
  })
}

function previousTradingDate(value: unknown): string {
  return isPlainRecord(value) && typeof value.tradingDate === 'string' ? value.tradingDate : ''
}

function isTradingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !etfPublicSnapshotPolicy.tradingDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 && Object.keys(value).length === allowed.length && allowed.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isWithinUtf8JsonBudget(value: unknown, maximumBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).byteLength <= maximumBytes
  } catch {
    return false
  }
}

export function isCanonicalCapitalConditionsSnapshotTime(value: unknown): value is string {
  if (typeof value !== 'string' || !capitalConditionsSnapshotPolicy.canonicalUtcMillisPattern.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

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
