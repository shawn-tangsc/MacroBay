/**
 * One row of the data-sync run record: what ran, when, against which source, and how it ended.
 *
 * P0 reads the platform's own job runs. They are the only place a failed collection leaves a trace
 * today, and nothing in the product was reading them — which is why a source could look enabled while
 * every collection was skipped.
 */
export const SYNC_RUN_IPC_METHODS = {
  list: 'intelligence.syncRuns.list'
} as const

export type SyncRunAction = 'collect' | 'refresh' | 'analysis' | 'configure' | 'test' | 'import' | 'other'
export type SyncRunOutcome = 'succeeded' | 'failed' | 'cancelled' | 'running'
export type SyncRunWindow = '24h' | '7d' | 'all'

export type SyncRunRow = Readonly<{
  /** `completed_at`, else `started_at`, else `created_at`. */
  at: string
  runId: string
  /** The job that ran, in the reader's language ("AI 分析", "官方日历排期"). */
  taskLabel: string
  /**
   * The sources this run touched, from its own payload.
   *
   * One task can serve many sources (`collectSource` runs once per source) and one source is read by
   * several tasks, so a single source column would be a lie either way.
   */
  sources: readonly Readonly<{ sourceId: string; label: string }>[]
  handlerId: string
  action: SyncRunAction
  /** `runId` for job rows, a generated id for product-side actions; the key that ties a chain. */
  correlationId: string
  outcome: SyncRunOutcome
  durationMs?: number
  /** The stable code a failure carries, when one can be read out of the error text. */
  failureCode?: string
  detail?: string
}>

/** One product-side action: a switch, a connection test, a manual refresh, an import. */
export type SyncAuditEntry = Readonly<{
  id: string
  at: string
  actor: 'schedule' | 'user' | 'agent' | 'startup'
  action: Exclude<SyncRunAction, 'analysis' | 'other'>
  target: string
  outcome: SyncRunOutcome
  failureCode?: string
  durationMs?: number
  detail?: string
}>

export type SyncRunQuery = Readonly<{
  window: SyncRunWindow
  sourceId?: string
  outcome?: SyncRunOutcome
  limit: number
}>

export type SyncRunResult =
  | Readonly<{ state: 'available'; rows: readonly SyncRunRow[] }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export const SYNC_RUN_LIMITS = {
  defaultLimit: 200,
  maximumLimit: 500,
  /** Truncated error text; the full line stays in `job_runs`. */
  detailMaxLength: 160,
  windowMs: { '24h': 24 * 60 * 60 * 1_000, '7d': 7 * 24 * 60 * 60 * 1_000 }
} as const

/** One CSV, built from the rows on screen, so an export never disagrees with the table. */
export function syncRunsCsv(rows: readonly SyncRunRow[], header: readonly string[]): string {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return [header.map(escape).join(','), ...rows.map((row) => [
    row.at, row.taskLabel, row.sources.map((source) => source.label).join(' / '), row.action, row.outcome,
    row.durationMs === undefined ? '' : String(row.durationMs),
    row.failureCode ?? '', row.correlationId, row.detail ?? ''
  ].map(escape).join(','))].join('\n')
}
