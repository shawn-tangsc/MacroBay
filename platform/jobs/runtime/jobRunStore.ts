import type {
  JobCancelReason,
  JobLogEntry,
  JobProgress,
  JobRunPage,
  JobRunQuery,
  JobRunRecord,
  JobStatus
} from '../contracts/jobTypes'

export type CreateRunInput = {
  definitionId: string
  handlerId: string
  owner: JobRunRecord['owner']
  productId?: string
  title: string
  trigger: JobRunRecord['trigger']
  payload: unknown
  concurrencyKey?: string
  maxAttempts: number
}

/** Shared by both stores so a settled queued run reads the same whichever store persisted it. */
export const QUEUED_AT_RESTART_ERROR = 'Job run was still queued when the process stopped.'

export type JobRunStore = {
  createRun: (input: CreateRunInput) => JobRunRecord
  getRun: (runId: string) => JobRunRecord | undefined
  listRecentRuns: (limit: number) => JobRunRecord[]
  queryRuns: (query?: JobRunQuery) => JobRunRecord[]
  queryRunPage: (query?: JobRunQuery) => JobRunPage
  markRunning: (runId: string) => JobRunRecord | undefined
  markCompleted: (runId: string) => JobRunRecord | undefined
  markFailed: (runId: string, error: string) => JobRunRecord | undefined
  markCancelled: (runId: string, reason?: string | JobCancelReason) => JobRunRecord | undefined
  incrementAttempt: (runId: string) => JobRunRecord | undefined
  appendLog: (runId: string, entry: Omit<JobLogEntry, 'at'> & { at?: string }) => JobRunRecord | undefined
  setProgress: (runId: string, progress: JobProgress) => JobRunRecord | undefined
  recoverStaleRunningRuns: () => JobRunRecord[]
  /**
   * `queued` rows that survived a process restart: the queue is in-memory, so nothing will
   * ever start them. They used to stay `queued` in the store forever.
   */
  recoverStaleQueuedRuns: () => JobRunRecord[]
}

export function createJobRunStore(): JobRunStore {
  const runs = new Map<string, JobRunRecord>()
  let sequence = 0

  return {
    createRun(input) {
      const run: JobRunRecord = {
        id: `run-${++sequence}`,
        definitionId: input.definitionId,
        handlerId: input.handlerId,
        owner: input.owner,
        productId: input.productId,
        title: input.title,
        status: 'queued',
        trigger: input.trigger,
        payload: input.payload,
        concurrencyKey: input.concurrencyKey,
        attempt: 1,
        maxAttempts: input.maxAttempts,
        createdAt: nowIso(),
        logs: []
      }
      runs.set(run.id, run)
      return run
    },
    getRun(runId) {
      return runs.get(runId)
    },
    listRecentRuns(limit) {
      return [...runs.values()].sort((left, right) => right.id.localeCompare(left.id)).slice(0, limit)
    },
    queryRuns(query = {}) {
      return queryRunRecords(runs, query).slice(0, normalizeLimit(query.limit))
    },
    queryRunPage(query = {}) {
      const limit = normalizeLimit(query.limit)
      const records = queryRunRecords(runs, query)
      const pageRuns = records.slice(0, limit)
      return {
        runs: pageRuns,
        nextCursor: records.length > pageRuns.length ? pageRuns.at(-1)?.id ?? null : null
      }
    },
    markRunning(runId) {
      const current = runs.get(runId)
      if (!current || current.status !== 'queued') return undefined
      const next = {
        ...current,
        status: 'running' as const,
        startedAt: current.startedAt ?? nowIso()
      }
      runs.set(runId, next)
      return next
    },
    markCompleted(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'completed',
        completedAt: nowIso()
      }))
    },
    markFailed(runId, error) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'failed',
        completedAt: nowIso(),
        lastError: error
      }))
    },
    markCancelled(runId, reason) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'cancelled',
        completedAt: nowIso(),
        lastError: normalizeCancelReason(reason)
      }))
    },
    incrementAttempt(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        attempt: run.attempt + 1,
        status: run.status satisfies JobStatus
      }))
    },
    appendLog(runId, entry) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        logs: [
          ...run.logs,
          {
            at: entry.at ?? nowIso(),
            level: entry.level,
            message: entry.message,
            metadata: entry.metadata
          }
        ]
      }))
    },
    setProgress(runId, progress) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        progress
      }))
    },
    recoverStaleRunningRuns() {
      const recovered: JobRunRecord[] = []
      for (const run of runs.values()) {
        if (run.status !== 'running') continue
        const failed = updateRun(runs, run.id, (current) => ({
          ...current,
          status: 'failed',
          completedAt: nowIso(),
          lastError: 'Job run interrupted by process restart.'
        }))
        if (failed) recovered.push(failed)
      }
      return recovered
    },
    recoverStaleQueuedRuns() {
      const recovered: JobRunRecord[] = []
      for (const run of runs.values()) {
        if (run.status !== 'queued') continue
        const cancelled = updateRun(runs, run.id, (current) => ({
          ...current,
          status: 'cancelled',
          completedAt: nowIso(),
          lastError: QUEUED_AT_RESTART_ERROR
        }))
        if (cancelled) recovered.push(cancelled)
      }
      return recovered
    }
  }
}

function updateRun(
  runs: Map<string, JobRunRecord>,
  runId: string,
  updater: (run: JobRunRecord) => JobRunRecord
): JobRunRecord | undefined {
  const current = runs.get(runId)
  if (!current) return undefined
  const next = updater(current)
  runs.set(runId, next)
  return next
}

function queryRunRecords(runs: Map<string, JobRunRecord>, query: JobRunQuery): JobRunRecord[] {
  const sortedRuns = [...runs.values()].filter((run) => matchesRunQuery(run, query)).sort(compareRecentRuns)
  if (!query.cursor) return sortedRuns
  const cursorIndex = sortedRuns.findIndex((run) => run.id === query.cursor)
  if (cursorIndex < 0) return []
  return sortedRuns.slice(cursorIndex + 1)
}

function matchesRunQuery(run: JobRunRecord, query: JobRunQuery): boolean {
  if (query.owner && run.owner !== query.owner) return false
  if (query.productId && run.productId !== query.productId) return false
  if (query.handlerId && run.handlerId !== query.handlerId) return false
  if (query.definitionId && run.definitionId !== query.definitionId) return false
  if (query.definitionIdPrefix && !run.definitionId.startsWith(query.definitionIdPrefix)) return false
  if (query.statuses && query.statuses.length > 0 && !query.statuses.includes(run.status)) return false
  if (query.payload && !matchesPayloadQuery(run.payload, query.payload)) return false
  return true
}

function matchesPayloadQuery(payload: unknown, query: Record<string, unknown>): boolean {  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  return Object.entries(query).every(([key, expected]) => Object.is(record[key], expected))
}

function compareRecentRuns(left: JobRunRecord, right: JobRunRecord): number {
  return right.id.localeCompare(left.id)
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 20
  return Math.max(0, Math.floor(limit))
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeCancelReason(reason: string | JobCancelReason | undefined): string | undefined {
  if (!reason) return undefined
  if (typeof reason === 'string') {
    const trimmed = reason.trim()
    return trimmed || undefined
  }
  if (typeof reason.message !== 'string') return undefined
  const trimmed = reason.message.trim()
  return trimmed || undefined
}
