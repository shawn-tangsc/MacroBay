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
  dailyBriefingGenerationGrid,
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
/** The two kinds of period an edition can come from; the row's label depends on it, not on a lookup. */
export type DailyBriefingPeriodKind = 'scheduled' | 'manual'

/**
 * Why this run happened. A catch-up or retry is what the list calls "补跑": the run record only
 * lives 14 days, so the fact has to travel with the edition or an old row would silently lose it.
 */
export type DailyBriefingRunTrigger = 'scheduled' | 'catch-up' | 'retry' | 'manual'

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
    /**
     * Which period of that day this edition belongs to. Opaque: created when the period is created,
     * never derived from a time, so changing the scheduled hour cannot detach an edition from its
     * own history. Absent on editions written before schema 13; those belong to `default`, and
     * `briefingEditionPeriod` is the one place that reads the fallback.
     */
    periodId?: string
    /**
     * The nominal cutoff of this edition (ISO milliseconds, same precision as `generatedAt`):
     * the configured generation time for a scheduled period, the chosen cutoff for a manual run.
     * Absent before schema 13; it then reads as `generatedAt`.
     */
    periodTime?: string
    /**
     * 这一版是**哪一刻读的数据**（`02` `A0.10`，用户 2026-11-05 定）。
     *
     * **规则：读数据永远用运行时刻，窗口仍按 `periodTime` 往前算。** 名字刻意不叫 `dataAsOf`：
     * 那个名字在本仓的旧口径里指"统计截止"，同一个名字两种含义会让旧版次被读成"它在截止那一刻读的"。
     * 一个名字只留一种含义——统计截止用 `periodTime` / `windowEnd`，读数时刻用 `readAt`。
     *
     * `generatedAs` 是这一版实际跑出来的时刻（与 `readAt` 同一个时钟，一次跑只取一次）；`isBackfill`
     * 说"这次跑明显晚于截止"（容差见 `BRIEFING_BACKFILL_TOLERANCE_MS`），准点生成不写它。
     * 旧文档没有这三个字段 = 当时按截止读的、且没说自己是补跑；渲染层对残骸**只少说一句时刻**。
     */
    readAt?: string
    isBackfill?: boolean
    /**
     * 旧名，**不再有写入方**：曾经被读作"这一版能看见哪一刻的世界"（往往就是统计截止）。留着是为了
     * 让旧文档按旧义读，绝不再写新值——读数时刻见 `readAt`。
     */
    dataAsOf?: string
    generatedAs?: string
    /** What kind of period produced this edition; absent before schema 13 reads as `scheduled`. */
    periodKind?: DailyBriefingPeriodKind
    /**
     * Why the run happened. Absent before schema 13, and then it reads as `scheduled` — those
     * editions recorded no such fact, and inventing "补跑" for them would be a claim nobody made.
     */
    runTrigger?: DailyBriefingRunTrigger
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
    /**
     * Why a section is empty, as a code the copy table resolves — never a sentence.
     *
     * `macroEmptyHours` travels beside `macroEmpty` because the stale sentence names how old the
     * calendar was (`A0.8`): the code alone says "stale", the number says how stale, and the number
     * can only come from the reading this edition judged.
     *
     * `macroEmptyCount` 同理：「有 N 条高影响事件、但截至这一刻还没拿到实际值」要念出 N，而 N 只能
     * 从这一版读到的窗口里数出来（`02` v2.120）。缺它就不许印那句话，而不是印一个没说清的 0。
     */
    notes: Readonly<{
      newsEmpty?: string
      macroEmpty?: string
      macroEmptyHours?: number
      /** 窗口内高影响事件总数（不看有没有实际值）——「事件优先」那一步的数（`A0.12`）。 */
      macroHighImpactCount?: number
      /** 其中**我们没拿到实际值**的条数：缺值不等于没发生，所以跟列表一起出现，不只在空态里说。 */
      macroHighImpactValuesMissing?: number
    }>
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

