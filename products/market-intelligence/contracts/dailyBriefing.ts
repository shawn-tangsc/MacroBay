import type { AnalysisConclusionDirection } from './marketAnalysisContracts'

/**
 * The frozen daily-briefing document.
 *
 * This is the one shape the renderer, the Markdown serializer and the stored edition share. It is
 * data only: labels are keys, prose is the published conclusion's own text, and every number keeps
 * its window and observation time. The main process builds it; the renderer never re-derives it.
 *
 * `maximumNewsItems` and `maximumMacroItems` are the per-class candidate budget: one edition may
 * carry at most 200 news candidates and 200 macro candidates. A larger pool is a generation
 * failure (`candidate-overflow`) rather than a silent truncation, so an edition never pretends a
 * dropped tail was the day's full selection. The renderer reads the same numbers from here when it
 * validates an incoming document, which keeps the client and the builder from drifting apart.
 */
export const dailyBriefingPolicy = Object.freeze({
  schemaVersion: 9,
  policyVersion: 'daily-briefing.v20',
  /** The default statistical window. The reader's generation settings may override it per edition. */
  windowHours: 24,
  maximumBytes: 256 * 1024,
  maximumNewsItems: 200,
  maximumMacroItems: 200,
  maximumNextItems: 3,
  maximumCounterEvidence: 3,
  maximumConditions: 5,
  maximumGaps: 3,
  maximumCaveats: 3,
  retentionDays: 14,
  editionDatePattern: /^\d{4}-\d{2}-\d{2}$/
})

/**
 * When the brief is generated and what it covers.
 *
 * The generation time is a local wall-clock time: it is both the scheduler trigger and the edition
 * cutoff, so the two can never drift apart. Only whole and half hours in the morning window are
 * accepted, which keeps the cron expression readable and the cutoff reviewable.
 */
export const dailyBriefingGenerationPolicy = Object.freeze({
  defaultGenerationTime: '08:00',
  earliestGenerationHour: 6,
  latestGenerationHour: 10,
  generationMinuteStep: 30,
  defaultWindowHours: 24,
  windowHoursOptions: Object.freeze([12, 24, 48] as const)
})

/** Local generation times a reader may choose, in order: 06:00 … 10:00. */
export const dailyBriefingGenerationTimes: readonly string[] = Object.freeze(
  Array.from(
    { length: ((dailyBriefingGenerationPolicy.latestGenerationHour - dailyBriefingGenerationPolicy.earliestGenerationHour) * (60 / dailyBriefingGenerationPolicy.generationMinuteStep)) + 1 },
    (_, index) => {
      const minutes = dailyBriefingGenerationPolicy.earliestGenerationHour * 60 + index * dailyBriefingGenerationPolicy.generationMinuteStep
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    }
  )
)

export function isDailyBriefingGenerationTime(value: unknown): value is string {
  return typeof value === 'string' && dailyBriefingGenerationTimes.includes(value)
}

export type DailyBriefingWindowHours = (typeof dailyBriefingGenerationPolicy.windowHoursOptions)[number]

export function isDailyBriefingWindowHours(value: unknown): value is DailyBriefingWindowHours {
  return typeof value === 'number' && (dailyBriefingGenerationPolicy.windowHoursOptions as readonly number[]).includes(value)
}

export type DailyBriefingLocale = 'zh-CN' | 'en-US'
export type DailyBriefLedePattern = 'event-shock' | 'surprise-gap' | 'tension' | 'structure' | 'setup' | 'outlier' | 'falsification'
export type DailyBriefingDocumentSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type DailyBriefingPolicyVersion = 'daily-briefing.v1' | 'daily-briefing.v2' | 'daily-briefing.v3' | 'daily-briefing.v4' | 'daily-briefing.v5' | 'daily-briefing.v6' | 'daily-briefing.v7' | 'daily-briefing.v8' | 'daily-briefing.v9' | 'daily-briefing.v10' | 'daily-briefing.v11' | 'daily-briefing.v12' | 'daily-briefing.v13' | 'daily-briefing.v14' | 'daily-briefing.v15' | 'daily-briefing.v16' | 'daily-briefing.v17' | 'daily-briefing.v18' | 'daily-briefing.v19' | 'daily-briefing.v20'

