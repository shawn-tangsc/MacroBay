/**
 * One row of the data-sync run record: what ran, when, against which source, and how it ended.
 *
 * P0 reads the platform's own job runs. They are the only place a failed collection leaves a trace
 * today, and nothing in the product was reading them — which is why a source could look enabled while
 * every collection was skipped.
 */
export const SYNC_RUN_IPC_METHODS = {
  list: 'intelligence.syncRuns.list',
  aggregates: 'intelligence.syncRuns.aggregates'
} as const

/**
 * How far back the daily summary reaches.
 *
 * Run details survive 30 days; only the per-day counts outlive them. A year is the largest window
 * a reader can still act on, and it keeps the answer bounded.
 */
export const SYNC_RUN_AGGREGATE_DAYS = 365

/** Why the daily summary cannot be answered at all. Never rendered as an empty history. */
export type SyncRunAggregateUnavailableReason =
  | 'memory-store-has-no-aggregates'
  | 'aggregates-unavailable'

/** One UTC day of one task, kept after its run details were dropped. */
export type SyncRunDailyRow = Readonly<{
  /** UTC day, `YYYY-MM-DD`. */
  day: string
  handlerId: string
  taskLabel: string
  runs: number
  failures: number
}>

export type SyncRunAggregateResult =
  | Readonly<{ state: 'available'; rows: readonly SyncRunDailyRow[] }>
  | Readonly<{ state: 'unavailable'; reason: SyncRunAggregateUnavailableReason; rows: readonly SyncRunDailyRow[] }>

/** Half-open UTC day window `[fromDay, toDay)`, one year back through tomorrow. */
export function syncRunAggregateDayWindow(nowMs: number): Readonly<{ fromDay: string; toDay: string }> {
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  return { fromDay: day(nowMs - SYNC_RUN_AGGREGATE_DAYS * 86_400_000), toDay: day(nowMs + 86_400_000) }
}

export type SyncRunAction = 'collect' | 'refresh' | 'analysis' | 'configure' | 'test' | 'import' | 'other'
export type SyncRunOutcome = 'succeeded' | 'failed' | 'cancelled' | 'running'
export type SyncRunWindow = '24h' | '7d' | 'all'

export type SyncRunRow = Readonly<{
  /** `completed_at`, else `started_at`, else `created_at`. */
  at: string
  runId: string
  /** The job that ran, in the reader's language ("AI 分析", "官方日历排期"). */
  taskLabel: string
  /**
   * The sources this run touched, from its own payload.
   *
   * One task can serve many sources (`collectSource` runs once per source) and one source is read by
   * several tasks, so a single source column would be a lie either way.
   */
  sources: readonly Readonly<{ sourceId: string; label: string }>[]
  handlerId: string
  action: SyncRunAction
  /** `runId` for job rows, a generated id for product-side actions; the key that ties a chain. */
  correlationId: string
  outcome: SyncRunOutcome
  /**
   * The analysis side of this run, when the task produces one.
   *
   * Task success and analysis success are different facts: an analysis job is `completed` even when
   * the analysis itself was rejected, so this is a second column, never a refinement of `outcome`.
   */
  analysis: SyncRunAnalysis
  durationMs?: number
  /**
   * What this batch concluded, in numbers rather than a sentence: how many items were attempted and
   * how each one ended. `outcome` above answers "did the job finish"; this answers "did the work
   * inside it land", and they are different facts — a completed translation batch can have five
   * failures.
   *
   * Absent on runs that predate the field and on tasks that do not count items; the page must show
   * nothing rather than zeroes, because "no tally" and "zero words translated" are different facts.
   */
  counts?: SyncRunCounts
  /** The stable code behind the tally, when the batch recorded why it ended that way. */
  resultReasonCode?: string
  /** The stable code a failure carries, when one can be read out of the error text. */
  failureCode?: string
  detail?: string
}>

/** Per-batch tally: totals that add up, so "partly failed" is arithmetic, not a phrase. */
export type SyncRunCounts = Readonly<{ total: number; succeeded: number; failed: number; skipped: number }>

