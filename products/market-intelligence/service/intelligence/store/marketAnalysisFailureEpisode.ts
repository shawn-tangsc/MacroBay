import type { DatabaseSync } from 'node:sqlite'

import { analysisRunLineOf } from '../analysis/analysisTriggerSourcePolicy'

/**
 * The run that opened the current failure episode, written when a run fails.
 *
 * One home for the judgement: a recovery notice that counts its failures from a different starting
 * point than the one stored is a notice nobody can check.
 *
 * Three classes of status, not two. A run the system stopped — cancelled, stale, superseded — is
 * **neutral**: it is not a failure, so it neither joins the failure sample, nor opens an episode, nor
 * ends one. Called a failure, a reader who closed the window would be told "the model service may be
 * having problems", which says we broke when in fact we stopped.
 *
 * The episode is scoped by **line**, the same scope the recovery judgement uses. Keyed by
 * `trigger_key`, one event line would open a separate episode per rule and the notice would quote
 * one key's start while counting another key's failures.
 */
export function failureEpisodeFor(
  database: DatabaseSync,
  runId: string,
  status: string
): string | null {
  if (!isFailureStatus(status)) return null
  const current = database.prepare('select trigger_key from mi_analysis_runs where id = ?').get(runId) as { trigger_key?: string } | undefined
  if (!current?.trigger_key) return runId
  const line = analysisRunLineOf(String(current.trigger_key))
  // A few hundred rows in the whole table: filtering the last twenty in memory is cheaper than
  // storing the derived line and keeping two truths.
  const recent = database.prepare(`
    select id, trigger_key, status, coalesce(notification_episode_run_id, id) as episode
    from mi_analysis_runs
    where id <> ? and status in ('failed', 'invalid-output')
    order by queued_at desc
    limit 20`).all(runId) as { trigger_key: string; episode: string }[]
  const previous = recent.find(row => analysisRunLineOf(String(row.trigger_key)) === line)
  return previous ? String(previous.episode) : runId
}

/** Only these mean "it was tried and did not work"; everything else is neutral. */
export function isFailureStatus(status: string): boolean {
  return status === 'failed' || status === 'invalid-output'
}