/** The four readings, and whether each source could answer at generation time. */
export type DailyBriefingReadingId = 'fear-greed' | 'funding' | 'capital' | 'calendar'
export type DailyBriefingReadingState = 'available' | 'stale' | 'unavailable' | 'source-disabled'

/** Visibility tier. The agent ranks; a deterministic floor is unioned into `must` by the builder. */
export type FactImportanceTier = 'must' | 'support' | 'reference'
export type FactImportanceSource = 'rule' | 'agent'
export type FactImportanceReason =
  | 'reading'
  | 'largest-move'
  | 'gap'
  | 'high-impact-release'
  | 'nearest-event'
  | 'counter-evidence'
  | 'context'
  | 'agent'

export type FactImportance = Readonly<{
  tier: FactImportanceTier
  source: FactImportanceSource
  reasonCode: FactImportanceReason
  reasonText?: string
}>

/**
 * Deterministic materiality of one data fact.
 *
 * The rule layer decides whether a fact is allowed to appear at all: a leverage or policy-path line
 * below its threshold can never be shown, however the model ranks it. The reader's rule is
 * "no material change, no line", so an immaterial row keeps a hidden baseline instead of appearing
 * because a value exists. `reasonCode` is stable data, never prose.
 */
export type BriefingMaterialityCode =
  | 'largest-move'
  | 'gap'
  | 'index-move'
  | 'fx-move'
  | 'gold-move'
  | 'yield-move'
  | 'stablecoin-shift'
  | 'etf-flow'
  | 'funding-extreme'
  | 'funding-flip'
  | 'sentiment-extreme'
  | 'open-interest-shift'
  | 'policy-probability-shift'
  | 'policy-meeting-imminent'
  | 'policy-path-change'
  | 'no-material-change'

export type BriefingMateriality = Readonly<{
  material: boolean
  reasonCode: BriefingMaterialityCode
}>

/** Editorial visibility of a data fact. Absent on editions built before the field existed: shown. */
export type BriefingDataVisibility = 'shown' | 'hidden'

/**
 * How a row's comparison is anchored in time.
 *
 * A daily brief is generated every morning, but its rows do not all publish on that clock:
 *
 * - `24h` — a 24/7 market (crypto, stablecoins, funding, open interest). The baseline is the point
 *   nearest `asOf - 24h`, so Saturday is compared with Friday, not with "yesterday".
 * - `trading-day` — a US session close (ETF flows, the dollar, gold, the ten-year). The baseline is
 *   the last close of the previous session, reached by walking back over weekends and market
 *   holidays. A day without a close is not a stale reading: the newest close is simply the newest.
 * - `publication-day` — a released value (fear-and-greed, a calendar release). The baseline is the
 *   previous publication, whatever day it landed on; the real interval is carried in `baselineAt`.
 *
 * `baselineAt` is the instant of the value compared against. Without it the window is known but the
 * anchor is not, and a reader must not be told a "1d" move that was measured over an unknown span.
 */
export type BriefingRowCadence = '24h' | 'trading-day' | 'publication-day'

/**
 * The expected publication windows a row is allowed before its absence becomes a gap.
 *
 * These are tolerances for lateness, not rules for weekends: a `trading-day` row is never stale
 * because the market is shut, only because sessions that should have printed are missing.
 */
export const briefingCadencePolicy = Object.freeze({
  /** A 24/7 feed may lag this long and still answer a rolling-24h comparison. */
  rolling24hMaxLagMs: 6 * 60 * 60 * 1_000,
  /** Sessions a `trading-day` row may miss before its value is a gap rather than the newest close. */
  tradingDayMaxMissingSessions: 2
})

export type BriefingValueFormat = 'score' | 'percent' | 'usd' | 'flow-usd' | 'yield' | 'level'
/** `points` is a fear-and-greed index move, which is a score change rather than a percentage. */
export type BriefingChangeUnit = 'pp' | 'percent' | 'bp' | 'usd' | 'points'
/**
 * The comparison window of a data row. `24h` is a rolling 24/7 window, `1d` the source's own
 * day-over-day figure, `trading-day` one session's close, `publication-day` the span since the
 * previous release.
 */
export type BriefingWindow = 'latest' | '24h' | '1d' | '7d' | '30d' | 'daily' | 'trading-day' | 'publication-day'

