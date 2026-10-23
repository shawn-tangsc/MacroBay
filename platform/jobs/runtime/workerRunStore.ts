import type { JobLogEntry } from '../contracts/jobTypes'
import type { WorkerRunRecord, WorkerStatus } from '../contracts/workerTypes'
import { redactJobLogEntry } from './logRedaction'

export type CreateWorkerRunInput = {
  definitionId: string
  handlerId: string
  owner: WorkerRunRecord['owner']
  productId?: string
  title: string
  payload: unknown
  concurrencyKey?: string
  restartAttempt?: number
}

export type WorkerRunStore = {
  createRun: (input: CreateWorkerRunInput) => WorkerRunRecord
  getRun: (runId: string) => WorkerRunRecord | undefined
  getRunByDefinitionId: (definitionId: string) => WorkerRunRecord | undefined
  setRunForDefinition: (definitionId: string, runId: string) => void
  clearRunForDefinition: (definitionId: string) => void
  listRuns: () => WorkerRunRecord[]
  markLive: (runId: string) => WorkerRunRecord | undefined
  markDegraded: (runId: string, reason: string) => WorkerRunRecord | undefined
  markReconnecting: (runId: string) => WorkerRunRecord | undefined
  markStopping: (runId: string) => WorkerRunRecord | undefined
  markStopped: (runId: string) => WorkerRunRecord | undefined
  markFailed: (runId: string, error: string) => WorkerRunRecord | undefined
  recordHeartbeat: (runId: string) => WorkerRunRecord | undefined
  incrementMissedHeartbeats: (runId: string) => WorkerRunRecord | undefined
  resetMissedHeartbeats: (runId: string) => WorkerRunRecord | undefined
  incrementRestartAttempt: (runId: string) => WorkerRunRecord | undefined
  appendLog: (runId: string, entry: Omit<JobLogEntry, 'at'> & { at?: string }) => WorkerRunRecord | undefined
  recoverStaleActiveRuns: () => WorkerRunRecord[]
}

const ACTIVE_STATUSES: WorkerStatus[] = ['starting', 'live', 'degraded', 'reconnecting', 'stopping']
const MAX_WORKER_RUN_LOGS = 200

export function createWorkerRunStore(): WorkerRunStore {
  const runs = new Map<string, WorkerRunRecord>()
  const definitionToRunId = new Map<string, string>()
  let sequence = 0

  return {
    createRun(input) {
      const run: WorkerRunRecord = {
        id: `worker-run-${++sequence}`,
        definitionId: input.definitionId,
        handlerId: input.handlerId,
        owner: input.owner,
        productId: input.productId,
        title: input.title,
        status: 'starting',
        payload: input.payload,
        concurrencyKey: input.concurrencyKey,
        createdAt: nowIso(),
        startedAt: nowIso(),
        missedHeartbeats: 0,
        restartAttempt: input.restartAttempt ?? 0,
        logs: []
      }
      runs.set(run.id, run)
      definitionToRunId.set(input.definitionId, run.id)
      return run
    },
    getRun(runId) {
      return runs.get(runId)
    },
    getRunByDefinitionId(definitionId) {
      const runId = definitionToRunId.get(definitionId)
      return runId ? runs.get(runId) : undefined
    },
    setRunForDefinition(definitionId, runId) {
      definitionToRunId.set(definitionId, runId)
    },
    clearRunForDefinition(definitionId) {
      definitionToRunId.delete(definitionId)
    },
    listRuns() {
      return [...runs.values()]
    },
    markLive(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'live',
        liveAt: run.liveAt ?? nowIso(),
        degradedReason: undefined,
        missedHeartbeats: 0
      }))
    },
    markDegraded(runId, reason) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'degraded',
        degradedReason: reason
      }))
    },
    markReconnecting(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'reconnecting'
      }))
    },
    markStopping(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'stopping'
      }))
    },
    markStopped(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'stopped',
        stoppedAt: nowIso()
      }))
    },
    markFailed(runId, error) {
      const redactedMessage = redactJobLogEntry({ level: 'error', message: error }).message
      return updateRun(runs, runId, (run) => ({
        ...run,
        status: 'failed',
        stoppedAt: nowIso(),
        lastError: redactedMessage
      }))
    },
    recordHeartbeat(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        lastHeartbeatAt: nowIso(),
        missedHeartbeats: 0
      }))
    },
    incrementMissedHeartbeats(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        missedHeartbeats: run.missedHeartbeats + 1
      }))
    },
    resetMissedHeartbeats(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        missedHeartbeats: 0
      }))
    },
    incrementRestartAttempt(runId) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        restartAttempt: run.restartAttempt + 1
      }))
    },
    appendLog(runId, entry) {
      return updateRun(runs, runId, (run) => ({
        ...run,
        logs: trimLogs([
          ...run.logs,
          {
            at: entry.at ?? nowIso(),
            level: entry.level,
            message: entry.message,
            metadata: entry.metadata
          }
        ])
      }))
    },
    recoverStaleActiveRuns() {
      const recovered: WorkerRunRecord[] = []
      for (const run of runs.values()) {
        if (!ACTIVE_STATUSES.includes(run.status)) continue
        const failed = updateRun(runs, run.id, (current) => ({
          ...current,
          status: 'failed',
          stoppedAt: nowIso(),
          lastError: 'Worker run interrupted by process restart.'
        }))
        if (failed) recovered.push(failed)
      }
      return recovered
    }
  }
}

function updateRun(
  runs: Map<string, WorkerRunRecord>,
  runId: string,
  updater: (run: WorkerRunRecord) => WorkerRunRecord
): WorkerRunRecord | undefined {
  const current = runs.get(runId)
  if (!current) return undefined
  const next = updater(current)
  runs.set(runId, next)
  return next
}

function nowIso(): string {
  return new Date().toISOString()
}

function trimLogs(logs: JobLogEntry[]): JobLogEntry[] {
  if (logs.length <= MAX_WORKER_RUN_LOGS) return logs
  return logs.slice(-MAX_WORKER_RUN_LOGS)
}
