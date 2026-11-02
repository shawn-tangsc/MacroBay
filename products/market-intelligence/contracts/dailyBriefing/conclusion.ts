/**
 * The brief's conclusion shapes and its generation trace.
 *
 * The verdict a reader sees (what it rests on, what would falsify it, how it compares with the
 * previous edition) plus the stage record of how the edition was produced. Kept apart from the
 * reading rows, which never carry a judgment.
 */

import type { AnalysisConclusionDirection } from '../marketAnalysisContracts'
import type { DailyBriefingLocale } from './readings'

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

/** Where a conclusion the daily brief may synthesize came from. */
export type BriefingPriorConclusionSource = 'analysis' | 'daily-brief'

export type BriefingPriorConclusionConfidence = 'high' | 'medium' | 'low' | 'unknown'

/**
 * One earlier AI conclusion inside the edition's window.
 *
 * This is a *claim*, never a fact: the editor may compare, weigh and quote it, but its numbers and
 * assertions are not evidence. `observedAt` is when it was published and `asOf` the instant its own
 * evidence chain was frozen, so a conclusion written after the window can never enter it.
 */
export type BriefingPriorConclusion = Readonly<{
  id: string
  source: BriefingPriorConclusionSource
  observedAt: string
  asOf: string
  direction: AnalysisConclusionDirection
  confidence: BriefingPriorConclusionConfidence
  summary: string
  rationale?: string
  evidenceRefs: readonly string[]
}>

/**
 * The structured synthesis the editorial model writes over the window's prior conclusions.
 *
 * `direction` is the editor's own verdict after weighing them; `summary` must carry the mechanism
 * chain and the forward view, not a recap. `outlook`, `conditions`, `counterEvidence` and `watch`
 * make the next-1-3-day base case auditable: what must hold, what would falsify it, and which
 * observable catalysts decide it. The fact-layer conclusion's own conditions are never reused.
 */
export type BriefingConclusionSynthesis = Readonly<{
  direction: AnalysisConclusionDirection
  confidence: 'high' | 'medium' | 'low'
  /** Mechanism chain plus the next-1-3-day base case; must be forward-looking prose. */
  summary: string
  /** The base case for the next 1-3 days: explicit bias and BTC-vs-ETH relative strength. */
  outlook: string
  /** Premises the base case needs to hold; derived from this forecast, never the old analysis. */
  conditions: readonly string[]
  /** Falsifiers: the observable conditions that would prove this forecast wrong. */
  counterEvidence: readonly string[]
  /** Catalysts and indicators to watch, each carrying a FACTS display value. */
  watch: readonly string[]
  regimeChange: string
  confirmed: readonly string[]
  refuted: readonly string[]
  coreTension: string
  /** The single clearest observable threshold that would overturn the base case. */
  whatWouldChange: string
  /** Frozen document fact ids (news:/macro:/data:) this synthesis stands on. */
  evidenceRefs: readonly string[]
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
  /** How this conclusion was produced. `agent` means the editorial model synthesized the window's
   * prior conclusions; `fallback` means the fact-layer conclusion stands because no synthesis ran.
   * Absent on editions generated before synthesis existed (those copied the analysis conclusion). */
  synthesis?: 'agent' | 'fallback'
  /** Prior conclusion ids the synthesis weighed, oldest first. Absent for the fact-layer fallback. */
  synthesizedFrom?: readonly string[]
  /** Present only when `synthesis` is `agent`. */
  synthesisDetail?: BriefingConclusionSynthesis
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


/** The fixed generation stages, in the order a successful generation runs them. */
export const briefingGenerationStageIds = [
  'source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation', 'repair-1', 'repair-2', 'store'
] as const

/**
 * How those fixed stages are shown as rows, in the order a reader reads them.
 *
 * The two repair rounds share one row on purpose: what a reader needs to know is whether the
 * conclusion was rewritten and how many rounds it took, not that the pipeline splits a rewrite into
 * two internal steps. The mapping lives here, and only here — a page that folds two stages itself
 * would be computing the same fact a second time.
 */
export const briefingGenerationDisplayRows = [
  { id: 'source', stages: ['source'] },
  { id: 'candidates', stages: ['candidates'] },
  { id: 'selection', stages: ['selection'] },
  { id: 'field-backfill', stages: ['field-backfill'] },
  { id: 'writing', stages: ['writing'] },
  { id: 'validation', stages: ['validation'] },
  { id: 'repair', stages: ['repair-1', 'repair-2'] },
  { id: 'store', stages: ['store'] }
] as const

export type BriefingGenerationDisplayRowId = (typeof briefingGenerationDisplayRows)[number]['id']

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

/**
 * A generation attempt that is still running.
 *
 * Deliberately not a `BriefingGenerationTrace`: that shape claims a finished attempt (it has
 * `finishedAt` and a terminal state), and a live one must not say a stage was skipped merely
 * because it has not begun yet. Unstarted stages stay `pending` here.
 */
export type BriefingGenerationProgress = Readonly<{
  attemptId: string
  startedAt: string
  stages: readonly BriefingGenerationStage[]
}>

/**
 * What the reader can ask about the attempt that is running right now.
 *
 * `idle` also covers "an attempt just finished": once it completes its trace travels with the
 * result or the stored edition, and the live copy is dropped, so there is never a second version
 * of the same attempt to disagree with the stored one.
 */
export type DailyBriefingProgressResult = Readonly<
  | { state: 'idle' }
  | { state: 'running'; progress: BriefingGenerationProgress }
>

/** One row in the history rail. `missing` rows are gaps, not empty editions. */