/**
 * One comparison window of a data row.
 *
 * `change` is the row's headline comparison; `auxiliaryChanges` carries the longer or alternate
 * windows (stablecoin 7d/30d, the 1d dollar amount beside its percentage). A change is never
 * inferred from the level: when the edition has no earlier observation the row says
 * `changeReason: 'no-baseline'` instead of reporting a zero move.
 */
export type BriefingRowChange = Readonly<{
  value: number
  unit: BriefingChangeUnit
  window: BriefingWindow
}>

export type BriefingMarketRow = Readonly<{
  id: 'btc' | 'eth' | 'index' | 'dxy' | 'gold' | 'us10y' | 'us10y-real'
  labelKey: string
  importance: FactImportance
  /** Deterministic verdict; absent on editions built before v19. */
  materiality?: BriefingMateriality
  /** Editorial visibility; absent means shown, for older editions. */
  visibility?: BriefingDataVisibility
  visibilityReason?: string
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: BriefingRowChange | null
  /** Longer comparison windows shown behind the headline change; never invented when absent. */
  auxiliaryChanges?: readonly BriefingRowChange[]
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  /** The comparison cadence; absent on editions built before schema 9. */
  cadence?: BriefingRowCadence
  /** The instant of the value `change` was measured against; absent when only the window is known. */
  baselineAt?: string
  observedAt: string | null
  reason?: 'not-collected' | 'query-failed' | 'stale-fallback' | 'coverage-incomplete'
}>

export type BriefingPulseRow = Readonly<{
  id: 'fear-greed' | 'funding-btc' | 'funding-eth' | 'stablecoin' | 'etf-btc' | 'etf-eth'
  group: 'funds' | 'sentiment'
  labelKey: string
  importance: FactImportance
  /** Deterministic verdict; absent on editions built before v19. */
  materiality?: BriefingMateriality
  /** Editorial visibility; absent means shown, for older editions. */
  visibility?: BriefingDataVisibility
  visibilityReason?: string
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: BriefingRowChange | null
  /** Longer comparison windows shown behind the headline change; never invented when absent. */
  auxiliaryChanges?: readonly BriefingRowChange[]
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  /** The comparison cadence; absent on editions built before schema 9. */
  cadence?: BriefingRowCadence
  /** The instant of the value `change` was measured against; absent when only the window is known. */
  baselineAt?: string
  observedAt: string | null
  reason?: 'not-collected' | 'query-failed' | 'capital-gate' | 'etf-unavailable'
}>

export type BriefingNewsPolarity = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type BriefingNewsItem = Readonly<{
  itemId: string
  title: string
  translatedTitle?: string
  sourceName: string
  publishedAt: string
  polarity: BriefingNewsPolarity
  strength: number
  confidence: number
  symbols: readonly ('BTC' | 'ETH')[]
  why?: string
  /** AI visibility decision; absent means shown for older editions. */
  visibility?: 'shown' | 'hidden'
  visibilityReason?: string
}>

export type BriefingMacroItem = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  scheduledAt: string
  importance: 'high' | 'medium' | 'low'
  actual?: string
  previous?: string
  consensus?: string
  surprise: Readonly<{
    direction: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
    value?: number
    unit?: 'pp' | 'relative-percent'
    reason?: string
  }>
  why?: string
  /** AI visibility decision; absent means shown for older editions. */
  visibility?: 'shown' | 'hidden'
  visibilityReason?: string
}>

export type BriefingNextItem = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  at: string
  importance: 'high' | 'medium' | 'low'
  category: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  countryCode?: string
  countryName?: string
  consensus?: string
  previous?: string
  /** Editorial: why this event is the focus, and what each surprise would imply. */
  why?: string
  watch?: readonly Readonly<{ condition: string; implication: string }>[]
}>

export type BriefingCounterEvidence = Readonly<{
  statement: string
  citations: readonly number[]
}>

export type BriefingTopSignal = Readonly<{
  horizon: string
  direction: string
  confidence: string
  rationale: string
  citations: readonly number[]
}>

