import type { MarketAnalysisSqlite } from './marketAnalysisSqlite'

type Row = Record<string, unknown>

/**
 * One query for a screenful of chips: the latest ledger row per change hash.
 *
 * The chips project by `changeHash`, and the ledger's unique index starts with `event_group_id`, so
 * asking per chip would scan the table once per chip. `idx_mi_analysis_trigger_change_hash` makes
 * this a lookup. Latest wins and never falls back: a run that was first refused by the cooldown and
 * then analysed must show the analysis, not the refusal.
 */
export function listLatestSignalLedgerStates(
  sqlite: MarketAnalysisSqlite,
  changeHashes: readonly string[]
): readonly { changeHash: string; decision: 'queued' | 'skipped' | 'recorded'; reasonCode: string; analysisRunId: string | null }[] {
  const hashes = [...new Set(changeHashes.filter(hash => typeof hash === 'string' && hash.length > 0))]
  if (hashes.length === 0) return []
  const placeholders = hashes.map(() => '?').join(',')
  const rows = sqlite.database.prepare(`select change_hash, decision, reason_code, analysis_run_id from mi_analysis_trigger_ledger where change_hash in (${placeholders}) order by created_at desc, id desc`).all(...hashes) as Row[]
  const seen = new Set<string>()
  const latest: { changeHash: string; decision: 'queued' | 'skipped' | 'recorded'; reasonCode: string; analysisRunId: string | null }[] = []
  for (const row of rows) {
    const changeHash = String(row.change_hash)
    if (seen.has(changeHash)) continue
    seen.add(changeHash)
    latest.push({
      changeHash,
      decision: String(row.decision) as 'queued' | 'skipped' | 'recorded',
      reasonCode: String(row.reason_code),
      analysisRunId: row.analysis_run_id as string | null
    })
  }
  return latest
}
