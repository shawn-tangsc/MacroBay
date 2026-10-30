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

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoff: 'none',
  baseDelayMs: 0,
  maxDelayMs: 0
}