export type BriefingConclusion = Readonly<{
  summaryId: string
  publishedAt: string
  direction: AnalysisConclusionDirection
  /** One row per operation horizon; the direction ribbon reads these. */
  directions: readonly Readonly<{ horizon: string; direction: string; confidence: string }>[]
  summary: string
  translation?: string
  change?: string
  conditions: readonly string[]
  invalidations: readonly Readonly<{ asset: 'BTC' | 'ETH'; horizonEnd: string; text: string }>[]
  counterEvidence: readonly BriefingCounterEvidence[]
  topSignal: BriefingTopSignal | null
  evidenceStrength?: string
  dataGaps: readonly string[]
  caveats: readonly string[]
}>

export type BriefingNewsSummary = Readonly<{
  state: 'available' | 'empty' | 'unavailable' | 'source-disabled'
  counts?: Readonly<{ bearish: number; bullish: number; mixed: number; neutral: number }>
  itemCount?: number
}>

export type BriefingComparison = Readonly<{
  previousDate: string
  directionChanged: boolean
  previousDirection?: AnalysisConclusionDirection
  fundingBtcDelta?: number
  stablecoinDelta?: number
  etfBtcDelta?: number
  newMacroEvents?: number
}>

export type DailyBriefingDocument = Readonly<{
  schemaVersion: DailyBriefingDocumentSchemaVersion
  policyVersion: DailyBriefingPolicyVersion
  edition: Readonly<{
    date: string
    locale: DailyBriefingLocale
    generatedAt: string
    windowStart: string
    windowEnd: string
    timeZone: string
    /**
     * The statistical window this edition actually covered. It is written at generation time and
     * never re-derived from the current settings, so changing the setting cannot reinterpret an
     * edition that was already generated. Absent on editions built before the window was
     * configurable; those covered the fixed 24 hours the policy then named.
     */
    windowHours?: number
  }>
  status: Readonly<{
    readings: readonly Readonly<{ id: DailyBriefingReadingId; state: DailyBriefingReadingState }>[]
    readingsAvailable: number
    readingsTotal: 4
  }>
  lede: Readonly<{
    source: 'template' | 'agent'
    text: string
    pattern?: DailyBriefLedePattern
    previousPattern?: DailyBriefLedePattern
    factCount?: number
    generatedAt: string
  }>
  news: Readonly<{
    items: readonly BriefingNewsItem[]
    macro: readonly BriefingMacroItem[]
    macroCandidates?: readonly BriefingMacroItem[]
    notes: Readonly<{ newsEmpty?: string; macroEmpty?: string }>
  }>
  data: Readonly<{
    market: readonly BriefingMarketRow[]
    policyPath?: Readonly<{
      state: 'available'
      meetingDate: string
      outcome: string
      probability: number
      observedAt: string
      targetLower?: number
      targetUpper?: number
      /** Probability change against the previous edition, in percentage points. */
      probabilityChangePp?: number
      materiality?: BriefingMateriality
      visibility?: BriefingDataVisibility
      visibilityReason?: string
    }>
    leverage?: Readonly<{
      state: 'available' | 'stale' | 'unavailable'
      observedAt?: string
      btc: Readonly<{ fundingRate?: number; openInterestUsd?: number; change1hPct?: number; change24hPct?: number }>
      eth: Readonly<{ fundingRate?: number; openInterestUsd?: number; change1hPct?: number; change24hPct?: number }>
      materiality?: BriefingMateriality
      visibility?: BriefingDataVisibility
      visibilityReason?: string
    }>
    funds: readonly BriefingPulseRow[]
    sentiment: Readonly<{
      fearGreed: BriefingPulseRow | null
      news: BriefingNewsSummary
    }>
  }>
  conclusion: BriefingConclusion | null
  next: Readonly<{ items: readonly BriefingNextItem[]; focus?: BriefingNextItem; candidates?: readonly BriefingNextItem[]; note?: string }>
  comparison?: BriefingComparison
  editorial?: Readonly<{ dataNote?: string; invalidationNote?: string }>
  citations: readonly Readonly<{
    index: number
    refId: string
    sourceLabel?: string
    observedAt?: string
    itemId?: string
    statement?: string
  }>[]
  provenance: Readonly<{
    summaryId: string | null
    readAt: string
    supplements?: readonly Readonly<{ at: string; tool: string; reason: string }>[]
    editorialMeta?: Readonly<{
      promptVersion: string
      model: string
      source: 'default' | 'custom'
      fallback?: 'custom-unavailable'
    }>
    /** Present when the fact layer shipped because the editorial layer did not run. */
    editorialFailure?: string
    editorialFailureDetail?: string
    selectionAudit?: Readonly<{ shown: readonly string[]; hidden: readonly Readonly<{ factId: string; reason: string }>[] }>
    /** Absent on editions generated before the stage trace existed. */
    generationTrace?: BriefingGenerationTrace
  }>
}>

