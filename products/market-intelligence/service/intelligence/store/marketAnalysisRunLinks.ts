import type { MarketAnalysisSqlite } from './marketAnalysisSqlite'

/**
 * The write-backs that make a run reachable from the two places a reader looks.
 *
 * Both columns were null in every row today, and each is knowable at a different moment: the attempt
 * row exists before the run does, and the job run id only exists after the enqueue answers. Kept
 * here, next to the rows they fill, so the repository does not grow a third concern.
 */

/**
 * Fills in the run this attempt actually produced, once the run exists.
 *
 * Leaving it null is not neutral: the sweep that asks "is this queued row still waiting, or did
 * nothing ever claim it" reads this column, and an empty one would get a row that does have a run
 * killed as abandoned.
 */
export function linkTriggerLedgerRun(
  sqlite: MarketAnalysisSqlite,
  value: Readonly<{ id: string; analysisRunId: string; snapshotHash: string }>
): boolean {
  return Number(sqlite.database.prepare('update mi_analysis_trigger_ledger set analysis_run_id=?, snapshot_hash=? where id=?')
    .run(value.analysisRunId, value.snapshotHash, value.id).changes) === 1
}

/**
 * The job run that executes this analysis.
 *
 * A queued analysis without it cannot be reached from the run log, and the run log is the page whose
 * whole purpose is answering "what happened to those 26".
 */
export function linkRunJobRun(
  sqlite: MarketAnalysisSqlite,
  value: Readonly<{ id: string; jobRunId: string }>
): boolean {
  return Number(sqlite.database.prepare('update mi_analysis_runs set job_run_id=? where id=?')
    .run(value.jobRunId, value.id).changes) === 1
}