/**
 * The period identity of an edition, in one place.
 *
 * Editions written before schema 13 carry none of the three fields: they were the one fixed period
 * of their day, so they read back as `default`, their own `generatedAt`, and `scheduled` — which is
 * also what a deleted scheduled period still reads as, because its identity travels with the
 * edition rather than with a configuration row that may be gone. New editions carry what the builder
 * wrote; nothing here derives an id from a time.
 */
export function briefingEditionPeriod(edition: Readonly<{
  generatedAt: string
  periodId?: string
  periodTime?: string
  periodKind?: DailyBriefingPeriodKind
  runTrigger?: DailyBriefingRunTrigger
}>): Readonly<{ periodId: string; periodTime: string; periodKind: DailyBriefingPeriodKind; runTrigger: DailyBriefingRunTrigger }> {
  return Object.freeze({
    periodId: edition.periodId !== undefined && edition.periodId.length > 0 ? edition.periodId : 'default',
    periodTime: edition.periodTime ?? edition.generatedAt,
    periodKind: edition.periodKind ?? 'scheduled',
    runTrigger: edition.runTrigger ?? 'scheduled'
  })
}

/** One fact the builder dropped, and why. `field` names the document path it would have filled. */
export type BriefingDataAuditEntry = Readonly<{
  field: 'policyPath.distribution'
  /** `incomplete-distribution`: the venue did not price all five buckets. `inconsistent-totals`: it
   * did, but normalizing moved the lead bucket away from the probability the card prints. */
  reason: 'incomplete-distribution' | 'inconsistent-totals'
}>

/** One language of one period, as the list can offer it. */
export type DailyBriefingEditionLanguageState = 'published' | 'generating' | 'missing'

/**
 * Why a language has no edition to open. Closed on purpose: the rail prints the reason from this
 * code, it never infers one from the absence itself.
 */
export type DailyBriefingEditionLanguageReason =
  /** The run settled without this language (partial publication). */
  | 'not-published'
  /** A run is in flight right now, in this process. */
  | 'run-running'
  /** The run ended failed. */
  | 'run-failed'
  /** The run never finished: the process died and nothing is running now. Not the same as failed. */
  | 'run-interrupted'

export type DailyBriefingEditionLanguage = Readonly<{
  locale: DailyBriefingLocale
  state: DailyBriefingEditionLanguageState
  /** Present only when `state` is `missing`: the row says why, instead of leaving a bare grey chip. */
  reason?: DailyBriefingEditionLanguageReason
}>

export type DailyBriefingEditionSummary = Readonly<{
  date: string
  /** Which issue of that day this row is; one row per (date, period), languages switch in place. */
  periodId: string
  locale: DailyBriefingLocale
  availableLocales: readonly DailyBriefingLocale[]
  /**
   * The identity and schedule facts of the edition this row shows, copied from its document once by
   * the history projection. `periodTime` is the nominal cutoff (absent when nothing was generated);
   * `periodKind` and `runTrigger` default to `scheduled` for editions written before they existed.
   */
  periodTime?: string
  periodKind?: DailyBriefingPeriodKind
  runTrigger?: DailyBriefingRunTrigger
  windowHours?: number
  /**
   * Every language this period was meant to have, with what the list can offer for each — the single
   * place that decides "published / generating / missing". Absent only on summaries built by callers
   * outside the history projection.
   */
  languages?: readonly DailyBriefingEditionLanguage[]
  /** The period's configuration is gone; the row still reads, marked as a deleted period. */
  periodDeleted?: boolean
  /** The latest completed edition of its day (exactly one per day). */
  isCurrent?: boolean
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
  /**
   * 天头要画哪些日子（`02` v2.91）：有版次 ∨ 有过运行记录（任何状态）∨ 这一天是今天；仅"被排期
   * 覆盖"不算。可选：旧调用方不传时，列表退回"有天头的日子来自版次"的旧行为。
   */
  dates?: readonly string[]
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
