import type {
  BriefingGenerationTrace,
  DailyBriefingAttemptRecord,
  DailyBriefingDocument,
  DailyBriefingListResult,
  DailyBriefingLocale,
  DailyBriefingProgressResult
} from '../../../contracts/dailyBriefing'
import type {
  DailyBriefingPeriodKind,
  DailyBriefingRunTrigger
} from '../../../contracts/dailyBriefing'
import type { BriefingPublishOutcome } from './dailyBriefingPublishToPhone'
import type { DailyBriefingRegenerateInput } from './dailyBriefingRegenerate'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefingFactSnapshot } from './dailyBriefingFactSnapshot'
import type { DailyBriefingGetResult } from './dailyBriefingReads'
import type { DailyBriefingAttemptEnd, DailyBriefingAttemptStart } from './dailyBriefingAttemptJournal'
import type { BriefingAttemptRunStore, BriefingEditionSlotStore } from './dailyBriefingEditionSlot'
import type { DailyBriefingDeleteAuditWriter } from './dailyBriefingPeriodDeletion'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import type { DailyBriefingZoneSource } from './dailyBriefingWindow'

/**
 * 简报服务对外承诺的形状：存储、来源、运行结果、服务接口与预算。
 *
 * 从 `dailyBriefingService` 抽出来（那个文件越过 500 行软上限）：这里全是类型与纯常量，
 * 没有一次读取、没有时钟、没有编排；编排本身留在 service。原文件继续 re-export，调用点不搬。
 */

/** What a generation needs from the reader's schedule setting. */
export type DailyBriefingGeneration = Pick<DailyBriefingGenerationSettings, 'generationTime' | 'windowHours'>

/** The stored shape. The store owns the file; the service owns when a row is written. */
export type DailyBriefingStoredEdition = Readonly<{
  date: string
  /** Which issue of that day this edition is; absent means the only one, `default`. */
  periodId?: string
  locale: DailyBriefingLocale
  generatedAt: string
  windowStart: string
  windowEnd: string
  document: DailyBriefingDocument
}>

/** An attempt is opened when the work starts, so an interrupted run is still a row. */

/** The same row, settled. It is updated in place, never deleted: the attempt is history. */

/**
 * A period's run: one per day, issue **and language**, holding what the editions of that run were
 * written from. The language is part of the identity because two languages of one issue produce
 * two runs; sharing one row made the second overwrite the first (0.4.2 #18).
 */
export type DailyBriefingPeriodRun = Readonly<{
  date: string
  periodId: string
  /** 旧形状（v3，迁移没跑成）读出来是 `unknown`；坏数据兜底，正常写入永远是一个具体语言。 */
  locale: DailyBriefingLocale | 'unknown'
  expectedLocales: readonly DailyBriefingLocale[]
  primaryRequested: string
  primaryUsed: DailyBriefingLocale
  fallbackReason?: string
  snapshotId: string
  snapshotHash: string
  contentVersion: number
  writingRounds: number
  /** The data layer's verdict; the writing may not call the opposite one. */
  direction: import('../../../contracts/marketAnalysisContracts').AnalysisConclusionDirection
  /** The ordered row ids both editions of this run must carry. */
  editionRows: readonly string[]
  state: 'running' | 'published' | 'partial' | 'failed'
  startedAt: string
  finishedAt?: string
}>

export type DailyBriefingStorageState = Readonly<
  | { state: 'ready' }
  | { state: 'incomplete'; reason: 'backup-failed' | 'migration-failed' }
>

/** What the page shows when the storage upgrade could not run, and the way to try once more. */
export type DailyBriefingStorageSurface = Readonly<{
  getState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
}>

