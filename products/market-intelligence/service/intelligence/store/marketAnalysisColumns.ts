import type { DatabaseSync } from 'node:sqlite'

/**
 * Columns added to `mi_analysis_runs` after the first release.
 *
 * Append-only and nullable, never backfilled: a run written before a column existed genuinely does
 * not know its value, and inventing one would put it in a denominator it never joined — or, for the
 * episode id, make a recovery notice quote the wrong starting point.
 */
export function ensureRunColumns(database: DatabaseSync): void {
  const columns = (database.prepare('pragma table_info(mi_analysis_runs)').all() as Record<string, unknown>[]).map(row => String(row.name))
  // The criterion a run was judged by.
  if (!columns.includes('validation_mode')) database.exec('alter table mi_analysis_runs add column validation_mode text')
  // The run that opened the current failure episode, so a restart can still name it.
  if (!columns.includes('notification_episode_run_id')) database.exec('alter table mi_analysis_runs add column notification_episode_run_id text')
}
