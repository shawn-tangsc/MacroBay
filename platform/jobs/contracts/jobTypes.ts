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

export type JobDefinition<TPayload = unknown> = {
  id: string
  owner: JobOwner
  productId?: string
  handlerId: string
  title: string
  trigger: JobTrigger
  payload: TPayload
  concurrencyKey?: string
  timeoutMs?: number
  retryPolicy?: RetryPolicy
  redact?: (value: unknown) => unknown
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