export type DailyBriefingStore = BriefingEditionSlotStore & BriefingAttemptRunStore & Readonly<{
  /** `periodId` defaults to the single issue `default`, so existing callers read their row. */
  get: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<DailyBriefingStoredEdition | undefined>
  /** 哪个期已经占住 (日期, 截止, 语言) 这个槽（见 `briefingEditionSlotPeriodId`）。 */
  put: (edition: DailyBriefingStoredEdition) => Promise<void>
  list: (from: string, to: string, locale: DailyBriefingLocale) => Promise<readonly DailyBriefingStoredEdition[]>
  prune: (beforeDate: string) => Promise<void>
  /**
   * 海报的表与清理（`briefing_posters`）。仓储层装配它，清理只在 `prune` / `deletePeriod` 两处跟。
   * 可选：没有海报存储的装配（旧测试、纯内存替身）照旧工作。
   */
  posters?: import('./briefingPosterStore').BriefingPosterStore
  /**
   * Opens a row in state `running` and returns its attempt number. The number is allocated here and
   * nowhere else; a session link only refers to it.
   */
  beginAttempt?: (attempt: DailyBriefingAttemptStart) => Promise<number>
  finishAttempt?: (attempt: DailyBriefingAttemptEnd) => Promise<void>
  /** The newest attempt of that edition, whatever its state; a stored trace when it has one. */
  getAttempt?: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<BriefingGenerationTrace | undefined>
  /**
   * The tombstone: the trace is cleared and `cleanedAt` written, the row stays. Returns the number
   * of rows changed — `0` means the row is already gone (pruned), which is not a failure. A real
   * write error throws: the caller keeps the session link as its retry anchor and would otherwise
   * never know the tombstone was never written. `null` is the third answer: the database has not
   * been upgraded, so it cannot hold a tombstone yet — the row is still there and the caller must
   * keep the link and try again later, not treat it as "the row is gone".
   */
  markAttemptCleaned?: (input: Readonly<{
    editionDate: string
    /** Required: without it the update could land on another issue's attempt of the same day. */
    periodId: string
    locale: DailyBriefingLocale
    attemptNo?: number
    cleanedAt: string
  }>) => Promise<number | null>
  /** Every attempt of that edition, newest first; the history rail expands this list. */
  listAttempts?: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<readonly DailyBriefingAttemptRecord[]>
  /** The run of that period and language, holding the frozen facts its edition was written from. */
  getPeriodRun?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<DailyBriefingPeriodRun | undefined>
  /**
   * Every run of a date range. The list needs this to show a period whose run wrote no edition at
   * all (still generating, failed, or interrupted): edition rows are what name a period id, so a
   * period that never published cannot be found by iterating rows.
   */
  listPeriodRuns?: (from: string, to: string) => Promise<readonly DailyBriefingPeriodRun[]>
  /** Writes the first run of a period; a second call for the same period keeps the first facts. */
  openPeriodRun?: (run: DailyBriefingPeriodRun) => Promise<void>
  settlePeriodRun?: (run: Readonly<{
    date: string
    periodId: string
    /** 结算必须点名语言：否则会改到另一语言那一行（0.4.2 #18）。 */
    locale: DailyBriefingLocale
    state: 'published' | 'partial' | 'failed'
    finishedAt: string
    writingRounds?: number
  }>) => Promise<void>
  /** The edition row and the attempt that wrote it, in one transaction: never one without the other. */
  publishEdition?: (edition: DailyBriefingStoredEdition, attempt?: DailyBriefingAttemptEnd) => Promise<void>
  /**
   * Deletes one issue of one day: every language's edition, every attempt, and the period run — the
   * three tables of this database, in one transaction. Returns the row count of each; a date that
   * was already deleted returns zeros instead of throwing, so the caller can simply retry.
   */
  deletePeriod?: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<Readonly<{ editions: number; attempts: number; periodRuns: number }>>
  /**
   * 读者删过这一行没有（`(日期, 期号, 语言)`，只认成功那次）。
   *
   * 补跑要问它：删完之后「今天已过点 + 零 attempt + 零版次」三条全成立，不认这条的话，读者删掉的
   * 那一期下次启动就被补跑又生成回来，他会以为删除没生效（用户 2026-11-06）。
   */
  wasEditionDeleted?: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<boolean>
  /** 「删除这一版」的操作记录：只记录、不还原（用户 2026-11-06）。 */
  recordDeleteAudit?: DailyBriefingDeleteAuditWriter
  /** Whether the storage upgrade ran; `incomplete` means the old shape is still in use. */
  upgradeState?: () => DailyBriefingStorageState
  retryUpgrade?: () => Promise<DailyBriefingStorageState>
}>

/**
 * Two steps on purpose: the facts are read once and frozen, then each language renders its own
 * packet from them. A source that fetched per language would let two editions of one period read
 * different numbers, which is the thing this release exists to prevent.
 */
export type DailyBriefingSource = Readonly<{
  /** `asOf` = 读数那一刻（运行时刻）；`windowEnd` = 这一版的统计截止。缺省时两者相同。 */
  readFacts: (input: Readonly<{ asOf: string; windowEnd?: string; windowHours?: number; periodId?: string }>) => Promise<DailyBriefingFactSnapshot>
  renderPacket: (facts: DailyBriefingFactSnapshot, locale: DailyBriefingLocale, timeZone: string) => Promise<DailyBriefingFactPacket>
}>

export type DailyBriefingTodayFailureCode =
  | 'time-invalid' | 'source-failed' | 'build-failed' | 'candidate-overflow' | 'store-failed'
  | 'attempt-not-recorded' | 'run-timeout' // attempt row refused; the caller gave up waiting.
  // 写作没出来（用户 2026-11-06 拍板）：不再发布模板版，失败码就是编辑失败的原因码本身，
  // 页面据此说清"AI 超时 / 输出不合规"等，而不是笼统一句"失败"。
  | 'editorial-timeout' | 'editorial-disabled' | 'editorial-fallback' | 'invalid-shape'
  | 'unknown-fact' | 'unknown-number' | 'forbidden-content' | 'too-long' | 'language-mismatch'
  | 'model-not-ready' | 'provider-disabled' | 'missing-api-key' | 'cancelled' | 'rate-limited'
  | 'provider-error' | 'invalid-json' | 'schema-validation-failed' | 'invalid-translation'
  | 'agent-turn-output-truncated' | 'direction-conflict' | 'row-set-mismatch' | 'model-unavailable' | 'date-out-of-window'
  | 'run-interrupted' | 'invalid-output-language' // 后者：读者能看到的文字不是本期语言，重写仍不合规。
  | 'not-generated' // 不是失败：只读打开时还没写过这一期。


