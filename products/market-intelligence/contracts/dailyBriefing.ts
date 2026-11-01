import type { AnalysisConclusionDirection } from './marketAnalysisContracts'

// The policy numbers live in their own module; they are re-exported here so every caller keeps
// importing this one path, and a schema change cannot ride along with a budget change.
import { dailyBriefingPolicy } from './dailyBriefing/policies'

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
import { briefingGenerationStageIds } from './dailyBriefing/conclusion'
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
} from './dailyBriefing/conclusion'

export { briefingGenerationStageIds }
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
