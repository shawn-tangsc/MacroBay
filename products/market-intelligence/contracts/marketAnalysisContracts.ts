export const MARKET_ANALYSIS_CONTRACT_POLICY = Object.freeze({
  schemaVersion: 1,
  dataAccessProfileId: 'crypto-market-analysis-v1',
  outputSchemaVersion: 2,
  maximumModelFieldCharacters: 2_000,
  maximumModelOutputBytes: 256 * 1024,
  maximumCollectionItems: 160,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const)

export const MARKET_ANALYSIS_CONTEXT_POLICY = Object.freeze({
  defaultMaxFacts: MARKET_ANALYSIS_CONTRACT_POLICY.maximumCollectionItems,
  /**
   * Share of the fact budget the macro domain may take. Providers kept filling the context with
   * routine macro rows (112 of 161 facts at one point) and truncated capital, sentiment,
   * funding and cross-asset away entirely, so conclusions said they lacked the numbers they
   * needed to explain anything.
   */
  maximumMacroFacts: 90,
  /**
   * Floor under the macro ceiling: every domain keeps at least this many of its newest facts.
   *
   * The ceiling stopped one provider filling the context, but the budget is still global and the
   * reading order puts funding and sentiment last, so adding a domain (cross-asset) removed theirs
   * entirely: the 16:21 snapshot kept macro 91 / capital 60 / cross-asset 10 and **no funding and
   * no sentiment facts at all**. Six covers the smallest domain's full series (funding holds five
   * points) plus one, and costs nothing from the volume domains beyond the budget they already had.
   */
  minimumFactsPerDomain: 6,
  maximumOutputBytes: MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelOutputBytes,
  schemaVersion: 1
} as const)

export const MARKET_ANALYSIS_CONTEXT_CAVEATS = Object.freeze({
  maxItemsTruncated: 'max-items-truncated',
  sourceHealthUnavailable: 'source-health-unavailable',
  queryUnavailable: 'query-unavailable',
  queryEmpty: 'query-empty',
  evidenceUnavailable: 'evidence-unavailable',
  notComparable: 'not-comparable',
  macroCalendarUnavailable: 'macro-calendar-unavailable',
  macroCalendarEmpty: 'macro-calendar-empty',
  macroCalendarConsensusUnavailable: 'macro-calendar-consensus-unavailable',
  macroCalendarQueryNotWired: 'macro-calendar-query-not-wired',
  /**
   * The Nasdaq 100 row's preferred instrument is a cash index: it prints only inside the US cash
   * session, so it cannot explain a move that happened while its market was shut.
   */
  crossAssetIndexCashSession: 'us-cash-session',
  /**
   * The same row fell back to Binance's tokenised `QQQUSDT` perpetual: a 24/7 synthetic that is not the
   * standard index, and whose price is its own market rather than the index itself.
   */
  crossAssetIndexProxy: 'tokenized-index-proxy',
  /**
   * A source whose newest reading is older than its own freshness bound answered, but not with a
   * current value: the reading is dropped from the facts and the gap is named instead.
   */
  queryStale: 'query-stale',
  /**
   * Two daily series disagreed about which trading day they describe, so the difference between them
   * describes no single day. The legs are still facts; their spread is not stated.
   */
  macroRatesMixedPeriods: 'macro-rates-mixed-observation-dates'
} as const)

export const MARKET_ANALYSIS_MACRO_CALENDAR_POLICY = Object.freeze({
  maxEvents: 200,
  factMetrics: Object.freeze({
    eventName: 'event-name', lifecycleState: 'lifecycle-state', scheduledDate: 'scheduled-date',
    scheduledAt: 'scheduled-at', officialReleaseDate: 'official-release-date', actual: 'actual', previous: 'previous',
    // Market expectation. The official route has no consensus source; the 0xRouter route does,
    // and a change in expectation moves a conclusion without any released value changing.
    consensus: 'consensus'
  })
} as const)

export const MARKET_ANALYSIS_ID_PREFIXES = Object.freeze({
  eventGroup: 'mi-eg-',
  evidenceSnapshot: 'mi-es-',
  analysisRun: 'mi-ar-',
  summary: 'mi-as-',
  prediction: 'mi-pr-',
  predictionVerification: 'mi-pv-',
  timelineEntry: 'mi-tl-'
})

export type MarketAnalysisIdKind = keyof typeof MARKET_ANALYSIS_ID_PREFIXES

export const MARKET_ANALYSIS_ERROR_CODES = Object.freeze({
  notEnabled: 'analysis-not-enabled',
  profileNotFound: 'analysis-profile-not-found',
  eventGroupNotFound: 'analysis-event-group-not-found',
  snapshotNotFound: 'analysis-snapshot-not-found',
  asOfInvalid: 'analysis-as-of-invalid',
  contextMaxFactsInvalid: 'analysis-context-max-facts-invalid',
  contextTooLarge: 'analysis-context-too-large',
  contextDomainNotAllowed: 'analysis-context-domain-not-allowed',
  idempotencyConflict: 'analysis-idempotency-conflict',
  cooldownActive: 'analysis-cooldown-active',
  reviewLimitReached: 'analysis-review-limit-reached',
  budgetExhausted: 'analysis-budget-exhausted',
  concurrencyBusy: 'analysis-concurrency-busy',
  providerNotReady: 'analysis-provider-not-ready',
  providerError: 'analysis-provider-error',
  timeout: 'analysis-timeout',
  cancelled: 'analysis-cancelled',
  invalidJson: 'analysis-invalid-json',
  invalidOutputSchema: 'analysis-invalid-output-schema',
  missingEvidence: 'analysis-missing-evidence',
  unsafeOutput: 'analysis-unsafe-output',
  storageFailed: 'analysis-storage-failed',
  archiveUnavailable: 'analysis-archive-unavailable',
  predictionUnsupportedCondition: 'analysis-prediction-unsupported-condition',
  insufficientData: 'analysis-insufficient-data',
  notAvailable: 'analysis-not-available'
})

/**
 * MI-A03A owns the admission vocabulary.  Runtime query state is deliberately
 * kept in a separate tuple so a missing/empty value cannot be represented as
 * a numeric zero or as an admission decision.
 */
export const MARKET_ANALYSIS_DOMAIN_ADMISSIONS = Object.freeze([
  'production-ready',
  'connected-but-not-agent-tool',
  'fixture-only',
  'planned',
  'blocked',
  'temporarily-paused'
] as const)

export const MARKET_ANALYSIS_QUERY_STATES = Object.freeze([
  'available',
  'empty',
  'stale',
  'unavailable',
  'missing',
  'not-comparable'
] as const)

/**
 * The two instruments admitted behind the Nasdaq 100 row, in preference order.
 *
 * `USTEC` is the provider's real Nasdaq 100 index and answers the row by default; `QQQUSDT` is
 * Binance's tokenised perpetual and answers it only when the real source has nothing. The analysis
 * facts name whichever one answered them, so a conclusion can never read a proxy price as the index —
 * and each carries its own limitation as a caveat rather than a claim to be rediscovered.
 */
export const MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT = Object.freeze({
  sourceId: 'realmarketapi-market', symbol: 'USTEC', marketType: 'index' as const,
  session: 'us-cash-session', limitation: 'us-cash-session'
} as const)

export const MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT = Object.freeze({
  sourceId: 'binance-futures-positioning', symbol: 'QQQUSDT', baseAsset: 'QQQ', quoteAsset: 'USDT',
  contractType: 'TRADIFI_PERPETUAL', marketType: 'tokenized-proxy' as const,
  session: 'continuous', limitation: 'tokenized-index-proxy'
} as const)

export const MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS = Object.freeze([
  MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT, MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT
] as const)

export type MarketAnalysisCrossAssetInstrument = typeof MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS[number]

export type MarketAnalysisErrorCode = (typeof MARKET_ANALYSIS_ERROR_CODES)[keyof typeof MARKET_ANALYSIS_ERROR_CODES]

export type MarketAnalysisDomainAdmission = typeof MARKET_ANALYSIS_DOMAIN_ADMISSIONS[number]
export type MarketAnalysisQueryState = typeof MARKET_ANALYSIS_QUERY_STATES[number]

export type MarketAnalysisDomainAccess = Readonly<{
  domain: AnalysisDomain
  sourceIds: readonly string[]
  admission: MarketAnalysisDomainAdmission
  queryState: MarketAnalysisQueryState
  publicQueryMethods: readonly string[]
  ipcMethods: readonly string[]
  agentToolAvailable: boolean
  autoTriggerAllowed: boolean
  asOf: string
  freshness: AnalysisFreshness
  factCount: number
  evidenceCount: number
  caveats: readonly string[]
}>

export type MarketAnalysisContextInput = Readonly<{
  eventGroupId: string
  asOf: string
  domains?: readonly AnalysisDomain[]
  maxFacts?: number
}>

export type MarketAnalysisContextAvailable = Readonly<{
  state: 'available'
  schemaVersion: typeof MARKET_ANALYSIS_CONTEXT_POLICY.schemaVersion
  profileId: typeof MARKET_ANALYSIS_CONTRACT_POLICY.dataAccessProfileId
  eventGroupId: string
  asOf: string
  dataCutoff: string
  snapshotId: string | null
  snapshotHash: string | null
  facts: readonly AgentFact[]
  missingDomains: readonly AnalysisDomain[]
  caveats: readonly string[]
  evidenceRefs: readonly AgentEvidenceRef[]
  sourceHealth: readonly SourceHealthFlag[]
  domainAccess: readonly MarketAnalysisDomainAccess[]
}>

export type MarketAnalysisContextResult =
  | MarketAnalysisContextAvailable
  | Readonly<{ state: 'unavailable'; errorCode: Extract<MarketAnalysisErrorCode, 'analysis-as-of-invalid' | 'analysis-context-max-facts-invalid' | 'analysis-context-domain-not-allowed' | 'analysis-context-too-large'> }>

export type AnalysisDomain = 'macro' | 'capital' | 'sentiment' | 'funding' | 'cross-asset'
export type EventGroupStatus = 'open' | 'monitoring' | 'closed' | 'superseded'
export type EventGroupType = 'macro' | 'market-reaction' | 'capital' | 'sentiment' | 'funding' | 'cross-asset'
export type AnalysisPhase = 'initial' | 'review' | 'correction'
export type AnalysisRunStatus = 'queued' | 'running' | 'succeeded' | 'invalid-output' | 'failed' | 'cancelled' | 'stale' | 'superseded'
export type AnalysisFreshness = 'fresh' | 'stale' | 'missing' | 'unavailable' | 'closed'
export type AnalysisComparability = 'comparable' | 'proxy' | 'not-comparable'
export type AnalysisScenarioHorizon = '0-15m' | '15m-2h' | '2h-24h' | '1d-3d'

/**
 * The three horizons an operation direction is stated for: the next day, the next week, the next
 * month. The scenarios above describe intraday paths; these say what to do, and for how long.
 */
export type AnalysisDirectionHorizon = 'short' | 'medium' | 'long'
export type AnalysisDirectionConfidence = 'low' | 'medium' | 'high'

/**
 * One horizon's operation direction.
 *
 * `direction` is one of the five terms the conclusion's own marker uses (`analysisDirectionPolicy`),
 * so the panel colours it with the same palette it already uses for the overall verdict.
 */
/** 语言无关的方向 key；界面按当前语言取标签（`productText…conclusionDirection`）。 */
export type AnalysisConclusionDirection = 'bullish' | 'bearish' | 'range' | 'undecided' | 'mixed'

export type DirectionAdvice = Readonly<{
  horizon: AnalysisDirectionHorizon
  /** New runs write the language-neutral key; summaries published before it hold the old Chinese term. */
  direction: string
  rationale: string
  confidence: AnalysisDirectionConfidence
  evidenceRefIds: readonly string[]
}>
export type AnalysisPredictionStatus = 'pending' | 'confirmed' | 'partially-confirmed' | 'invalidated' | 'expired' | 'insufficient-data'

export type EventGroup = Readonly<{
  id: string
  schemaVersion: 1
  status: EventGroupStatus
  groupType: EventGroupType
  mergeKey: string
  firstObservedAt: string
  lastObservedAt: string
  reviewDeadlineAt: string
  eventRefs: readonly string[]
  triggerCount: number
  reviewCount: number
  currentSummaryId: string | null
  supersededByGroupId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}>

export type AgentFact = Readonly<{
  factId: string
  domain: AnalysisDomain
  subject: string
  /**
   * What to *call* this fact when the subject is only its kind.
   *
   * Calendar facts are keyed by the observation they came from, so their subject is the kind
   * (`economic-indicator`) and their name lives in the calendar store. This carries that name for
   * display only: it is never part of `factId`, which is what keeps a naming change from becoming a
   * change the diff reports — every calendar fact would otherwise read as newly added.
   */
  subjectLabel?: string
  metric: string
  value: string | number | null
  unit: string | null
  sourceId: string
  sourceLabel: string
  observedAt: string | null
  asOf: string
  freshness: AnalysisFreshness
  confidence: number
  comparability: AnalysisComparability
  evidenceRefId: string | null
}>

export type AgentEvidenceRef = Readonly<{
  evidenceRefId: string
  sourceId: string
  sourceLabel: string
  itemId: string | null
  occurredAt: string | null
  publishedAt: string | null
  detectedAt: string | null
  computedAt: string | null
  visibleAt: string
  excerptHash: string
}>

export type SourceHealthFlag = Readonly<{
  sourceId: string
  status: 'healthy' | 'degraded' | 'failed' | 'paused'
  asOf: string
}>

/**
 * One fact-level difference between a frozen snapshot and its predecessor in the
 * same event group. `changed` keeps both values so the agent can state what moved
 * instead of only what is currently true.
 */
export type SnapshotFactChange = Readonly<{
  factId: string
  domain: AnalysisDomain
  metric: string
  /**
   * Display fields copied from the fact. They let a reader describe the change
   * ("BTC ETF 净流入", unit USD) instead of showing an internal fact id, and are
   * optional because snapshots frozen before they existed carry none.
   */
  subject?: string
  /** The subject's own name, when the subject is only its kind. Display only, never identity. */
  subjectLabel?: string
  unit?: string | null
  sourceLabel?: string
  kind: 'added' | 'removed' | 'changed'
  /** Present for `removed` and `changed`; the value carried by the predecessor. */
  previousValue?: string | number | null
  /** Present for `added` and `changed`; the value carried by this snapshot. */
  value?: string | number | null
}>

/**
 * Frozen record of what changed at publication time (product owner request:
 * every new conclusion must state which data moved). It is stored on the snapshot
 * and covered by `snapshotHash`, so a replay reproduces the same "what changed"
 * view without reading any mutable table.
 */
export type SnapshotChange = Readonly<{
  /** 1 for the first snapshot of an event group, then the predecessor's sequence + 1. */
  sequence: number
  previousSnapshotHash: string | null
  /** Sorted factId order; empty when the snapshot is the first one or nothing moved. */
  facts: readonly SnapshotFactChange[]
  /** Domains that entered `missingDomains` compared with the predecessor. */
  missingDomainsAdded: readonly AnalysisDomain[]
  /** Domains that left `missingDomains` compared with the predecessor. */
  missingDomainsRemoved: readonly AnalysisDomain[]
  caveatsAdded: readonly string[]
  caveatsRemoved: readonly string[]
  evidenceRefsAdded: readonly string[]
  evidenceRefsRemoved: readonly string[]
}>

export type EvidenceSnapshot = Readonly<{
  id: string
  schemaVersion: 1
  eventGroupId: string
  asOf: string
  dataCutoff: string
  snapshotHash: string
  profileId: typeof MARKET_ANALYSIS_CONTRACT_POLICY.dataAccessProfileId
  facts: readonly AgentFact[]
  missingDomains: readonly AnalysisDomain[]
  caveats: readonly string[]
  evidenceRefs: readonly AgentEvidenceRef[]
  sourceHealth: readonly SourceHealthFlag[]
  /**
   * What moved since the previous snapshot of the same event group.
   *
   * Optional on purpose: snapshots written before this record existed stay valid,
   * and `snapshotHash` deliberately does not cover it. Readers derive it from the
   * immutable predecessor when it is absent, so the value is auditable without a
   * hash migration that would invalidate persisted rows.
   */
  change?: SnapshotChange
  createdAt: string
  policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
}>

export type AnalysisRun = Readonly<{
  id: string
  schemaVersion: 1
  eventGroupId: string
  snapshotId: string
  snapshotHash: string
  analysisPhase: AnalysisPhase
  triggerKey: string
  idempotencyKey: string
  status: AnalysisRunStatus
  attempt: number
  retryOfRunId: string | null
  modelProviderId: string | null
  modelId: string | null
  policyVersion: string
  promptVersion: string
  skillVersion: string
  outputSchemaVersion: 1 | 2
  jobRunId: string | null
  traceId: string | null
  failureCode: string | null
  failureDetailCode: string | null
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
}>

/**
 * The conclusion of one analysis, as data rather than as prose carrying machine markers.
 *
 * `direction` is a language-neutral key so any reader locale renders its own label; the remaining
 * fields are prose in the language the run was asked to answer in. Keeping the structure here means
 * the validator and every surface read fields, never natural-language tokens.
 */
export type AnalysisConclusion = Readonly<{
  direction: AnalysisConclusionDirection
  /** The one-sentence verdict: mechanism and its effect on the asset. */
  summary: string
  /** What moved since the previous snapshot; states "no change" instead of inventing one. */
  change: string
  /** Cause → intermediate variable → effect → conditions, as one readable chain. */
  causalChain: string
  /** Conditions under which this conclusion holds. */
  conditions: readonly string[]
  /** The macro side, when it carries part of the verdict. */
  macro: string | null
  /** Which side of the evidence is stronger, when that is worth stating. */
  evidenceStrength: string | null
  /** Gaps in the evidence and how each one limits confidence. */
  dataGaps: readonly string[]
}>

export type AnalysisSummary = Readonly<{
  id: string
  schemaVersion: 1
  analysisRunId: string
  eventGroupId: string
  version: number
  /**
   * Legacy free text (`方向：偏空：…本次变化：…`) from summaries published before the structured
   * conclusion existed. Read-only history: new runs write `conclusion` instead.
   */
  eventAssessment?: string
  /** Structured conclusion written by current runs. */
  conclusion?: AnalysisConclusion
  knownFacts: readonly FactClaim[]
  transmissionHypotheses: readonly Hypothesis[]
  marketReaction: readonly ReactionClaim[]
  supportingEvidence: readonly EvidenceClaim[]
  counterEvidence: readonly EvidenceClaim[]
  scenarios: readonly Scenario[]
  /** One entry per horizon, produced by the model and required by the validator. */
  directions: readonly DirectionAdvice[]
  nextCatalysts: readonly Catalyst[]
  dataCaveats: readonly string[]
  evidenceRefs: readonly string[]
  createdAt: string
}>

export type FactClaim = Readonly<{ factId: string; statement: string; evidenceRefIds: readonly string[] }>
export type Hypothesis = Readonly<{ statement: string; evidenceRefIds: readonly string[] }>
export type ReactionClaim = Readonly<{ statement: string; factIds: readonly string[]; evidenceRefIds: readonly string[] }>
export type EvidenceClaim = Readonly<{ statement: string; evidenceRefId: string }>
export type Catalyst = Readonly<{ statement: string; evidenceRefIds: readonly string[] }>
export type Scenario = Readonly<{
  asset: 'BTC' | 'ETH'
  horizon: AnalysisScenarioHorizon
  baseCase: string
  conditions: readonly string[]
  invalidation: string
  status: 'pending'
}>

export type Prediction = Readonly<{
  id: string
  schemaVersion: 1
  summaryId: string
  asset: 'BTC' | 'ETH'
  horizonStart: string
  horizonEnd: string
  baseCase: string
  conditions: readonly string[]
  invalidation: string
  nextCatalyst: string | null
  status: AnalysisPredictionStatus
  verificationDueAt: string
  createdAt: string
}>

export type PredictionVerification = Readonly<{
  id: string
  predictionId: string
  status: AnalysisPredictionStatus
  evaluatedAt: string
  ruleVersion: 'prediction-verification.v1'
  evidenceRefs: readonly string[]
  reasonCode: string
  reason: string
}>

export type TimelineEntry = Readonly<{
  id: string
  schemaVersion: 1
  eventGroupId: string
  analysisRunId: string | null
  kind: 'event' | 'analysis' | 'review' | 'prediction-update' | 'system'
  status: 'published' | 'stale' | 'superseded'
  occurredAt: string
  summaryRef: string | null
  safeTitle: string
  safeExcerpt: string | null
  /** Language-neutral direction of the analysis this entry publishes, when it has one. */
  direction?: AnalysisConclusionDirection | null
  version: number
}>

export function isMarketAnalysisCanonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !MARKET_ANALYSIS_CONTRACT_POLICY.canonicalUtcMillisPattern.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

export function isMarketAnalysisFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

export function isMarketAnalysisId(kind: MarketAnalysisIdKind, value: unknown): value is string {
  return typeof value === 'string' && value.length > MARKET_ANALYSIS_ID_PREFIXES[kind].length && value.startsWith(MARKET_ANALYSIS_ID_PREFIXES[kind])
}

export function formatMarketAnalysisDataAccessAcceptanceMarker(details: Readonly<{
  domains: number
  runtimeStatusCasesCovered: number
  agentToolsRegistered: number
  agentToolMismatch: number
}>): string {
  return JSON.stringify({
    marker: 'MI_ANALYSIS_ACCEPTANCE',
    package: 'MI-A03A',
    event: 'data-access-matrix',
    status: 'pass',
    details: {
      domains: details.domains,
      runtimeStatusCasesCovered: details.runtimeStatusCasesCovered,
      agentToolsRegistered: details.agentToolsRegistered,
      agentToolMismatch: details.agentToolMismatch
    }
  })
}
