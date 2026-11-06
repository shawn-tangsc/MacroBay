import type { DatabaseSync } from 'node:sqlite'

/**
 * The run that opened the current failure episode, written when a run fails.
 *
 * One home for the judgement, because a recovery notice that counts its failures from a different
 * starting point than the one stored is a notice nobody can check. A success ends the episode: the
 * next failure starts a new one, and the reader is told about that episode on its own merits.
 *
 * Nullable and never backfilled: a run that failed before this column existed simply does not know
 * its episode, and a guessed id would make the notice quote the wrong start.
 */
export function failureEpisodeFor(
  database: DatabaseSync,
  runId: string,
  status: string
): string | null {
  if (status !== 'failed' && status !== 'cancelled' && status !== 'invalid-output') return null
  const previous = database.prepare(`
    select coalesce(notification_episode_run_id, id) as episode
    from mi_analysis_runs
    where trigger_key = (select trigger_key from mi_analysis_runs where id = ?)
      and id <> ?
      and status in ('failed', 'cancelled', 'invalid-output')
    order by queued_at desc
    limit 1`).get(runId, runId) as { episode?: string } | undefined
  return previous?.episode ?? runId
}