/** The fixed generation stages, in the order a successful generation runs them. */
export const briefingGenerationStageIds = [
  'source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation', 'repair-1', 'repair-2', 'store'
] as const

export type BriefingGenerationStageId = (typeof briefingGenerationStageIds)[number]
export type BriefingGenerationStageState = 'success' | 'failed' | 'skipped' | 'pending'

export type BriefingGenerationStage = Readonly<{
  id: BriefingGenerationStageId
  state: BriefingGenerationStageState
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  failureCode?: string
  failureDetail?: string
}>

/**
 * What one generation attempt did, stage by stage.
 *
 * A successful attempt is stored with its document (`provenance.generationTrace`); a failed
 * attempt has no document, so the service stores the trace next to the edition key and returns it
 * with `unavailable`. The shape is optional so editions built before the trace existed stay valid.
 */
export type BriefingGenerationTrace = Readonly<{
  attemptId: string
  startedAt: string
  finishedAt: string
  state: 'success' | 'failed'
  stages: readonly BriefingGenerationStage[]
}>

/** One row in the history rail. `missing` rows are gaps, not empty editions. */
export type DailyBriefingEditionSummary = Readonly<{
  date: string
  locale: DailyBriefingLocale
  availableLocales: readonly DailyBriefingLocale[]
  state: 'generated' | 'missing'
  generatedAt?: string
  direction?: AnalysisConclusionDirection
  summaryLine?: string
  readingsAvailable?: number
  windowEnd?: string
}>

export type DailyBriefingListResult = Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
}>

export function isDailyBriefingLocale(value: unknown): value is DailyBriefingLocale {
  return value === 'zh-CN' || value === 'en-US'
}

export function isDailyBriefingEditionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !dailyBriefingPolicy.editionDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function isDailyBriefingReadingState(value: unknown): value is DailyBriefingReadingState {
  return value === 'available' || value === 'stale' || value === 'unavailable' || value === 'source-disabled'
}

export function isFactImportanceTier(value: unknown): value is FactImportanceTier {
  return value === 'must' || value === 'support' || value === 'reference'
}

const generationStageIds: ReadonlySet<string> = new Set(briefingGenerationStageIds)
const generationStageStates: ReadonlySet<string> = new Set(['success', 'failed', 'skipped', 'pending'])

/** The IPC guard for the optional trace: a malformed trace is dropped, never rendered as data. */
export function isBriefingGenerationTrace(value: unknown): value is BriefingGenerationTrace {
  if (!isRecord(value)) return false
  if (!isBoundedText(value.attemptId, 200)) return false
  if (!isInstant(value.startedAt) || !isInstant(value.finishedAt)) return false
  if (value.state !== 'success' && value.state !== 'failed') return false
  if (!Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > briefingGenerationStageIds.length) return false
  const seen = new Set<string>()
  for (const stage of value.stages) {
    if (!isRecord(stage)) return false
    if (typeof stage.id !== 'string' || !generationStageIds.has(stage.id) || seen.has(stage.id)) return false
    seen.add(stage.id)
    if (typeof stage.state !== 'string' || !generationStageStates.has(stage.state)) return false
    if (stage.startedAt !== undefined && !isInstant(stage.startedAt)) return false
    if (stage.finishedAt !== undefined && !isInstant(stage.finishedAt)) return false
    if (stage.durationMs !== undefined && !(typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) && stage.durationMs >= 0)) return false
    if (stage.failureCode !== undefined && !isBoundedText(stage.failureCode, 200)) return false
    if (stage.failureDetail !== undefined && !isBoundedText(stage.failureDetail, 2_000)) return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

/** The document crosses IPC; reject an oversized payload before it is stored or rendered. */
export function isDailyBriefingDocumentWithinBudget(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= dailyBriefingPolicy.maximumBytes
  } catch {
    return false
  }
}
