import type { DatabaseSync } from 'node:sqlite'

/**
 * Every run a batch of ledger rows points at, in one query.
 *
 * One query per screen, not one per row: the chips project by change hash, and a lookup per chip turns
 * a screenful of thirty signals into thirty-one reads against the "two queries per screen" rule.
 * An id that is no longer there simply does not come back — the projection reads that as "the record
 * is past its retention period", never as "still queued".
 */
export function runsByIds(
  database: DatabaseSync,
  ids: readonly string[]
): Readonly<Record<string, { status: string; failureCode: string | null }>> {
  const unique = [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))]
  if (unique.length === 0) return {}
  const placeholders = unique.map(() => '?').join(',')
  const rows = database.prepare(`select id, status, failure_code from mi_analysis_runs where id in (${placeholders})`).all(...unique) as { id: string; status: string; failure_code: string | null }[]
  const into: Record<string, { status: string; failureCode: string | null }> = {}
  for (const row of rows) into[String(row.id)] = { status: String(row.status), failureCode: row.failure_code }
  return into
}