/** One analysis run, as much as the run log needs to answer "did this produce anything". */
export type SyncRunAnalysisResult = Readonly<{
  runId: string
  state: 'queued' | 'running' | 'succeeded' | 'invalid-output' | 'failed' | 'cancelled' | 'stale' | 'superseded'
  /**
   * Both codes travel with the record and are shown only when the reader opens it: the visible
   * sentence is copy, the code is diagnosis.
   */
  failureCode?: string
  failureDetailCode?: string
  startedAt?: string
  completedAt?: string
  modelProviderId?: string
  modelId?: string
}>

/**
 * The answers for the analysis column, and why each is distinct.
 *
 * `not-applicable` — the task never produces an analysis (a collector, a translation).
 * `unlinked` — it does produce one, but no analysis run can be tied to this task run. That is a
 * fact, not a blank: drawing it as `—` or as a zero would hide a missing link.
 * `unavailable` — the record did not say. "We could not read it" is not "there is none".
 */
export type SyncRunAnalysis =
  | Readonly<{ state: 'not-applicable' }>
  | Readonly<{ state: 'unlinked' }>
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{ state: 'linked'; result: SyncRunAnalysisResult }>

/** One product-side action: a switch, a connection test, a manual refresh, an import. */
export type SyncAuditEntry = Readonly<{
  id: string
  at: string
  actor: 'schedule' | 'user' | 'agent' | 'startup'
  action: Exclude<SyncRunAction, 'analysis' | 'other'>
  target: string
  outcome: SyncRunOutcome
  failureCode?: string
  durationMs?: number
  detail?: string
}>

export type SyncRunQuery = Readonly<{
  window: SyncRunWindow
  sourceId?: string
  /**
   * 把任务筛**交给服务端**：翻译一天 45 次、采集每 17 秒一条，先取最新 500 条再在客户端按任务
   * 过滤，稀疏任务永远沉底——补了字段也看不见。
   */
  handlerId?: string
  outcome?: SyncRunOutcome
  limit: number
  /**
   * A notification's target: the analysis run it points at.
   *
   * When present the read also returns the task row that produced that analysis, even when it is
   * older than the newest `limit` runs — otherwise a link clicked an hour later would report "not
   * found" about a record that exists.
   */
  analysisRunId?: string
}>

/** The only definition of what an analysis run id looks like (`mi-ar-` + uuid). */
const ANALYSIS_RUN_ID = /^mi-ar-[0-9A-Za-z-]{1,80}$/

export function isAnalysisRunId(value: string): boolean {
  return ANALYSIS_RUN_ID.test(value)
}

export type SyncRunResult =
  | Readonly<{
    state: 'available'
    rows: readonly SyncRunRow[]
    /**
     * 窗口里还有没取回来的记录（触到装载上限时）。
     *
     * 页面上必须把它说出来——**「已经取了多少」和「窗口里一共有多少」是两件事**，
     * 少说一句就是又一次「标签 24 小时、实际只给一段」。
     */
    truncated?: boolean
  }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

/** 一次读取最多装载多少条：再往上就是「页面不是翻页器」，要换形态而不是继续加。 */
export const SYNC_RUN_LOAD_CAP = 20_000

export const SYNC_RUN_LIMITS = {
  defaultLimit: 200,
  maximumLimit: 500,
  /** Truncated error text; the full line stays in `job_runs`. */
  detailMaxLength: 160,
  windowMs: { '24h': 24 * 60 * 60 * 1_000, '7d': 7 * 24 * 60 * 60 * 1_000 }
} as const

/** One CSV, built from the rows on screen, so an export never disagrees with the table. */
export function syncRunsCsv(rows: readonly SyncRunRow[], header: readonly string[]): string {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return [header.map(escape).join(','), ...rows.map((row) => [
    row.at, row.taskLabel, row.sources.map((source) => source.label).join(' / '), row.action, row.outcome,
    row.durationMs === undefined ? '' : String(row.durationMs),
    row.failureCode ?? '', row.correlationId, row.detail ?? ''
  ].map(escape).join(','))].join('\n')
}
