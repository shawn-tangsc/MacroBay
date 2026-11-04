import type { AnalysisConclusionDirection } from './marketAnalysisContracts'
// The policy-path buckets are the same five names the policy block, the drawer and the edition share;
// one vocabulary, so a stored distribution cannot drift from the one the dial is drawn from.
import type { PolicyPathDistribution } from './policyPath'

// The policy numbers live in their own module; they are re-exported here so every caller keeps
// importing this one path, and a schema change cannot ride along with a budget change.
import { dailyBriefingPolicy } from './dailyBriefing/policies'

/**
 * The one issue a reader has before the period list exists. Old rows and new writes share this
 * literal so a migrated edition is found by the same call that finds a fresh one.
 */
export const DEFAULT_PERIOD_ID = 'default'

export {
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes,
  dailyBriefingPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours,
  type DailyBriefingWindowHours
} from './dailyBriefing/policies'

// The reading vocabulary lives in its own module; re-exported so callers keep one import path.
import { briefingCadencePolicy, briefingNextRelevanceRoles } from './dailyBriefing/readings'
import type {
  DailyBriefingLocale,
  DailyBriefLedePattern,
  DailyBriefingDocumentSchemaVersion,
  DailyBriefingPolicyVersion,
  DailyBriefingReadingId,
  DailyBriefingReadingState,
  FactImportanceTier,
  FactImportanceSource,
  FactImportanceReason,
  FactImportance,
  BriefingMaterialityCode,
  BriefingMateriality,
  BriefingDataVisibility,
  BriefingRowCadence,
  BriefingValueFormat,
  BriefingChangeUnit,
  BriefingWindow,
  BriefingRowChange,
  BriefingMarketRow,
  BriefingPulseRow,
  BriefingSeriesPoint,
  BriefingCurvePoint,
  BriefingCurveSegment,
  BriefingCurveReason,
  BriefingAmplitude,
  BriefingAmplitudeReason,
  BriefingNewsPolarity,
  BriefingNewsItem,
  BriefingMacroItem,
  BriefingNextRelevanceRole,
  BriefingNextRelevance,
  BriefingNextItem,
} from './dailyBriefing/readings'

export { briefingCadencePolicy, briefingNextRelevanceRoles }
export { editionNewsTitle } from './dailyBriefing/readings'
export type {
  DailyBriefingLocale,
  DailyBriefLedePattern,
  DailyBriefingDocumentSchemaVersion,
  DailyBriefingPolicyVersion,
  DailyBriefingReadingId,
  DailyBriefingReadingState,
  FactImportanceTier,
  FactImportanceSource,
  FactImportanceReason,
  FactImportance,
  BriefingMaterialityCode,
  BriefingMateriality,
  BriefingDataVisibility,
  BriefingRowCadence,
  BriefingValueFormat,
  BriefingChangeUnit,
  BriefingWindow,
  BriefingRowChange,
  BriefingMarketRow,
  BriefingPulseRow,
  BriefingSeriesPoint,
  BriefingCurvePoint,
  BriefingCurveSegment,
  BriefingCurveReason,
  BriefingAmplitude,
  BriefingAmplitudeReason,
  BriefingNewsPolarity,
  BriefingNewsItem,
  BriefingMacroItem,
  BriefingNextRelevanceRole,
  BriefingNextRelevance,
  BriefingNextItem,
} from './dailyBriefing/readings'
// The conclusion and trace shapes live in their own module; re-exported so callers keep one path.
import { briefingGenerationDisplayRows, briefingGenerationStageIds } from './dailyBriefing/conclusion'
import type {
  BriefingCounterEvidence,
  BriefingTopSignal,
  BriefingPriorConclusionSource,
  BriefingPriorConclusionConfidence,
  BriefingPriorConclusion,
  BriefingConclusionSynthesis,
  BriefingConclusion,
  BriefingNewsSummary,
  BriefingComparison,
  BriefingGenerationStageId,
  BriefingGenerationStageState,
  BriefingGenerationStage,
  BriefingGenerationTrace,
  BriefingGenerationProgress,
  BriefingGenerationWaiting,
  BriefingGenerationDisplayRowId,
  DailyBriefingProgressResult,
} from './dailyBriefing/conclusion'

