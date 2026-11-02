import type { AnalysisConclusionDirection } from './marketAnalysisContracts'

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
  BriefingNewsPolarity,
  BriefingNewsItem,
  BriefingMacroItem,
  BriefingNextRelevanceRole,
  BriefingNextRelevance,
  BriefingNextItem,
} from './dailyBriefing/readings'

export { briefingCadencePolicy, briefingNextRelevanceRoles }
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

// The IPC guards live in their own module; re-exported so callers keep one import path.
export { isDailyBriefingLocale, isDailyBriefingEditionDate, isDailyBriefingReadingState, isFactImportanceTier, isBriefingGenerationTrace, isDailyBriefingDocumentWithinBudget } from './dailyBriefing/guards'
