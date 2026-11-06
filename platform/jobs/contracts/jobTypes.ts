export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type JobTrigger =
  | { kind: 'manual' }
  | { kind: 'startup' }
  | { kind: 'interval'; intervalMs: number; anchor: 'lastStart' | 'lastComplete' }
  | { kind: 'cron'; expression: string; timezone?: string }
  | { kind: 'event'; topic: string }

export type RetryBackoff = 'none' | 'fixed' | 'exponential'

export type RetryPolicy = {
  maxAttempts: number
  backoff: RetryBackoff
  baseDelayMs: number
  maxDelayMs: number
}

export type JobOwner = 'platform' | 'product'

/**
 * 这条定义进不进用户看得见的那张表。
 *
 * `resource` = 用户能理解、能启用/停用的资源任务；`internal` = 平台自己维护的活（保留期清理、
 * 投递重试、状态巡检），用户既配置不了也停不了，出现在表里只会是一行需要解释的技术条目。
 */
import type { JobTitle, JobTitleParams } from '../runtime/jobTitle'

export type JobAudience = 'user' | 'internal'

export type JobDefinition<TPayload = unknown> = {
  id: string
  owner: JobOwner
  productId?: string
  handlerId: string
  title: JobTitle
  /** 标题里占位符的值（产品名/通道名）；值也可双语，渲染那一刻按语言取。 */
  titleParams?: JobTitleParams
  trigger: JobTrigger
  payload: TPayload
  concurrencyKey?: string
  timeoutMs?: number
  retryPolicy?: RetryPolicy
  redact?: (value: unknown) => unknown
}

/**
 * 注册进调度表的定义：`audience` 必填、无默认值。
 *
 * 不放在 `JobDefinition` 上，是因为一次性运行（`enqueueDefinition`）从不进表，给它们加一个
 * 必填字段只会逼出几十个没有意义的值；而 `setSchedule` 这一侧少写一个就编译不过。
 */
export type ScheduledJobDefinition<TPayload = unknown> = JobDefinition<TPayload> & {
  audience: JobAudience
}

export type JobLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type JobLogEntry = {
  at: string
  level: JobLogLevel
  message: string
  metadata?: Record<string, unknown>
}

export type JobProgress = {
  current: number
  total?: number
  message?: string
}

export type JobContext = {
  jobRunId: string
  signal: AbortSignal
  log: (entry: Omit<JobLogEntry, 'at'> & { at?: string }) => Promise<void>
  progress: (progress: JobProgress) => Promise<void>
}

/**
 * 一次运行的**结论**（跟进度是两件事）。
 *
 * 为什么要有它：运行记录原来只存状态、时间、错误与日志。读者问的却是「这批多少条、成了多少、
 * 失败几条、为什么」——那些数没有办法从自由日志里算出来，而「部分失败」若只能靠一句文案，
 * 统计页和行内显示就会各算一遍，明天必然对不上。
 *
 * 三条硬规则（由 `assertJobRunOutcome` 在写入前校验，不合格直接拒写，不做兜底）：
 * - **总数 = 成功 + 失败 + 跳过**：不相等就是写错了，宁可拒写也不要留下一个算不平的数；
 * - **`reasonCode` 只收枚举、不收句子**：自由文本无法聚合，一收就会有人对着日志数条数；
 *   六句人话由产品文案表映射，平台不理解含义；
 * - **语言之类的任务参数不进结果**：那是 payload 的事，平台不该认识「语言」这个概念。
 */
export type JobRunOutcome = {
  counts: { total: number; succeeded: number; failed: number; skipped: number }
  /** 产品侧稳定枚举（点分小写），例如 `model.timeout`。平台只校验形状。 */
  reasonCode?: string
}

export type JobCancelReasonKind = 'cancelled' | 'timeout' | 'shutdown'

export type JobCancelReason = {
  kind: JobCancelReasonKind
  message: string
}

export type JobHandler<TPayload = unknown> = (payload: TPayload, context: JobContext) => Promise<void>

export type JobRunRecord = {
  id: string
  definitionId: string
  handlerId: string
  owner: JobOwner
  productId?: string
  title: string
  status: JobStatus
  trigger: JobTrigger
  payload: unknown
  concurrencyKey?: string
  attempt: number
  maxAttempts: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  lastError?: string
  progress?: JobProgress
  /** 这一批的结论；旧记录没有这一格（那时只存进度，不存结果）。 */
  result?: JobRunOutcome
  logs: JobLogEntry[]
}

export type JobRunQuery = {
  owner?: JobOwner
  productId?: string
  statuses?: readonly JobStatus[]
  handlerId?: string
  definitionId?: string
  definitionIdPrefix?: string
  payload?: Record<string, unknown>
  /**
   * Half-open time window over `createdAt`: `createdFrom` is inclusive, `createdTo` is exclusive.
   *
   * Why it exists: a caller that asks for "the last 24 hours" and then filters an
   * already-capped page gets a silently narrower window than its label claims — 500 rows at
   * this product's write rate cover a few hours, not a day. Filtering in the store is the
   * only way the window can mean what the caller says.
   *
   * Both are ISO instants; the comparison is on `createdAt` (when the run was queued), not on
   * `startedAt`/`completedAt`. With `cursor`, the window applies first and the cursor must itself
   * fall inside the window, so pages never step across a window boundary.
   */
  createdFrom?: string
  createdTo?: string
  cursor?: string | null
  /**
   * Order by time rather than by the run id as a string.
   *
   * Ids are `prefix + sequence`, so once the sequence passes 9999 the string order stops matching
   * the time order: `…-9999` sorts above `…-19771`, and a "latest runs" query silently returns a
   * month-old page.
   */
  newestFirst?: boolean
  limit?: number
}

export type JobRunPage = {
  runs: JobRunRecord[]
  nextCursor: string | null
}

/** One day of history for one definition, kept after the run details are dropped. */
export type JobRunDailyAggregate = Readonly<{
  day: string
  definitionId: string
  runs: number
  failures: number
}>

/**
 * Why a store cannot answer a daily-aggregate query at all.
 *
 * An enum member, never free text: callers switch on it, and a `string` would let a new
 * cause appear without anyone deciding what it means.
 */
export type JobRunAggregateUnavailableReason = 'memory-store-has-no-aggregates'

/**
 * Half-open UTC day window `[fromDay, toDay)` — both `YYYY-MM-DD`, `toDay` excluded — plus an
 * optional definition-id prefix. Day granularity is half-open so a caller cannot be one day off
 * at either end; the window needs no timezone argument because the stored day is already UTC.
 */
export type JobRunAggregateQuery = {
  /** Inclusive first day. */
  fromDay?: string
  /** Exclusive last day. */
  toDay?: string
  /** Restricts to definitions whose id starts with this literal prefix (no wildcard meaning). */
  definitionIdPrefix?: string
}

/**
 * A daily-aggregate answer.
 *
 * `unavailable` is not the same thing as "no runs happened": the store says which of the two it
 * means, so a caller never renders an empty history over a store that cannot answer at all.
 */
export type JobRunAggregateResult =
  | Readonly<{ state: 'available'; rows: readonly JobRunDailyAggregate[] }>
  | Readonly<{
      state: 'unavailable'
      reason: JobRunAggregateUnavailableReason
      rows: readonly JobRunDailyAggregate[]
    }>

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoff: 'none',
  baseDelayMs: 0,
  maxDelayMs: 0
}