export { briefingGenerationDisplayRows, briefingGenerationStageIds }
export type {
  BriefingCounterEvidence,
  BriefingTopSignal,
  BriefingPriorConclusionSource,
  BriefingPriorConclusionConfidence,
  BriefingPriorConclusion,
  BriefingConclusionSynthesis,
  BriefingConclusion,
  BriefingNewsSummary,
  BriefingComparison,
  BriefingGenerationStageId,
  BriefingGenerationStageState,
  BriefingGenerationStage,
  BriefingGenerationTrace,
  BriefingGenerationProgress,
  BriefingGenerationWaiting,
  BriefingGenerationDisplayRowId,
  DailyBriefingProgressResult,
} from './dailyBriefing/conclusion'
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
      /**
       * All five priced buckets at the leading outcome's instant, normalized to sum to one. The dial
       * needs the shares beside the lead probability; a single number cannot say what the rest is
       * priced at. Absent on editions built before schema 10, and whenever the venue did not publish
       * a complete distribution.
       */
      distribution?: PolicyPathDistribution
      /** Probability change against the previous edition, in percentage points. */
      probabilityChangePp?: number
      materiality?: BriefingMateriality
      visibility?: BriefingDataVisibility
      visibilityReason?: string
    }>
    leverage?: Readonly<{
      state: 'available' | 'stale' | 'unavailable'
      observedAt?: string
      btc: Readonly<{
        fundingRate?: number
        openInterestUsd?: number
        change1hPct?: number
        change24hPct?: number
        /**
         * The 24-hour open interest series this card's change was measured on, thinned to at most 24
         * points. Absent on editions built before schema 10, when the read failed, and when fewer than
         * two points survived — the card's own state tells those apart.
         */
        series?: readonly BriefingSeriesPoint[]
      }>
      eth: Readonly<{
        fundingRate?: number
        openInterestUsd?: number
        change1hPct?: number
        change24hPct?: number
        /** See `btc.series`. */
        series?: readonly BriefingSeriesPoint[]
      }>
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
    /**
     * Data the builder had in hand and deliberately left out, with the reason.
     *
     * Not shown to the reader: it answers the question a reader cannot ask today and an engineer
     * cannot answer in three months — "was there no distribution, or did we refuse this one?".
     */
    dataAudit?: readonly BriefingDataAuditEntry[]
    /** Absent on editions generated before the stage trace existed. */
    generationTrace?: BriefingGenerationTrace
  }>
}>

/** One fact the builder dropped, and why. `field` names the document path it would have filled. */
export type BriefingDataAuditEntry = Readonly<{
  field: 'policyPath.distribution'
  /** `incomplete-distribution`: the venue did not price all five buckets. `inconsistent-totals`: it
   * did, but normalizing moved the lead bucket away from the probability the card prints. */
  reason: 'incomplete-distribution' | 'inconsistent-totals'
}>

export type DailyBriefingEditionSummary = Readonly<{
  date: string
  /** Which issue of that day this row is; one row per (date, period), languages switch in place. */
  periodId: string
  locale: DailyBriefingLocale
  availableLocales: readonly DailyBriefingLocale[]
  /** `partial`: this period was meant to have more versions than it published. */
  state: 'generated' | 'missing' | 'partial'
  /** What the run intended to publish; absent on rows written before the run record existed. */
  expectedLocales?: readonly DailyBriefingLocale[]
  /** How many writing attempts this edition has; the rail shows it as "N 次" next to the meta. */
  attemptCount?: number
  /** The scheduled generation time this period runs at; shown on a day that did not generate. */
  scheduledTime?: string
  generatedAt?: string
  direction?: AnalysisConclusionDirection
  summaryLine?: string
  readingsAvailable?: number
  windowEnd?: string
}>

export type DailyBriefingListResult = Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  /**
   * The issue day the list is built around — the same rule the service uses to open today's edition
   * (before the generation hour it is still the previous day). The page must not re-derive "today"
   * from the wall clock: two definitions make a past day look like today and vice versa.
   */
  today?: string
}>

/** One writing attempt of an edition, as the history rail lists it. */
export type DailyBriefingAttemptRecord = Readonly<{
  attemptNo: number
  state: 'running' | 'succeeded' | 'failed'
  failureCode?: string
  startedAt: string
  finishedAt?: string
  /** Set when the session behind this attempt was cleaned up; the row stays, its trace is gone. */
  cleanedAt?: string
}>

export { briefingCompleteness, type DailyBriefingCompleteness } from './dailyBriefing/completeness'

// The IPC guards live in their own module; re-exported so callers keep one import path.
export { isDailyBriefingLocale, isDailyBriefingEditionDate, isDailyBriefingReadingState, isFactImportanceTier, isBriefingGenerationTrace, isDailyBriefingDocumentWithinBudget } from './dailyBriefing/guards'
