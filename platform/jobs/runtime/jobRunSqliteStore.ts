import type {
  JobCancelReason,
  JobLogEntry,
  JobProgress,
  JobRunPage,
  JobRunQuery,
  JobRunRecord,
  JobStatus
} from '../contracts/jobTypes'
import type { CreateRunInput, JobRunStore } from './jobRunStore'
import { QUEUED_AT_RESTART_ERROR } from './jobRunStore'
import { createJobRunSqliteRepository, type JobRunSqliteRepository } from './jobRunSqliteRepository'

export type JobRunSqliteStore = JobRunStore & {
  /** Folds runs older than `cutoff` into daily counters and removes the details. */
  purgeRunsOlderThan: JobRunSqliteRepository['purgeRunsOlderThan']
  listRunAggregates: JobRunSqliteRepository['listRunAggregates']
  close: () => void
}

export function createJobRunSqliteStore(path: string): JobRunSqliteStore {
  const repository = createJobRunSqliteRepository(path)
  return {
    createRun(input) {
      const run: JobRunRecord = {
        id: repository.allocateRunId(),
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
      repository.upsertRun(run)
      return run
    },
    getRun(runId) {
      return repository.getRun(runId) ?? undefined
    },
    listRecentRuns(limit) {
      return repository.listRunPage({ limit }).runs
    },
    queryRuns(query = {}) {
      return repository.listRunPage(query).runs
    },
    queryRunPage(query = {}) {
      return repository.listRunPage(query)
    },
    markRunning(runId) {
      const current = repository.getRun(runId)
      if (!current || current.status !== 'queued') return undefined
      const next = {
        ...current,
        status: 'running' as const,
        startedAt: current.startedAt ?? nowIso()
      }
      repository.upsertRun(next)
      return next
    },
    markCompleted(runId) {
      return updateRun(repository, runId, (run) => ({
        ...run,
        status: 'completed',
        completedAt: nowIso()
      }))
    },
    markFailed(runId, error) {
      return updateRun(repository, runId, (run) => ({
        ...run,
        status: 'failed',
        completedAt: nowIso(),
        lastError: error
      }))
    },
    markCancelled(runId, reason) {
      return updateRun(repository, runId, (run) => ({
        ...run,
        status: 'cancelled',
        completedAt: nowIso(),
        lastError: normalizeCancelReason(reason)
      }))
    },
    incrementAttempt(runId) {
      return updateRun(repository, runId, (run) => ({
        ...run,
        attempt: run.attempt + 1,
        status: run.status satisfies JobStatus
      }))
    },
    appendLog(runId, entry) {
      return updateRun(repository, runId, (run) => ({
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
      return updateRun(repository, runId, (run) => ({
        ...run,
        progress
      }))
    },
    recoverStaleRunningRuns() {
      const recovered: JobRunRecord[] = []
      // Updating status removes the cursor from its scope. Drain bounded first pages.
      for (;;) {
        const page = repository.listRunPage({ statuses: ['running'] })
        if (page.runs.length === 0) break
        for (const run of page.runs) {
          const failed: JobRunRecord = {
            ...run,
            status: 'failed',
            completedAt: nowIso(),
            lastError: 'Job run interrupted by process restart.'
          }
          repository.upsertRun(failed)
          recovered.push(failed)
        }
      }
      return recovered
    },
    recoverStaleQueuedRuns() {
      const recovered: JobRunRecord[] = []
      // Same bounded drain as the running case: writing the status removes the row from scope.
      for (;;) {
        const page = repository.listRunPage({ statuses: ['queued'] })
        if (page.runs.length === 0) break
        for (const run of page.runs) {
          const cancelled: JobRunRecord = {
            ...run,
            status: 'cancelled',
            completedAt: nowIso(),
            lastError: QUEUED_AT_RESTART_ERROR
          }
          repository.upsertRun(cancelled)
          recovered.push(cancelled)
        }
      }
      return recovered
    },
    purgeRunsOlderThan(cutoff, batchLimit) {
      return repository.purgeRunsOlderThan(cutoff, batchLimit)
    },
    listRunAggregates() {
      return repository.listRunAggregates()
    },
    close() {
      repository.close()
    }
  }
}

function updateRun(
  repository: Pick<JobRunSqliteRepository, 'getRun' | 'upsertRun'>,
  runId: string,
  updater: (run: JobRunRecord) => JobRunRecord
): JobRunRecord | undefined {
  const current = repository.getRun(runId)
  if (!current) return undefined
  const next = updater(current)
  repository.upsertRun(next)
  return next
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