export type DailyBriefingTodayResult =
  | Readonly<{
    state: 'available'
    document: DailyBriefingDocument
    /**
     * Which zone produced this edition's window. `system` means the reader's setting was empty or
     * invalid and the machine's zone stood in — the caller must say so on screen, because the day may
     * differ from the one the reader configured.
     */
    timeZoneSource?: DailyBriefingZoneSource
  }>
  | Readonly<{
    state: 'unavailable'
    /**
     * `candidate-overflow`: one class held more candidates than the policy budget, so nothing was
     * generated or stored. `store-failed`: the edition was built but not persisted, so it is not
     * returned as if it were today's stored edition.
     */
    failureCode: DailyBriefingTodayFailureCode
    /** The failed attempt's stages; persisted beside the edition key so a refresh keeps them. */
    generationTrace?: BriefingGenerationTrace
  }>

export type { DailyBriefingGetResult } from './dailyBriefingReads'

export type DailyBriefingListResultView =
  | Readonly<{ state: 'available'; result: DailyBriefingListResult }>
  | Readonly<{ state: 'unavailable'; failureCode: 'time-invalid' }>

/**
 * The attempts of one edition. A read that failed is its own answer: an empty list would say "no
 * attempts", which is the opposite of what a failed read tells the reader.
 */
export type DailyBriefingAttemptsResult = Readonly<
  | { state: 'available'; attempts: readonly DailyBriefingAttemptRecord[] }
  | { state: 'unavailable'; failureCode: 'attempts-unreadable' }
>

export type DailyBriefingService = Readonly<{
  /** One named period's edition when the scheduler says which fired; unscheduled callers mean `default`. */
  getToday: (input: Readonly<{
    locale: DailyBriefingLocale
    timeZone: string
    periodId?: string
    generation?: DailyBriefingGeneration
    /** Which kind of period this run belongs to; absent means the scheduled one. */
    periodKind?: DailyBriefingPeriodKind
    /** Why the run happened; absent means the schedule fired it. */
    runTrigger?: DailyBriefingRunTrigger
    /** `false` opens the page as a read; no run. */
    generate?: boolean
    /** 调用方的中止信号：job 被停/应用正在关闭时不再起第二次（自动重试的活体判定）。 */
    signal?: AbortSignal
  }>) => Promise<DailyBriefingTodayResult>
  /**
   * 手动生成/重新生成**一次**。
   *
   * `periodId` 与 `generation` 是可选的：不带就是"这一期按排期跑"（旧调用点原来的意思）；带上
   * `generation.asOf` 就是读者在弹框里选定的一次性截止时刻——**只影响这一次运行**，不写回任何期
   * 配置（写回去就会污染列表，那正是"每次手动生成都多一条排期"的来源）。
   */
  regenerate: (input: DailyBriefingRegenerateInput) => Promise<DailyBriefingTodayResult>
  /** `withPoster` = 本次请求带了海报（路由只看这个意图，不看暂存区里有什么）。 */
  publishToPhone: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string; withPoster?: boolean }>) => Promise<BriefingPublishOutcome>
  list: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingListResultView>
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingGetResult>
  listAttempts: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingAttemptsResult>
  /** 读者删过这一行没有（只认成功那次）：补跑据此不再把删掉的那期生成回来。 */
  wasEditionDeleted: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => Promise<boolean>
  /**
   * Where the attempt that is running right now has got to.
   *
   * Reads the live snapshot only; a finished attempt is never reported here, because its trace
   * already travels with the result or with the stored edition. One attempt, one owner.
   */
  getProgress: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string; periodId?: string }>) => Promise<DailyBriefingProgressResult>
  /** Which table shape the store is on, and a way to retry an upgrade that did not finish. */
  getStorageState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
}>

/**
 * Wall-clock budget for one editorial generation, measured from the first agent round to the last
 * repair. One generation is up to five rounds (select, field answer, write, two repairs), and the
 * platform caps every single round at `DEFAULT_AGENT_TURN_TIMEOUT_MS` (120 s), so a smaller budget
 * would guarantee a timeout on any edition that needs more than the select round. Five minutes is
 * the ceiling the acceptance criteria promise the reader; a generation that cannot make it fails
 * with `editorial-timeout` and its session is abandoned instead of running on.
 */
export const DAILY_BRIEF_GENERATION_BUDGET_MS = 300_000


/**
 * The deterministic core-fact pass runs after the packet/document is built and before any model
 * call. It is bounded because it may touch a provider's history: a slow reader leaves the gaps for
 * the Agent protocol instead of holding the whole generation hostage.
 */
export const DAILY_BRIEF_FACT_ENSURE_BUDGET_MS = 20_000

/** The service contract for the deterministic pass; the module binds it to the shared ensure. */
export type DailyBriefCoreFactEnsure = (
  input: Readonly<{ document: DailyBriefingDocument; cutoff: string }>
) => Promise<DailyBriefingDocument>

