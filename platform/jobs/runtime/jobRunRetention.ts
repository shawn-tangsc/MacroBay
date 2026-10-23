import type { JobRunSqliteRepository, JobRunRetentionSweep } from './jobRunSqliteRepository'

/**
 * Retention policy for the platform job ledger.
 *
 * `job_runs` grows with every scheduled tick of every collector, so the ledger is
 * the largest single file the product writes. Detail is kept for a bounded window
 * because that is what troubleshooting needs; beyond it the information worth
 * keeping is the per-day outcome, which is far smaller.
 */
export const jobRunRetentionPolicy = Object.freeze({
  detailRetentionDays: 30,
  batchLimit: 500,
  sweepIntervalMs: 24 * 60 * 60_000
})

export type JobRunRetentionResult = JobRunRetentionSweep & Readonly<{
  cutoff: string
  /** True when the policy window is misconfigured and nothing was removed. */
  skipped: boolean
}>

/**
 * Removes job run details older than the retention window.
 *
 * Old runs are first folded into `job_run_daily_aggregates`, then deleted, so the
 * daily counts survive the detail. The fold is additive per `(day, definitionId)`,
 * which makes repeated sweeps safe: each run is counted exactly once because it is
 * removed in the same transaction that counts it.
 */
export function runJobRunRetention(input: Readonly<{
  store: Pick<JobRunSqliteRepository, 'purgeRunsOlderThan'>
  now?: () => string
  batchLimit?: number
}>): JobRunRetentionResult {
  const now = (input.now ?? (() => new Date().toISOString()))()
  const { detailRetentionDays } = jobRunRetentionPolicy
  const batchLimit = input.batchLimit ?? jobRunRetentionPolicy.batchLimit
  if (detailRetentionDays <= 0 || batchLimit <= 0) return { cutoff: now, deletedRuns: 0, hasMore: false, skipped: true }
  const cutoff = new Date(Date.parse(now) - detailRetentionDays * 24 * 60 * 60_000).toISOString()
  const sweep = input.store.purgeRunsOlderThan(cutoff, batchLimit)
  return { ...sweep, cutoff, skipped: false }
}

/**
 * Runs the retention sweep now and then daily.
 *
 * The sweep is best-effort by design: a failure is swallowed because losing one
 * pass costs nothing (each sweep is idempotent and the next one resumes), while a
 * thrown error inside a startup timer could take the host down.
 */
export function scheduleJobRunRetention(
  store: Pick<JobRunSqliteRepository, 'purgeRunsOlderThan'>,
  timers: {
    setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
    clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  } = {}
): () => void {
  const run = () => {
    try {
      runJobRunRetention({ store })
    } catch {
      // The next daily pass resumes: aggregation and deletion share a transaction.
    }
  }
  run()
  const setTimer = timers.setInterval ?? setInterval
  const clearTimer = timers.clearInterval ?? clearInterval
  const timer = setTimer(run, jobRunRetentionPolicy.sweepIntervalMs)
  return () => clearTimer(timer)
}
