type Dependencies = {
  attempts: {
    markPendingUnknown: (cutoff: string) => number
    deleteOlderThan: (cutoff: string, limit: number) => number
  }
  runs: {
    deleteOlderThan: (cutoff: string, limit: number) => { deletedRuns: number; deletedAttempts: number }
  }
  audits: {
    deleteOlderThan: (cutoff: string, limit: number) => number
  }
  checkpoints: {
    set: (key: string, value: unknown, updatedAt: string) => void
  }
  now?: () => string
}

const retentionBatchLimit = 500
const attemptRetentionMs = 180 * 24 * 60 * 60_000
const runRetentionMs = 365 * 24 * 60 * 60_000

export function createTaskAutomationMaintenance(deps: Dependencies) {
  const timestamp = () => (deps.now ?? (() => new Date().toISOString()))()
  return {
    recoverAfterRestart(): { unknownAttempts: number } {
      return { unknownAttempts: deps.attempts.markPendingUnknown(timestamp()) }
    },
    runDailyRetention(): { deletedRuns: number; deletedAttempts: number; deletedAudits: number } {
      const now = timestamp()
      const deletedAttempts = deps.attempts.deleteOlderThan(
        new Date(Date.parse(now) - attemptRetentionMs).toISOString(),
        retentionBatchLimit
      )
      const deletedRuns = deps.runs.deleteOlderThan(
        new Date(Date.parse(now) - runRetentionMs).toISOString(),
        retentionBatchLimit
      )
      const deletedAudits = deps.audits.deleteOlderThan(
        new Date(Date.parse(now) - runRetentionMs).toISOString(),
        retentionBatchLimit
      )
      const result = {
        deletedRuns: deletedRuns.deletedRuns,
        deletedAttempts: deletedAttempts + deletedRuns.deletedAttempts,
        deletedAudits
      }
      deps.checkpoints.set('task-delivery-retention', result, now)
      return result
    }
  }
}

export function scheduleTaskAutomationMaintenance(
  maintenance: Pick<ReturnType<typeof createTaskAutomationMaintenance>, 'runDailyRetention'>,
  timers: {
    setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
    clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  } = {}
): () => void {
  const run = () => {
    try {
      maintenance.runDailyRetention()
    } catch {
      // A later daily pass can resume from the durable maintenance checkpoint.
    }
  }
  run()
  const setTimer = timers.setInterval ?? setInterval
  const clearTimer = timers.clearInterval ?? clearInterval
  const timer = setTimer(run, 24 * 60 * 60_000)
  return () => clearTimer(timer)
}
