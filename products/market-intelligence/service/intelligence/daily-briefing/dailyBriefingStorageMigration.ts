import { statSync } from 'node:fs'

import type { DatabaseSync } from 'node:sqlite'

import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'

/** The handle the store owns; the migration needs nothing beyond it. */
export type SqliteDatabase = DatabaseSync

/**
 * Storage migration for the daily brief: from one edition per day to one edition per day *and*
 * issue number, and from "the last failed attempt" to a row per attempt.
 *
 * Three rules shape this file, all from the release it prepares:
 *
 * - **No `drop table` on the data.** An edition is written once and never re-derived, so dropping
 *   it loses the reader's history. The migration builds the new tables beside the old ones, copies
 *   row by row, checks the row counts match, and only then swaps them in.
 * - **Back up before touching anything, consistently.** A plain file copy of a WAL database can
 *   miss pages that only exist in `-wal`; `vacuum into` writes a snapshot that is a database on its
 *   own, which is what the release note's "restore the copy" sentence depends on.
 * - **Never throw.** A failed upgrade must leave the application usable on the old shape, not take
 *   the product down with a start failure page. The caller reads the outcome and decides.
 *
 * Re-running is safe: a database already carrying the new shape reports "current", a fresh one is
 * initialized, and a v2 one is upgraded once.
 */

export const DAILY_BRIEFING_STORAGE_VERSION = 3

/** The single issue every row belongs to before issue numbers existed. */
export const DEFAULT_PERIOD_ID_VALUE = DEFAULT_PERIOD_ID

/** Beside the database, one fixed name: the only thing a reader needs to go back to 0.3.x. */
export const DAILY_BRIEFING_BACKUP_SUFFIX = '.bak-v2'

const EDITIONS = 'daily_briefings'
const ATTEMPTS = 'daily_briefing_attempts'
const NEXT_EDITIONS = `${EDITIONS}_v3`
const NEXT_ATTEMPTS = `${ATTEMPTS}_v3`

export type DailyBriefingMigrationSkipReason = 'backup-failed' | 'migration-failed'

export type DailyBriefingMigrationOutcome =
  | Readonly<{ status: 'current'; version: number }>
  | Readonly<{ status: 'initialized'; version: number }>
  | Readonly<{ status: 'migrated'; version: number; backupPath: string }>
  | Readonly<{ status: 'skipped'; version: number; reason: DailyBriefingMigrationSkipReason }>

/** The editions table, under any name: the migration builds it beside the old one, then swaps. */
export function createEditionsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  period_id text not null default '${DEFAULT_PERIOD_ID}',
  locale text not null,
  generated_at text not null,
  window_start text not null,
  window_end text not null,
  document_json text not null,
  schema_version integer not null,
  primary key (edition_date, period_id, locale)
);`
}

/**
 * One row per writing attempt. `state` is written at the start (`running`) and settled in place,
 * so an attempt the process never finished is still a row the reader can see.
 */
export function createAttemptsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  period_id text not null default '${DEFAULT_PERIOD_ID}',
  locale text not null,
  attempt_no integer not null,
  state text not null check(state in ('running','succeeded','failed')),
  failure_code text,
  started_at text not null,
  finished_at text,
  trace_json text,
  cleaned_at text,
  primary key (edition_date, period_id, locale, attempt_no)
);`
}

export function createAttemptsIndexSql(table: string): string {
  return `create index if not exists idx_${table}_period on ${table}(edition_date, period_id);`
}

/**
 * One row per generated period: what the run expected, which frozen facts it wrote from, and how
 * far it got. It is created beside the two migrated tables, not by a migration: an empty table
 * starts clean and old data has nothing to copy into it.
 */
export function createPeriodRunsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  period_id text not null,
  expected_locales text not null,
  primary_requested text not null,
  primary_used text not null,
  fallback_reason text,
  snapshot_id text not null,
  snapshot_hash text not null,
  content_version integer not null default 1,
  writing_rounds integer not null default 0,
  direction text not null default 'undecided',
  edition_rows text not null default '[]',
  state text not null check(state in ('running','published','partial','failed')),
  started_at text not null,
  finished_at text,
  primary key (edition_date, period_id)
);`
}

type MigrationInput = Readonly<{
  db: SqliteDatabase
  /** The database file, so the pre-migration copy can sit beside it. `:memory:` has no file. */
  filePath: string
}>

export function migrateDailyBriefingStorage(input: MigrationInput): DailyBriefingMigrationOutcome {
  const { db, filePath } = input
  const version = currentVersion(db)
  if (hasColumn(db, EDITIONS, 'period_id')) return { status: 'current', version }
  if (!tableExists(db, EDITIONS)) {
    db.exec(createEditionsSql(EDITIONS))
    db.exec(createAttemptsSql(ATTEMPTS))
    db.exec(createAttemptsIndexSql(ATTEMPTS))
    db.exec(`pragma user_version = ${DAILY_BRIEFING_STORAGE_VERSION};`)
    return { status: 'initialized', version: DAILY_BRIEFING_STORAGE_VERSION }
  }

  const backupPath = `${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`
  if (filePath !== ':memory:') {
    try {
      // Never overwrite: the first copy is the one that matches the release the reader may return
      // to, and a resumed run must not replace it with a half-migrated file. A path that is not a
      // regular file is not a backup, so it must fail here rather than be treated as one.
      if (!isRegularFile(backupPath)) db.exec(`vacuum into '${backupPath.replaceAll("'", "''")}'`)
    } catch {
      return { status: 'skipped', version, reason: 'backup-failed' }
    }
  }

  // Both tables are built, filled and swapped inside one transaction: a crash leaves either the old
  // world or the new one, never half of each.
  db.exec('begin immediate')
  try {
    db.exec(createEditionsSql(NEXT_EDITIONS))
    db.exec(createAttemptsSql(NEXT_ATTEMPTS))
    const copiedEditions = copyEditions(db)
    const copiedAttempts = copyAttempts(db)
    if (count(db, EDITIONS) !== copiedEditions || count(db, ATTEMPTS) !== copiedAttempts) {
      throw new Error('daily-briefing-migration-row-count-mismatch')
    }
    db.exec(`drop table if exists ${EDITIONS}; alter table ${NEXT_EDITIONS} rename to ${EDITIONS};`)
    db.exec(`drop table if exists ${ATTEMPTS}; alter table ${NEXT_ATTEMPTS} rename to ${ATTEMPTS};`)
    db.exec(createAttemptsIndexSql(ATTEMPTS))
    db.exec(`pragma user_version = ${DAILY_BRIEFING_STORAGE_VERSION};`)
    db.exec('commit')
  } catch {
    rollbackQuietly(db)
    return { status: 'skipped', version, reason: 'migration-failed' }
  }

  return { status: 'migrated', version: DAILY_BRIEFING_STORAGE_VERSION, backupPath }
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function rollbackQuietly(db: SqliteDatabase): void {
  try {
    db.exec('rollback')
  } catch {
    // A transaction that already rolled itself back is not a second failure.
  }
}

function copyEditions(db: SqliteDatabase): number {
  const columns = tableColumns(db, EDITIONS)
  const period = columns.includes('period_id') ? 'period_id' : `'${DEFAULT_PERIOD_ID}'`
  const rows = db
    .prepare(`select edition_date, ${period} as period_id, locale, generated_at, window_start, window_end, document_json from ${EDITIONS}`)
    .all() as Array<Record<string, unknown>>
  const insert = db.prepare(`insert into ${NEXT_EDITIONS}
    (edition_date, period_id, locale, generated_at, window_start, window_end, document_json, schema_version)
    values (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const row of rows) {
    insert.run(
      String(row.edition_date),
      String(row.period_id ?? DEFAULT_PERIOD_ID),
      String(row.locale),
      String(row.generated_at),
      String(row.window_start),
      String(row.window_end),
      String(row.document_json),
      DAILY_BRIEFING_STORAGE_VERSION
    )
  }
  return rows.length
}

/**
 * The old table held the last failed attempt of an edition, so every row becomes attempt 1. Its
 * last write is the end of that attempt; there was no stored start, so the end stands for both.
 * The trace may still say what it was, and a trace that does not is a failure by definition.
 */
function copyAttempts(db: SqliteDatabase): number {
  const columns = tableColumns(db, ATTEMPTS)
  const period = columns.includes('period_id') ? 'period_id' : `'${DEFAULT_PERIOD_ID}'`
  const rows = db
    .prepare(`select edition_date, ${period} as period_id, locale, trace_json, updated_at from ${ATTEMPTS}`)
    .all() as Array<Record<string, unknown>>
  const insert = db.prepare(`insert into ${NEXT_ATTEMPTS}
    (edition_date, period_id, locale, attempt_no, state, failure_code, started_at, finished_at, trace_json, cleaned_at)
    values (?, ?, ?, 1, ?, null, ?, ?, ?, null)`)
  for (const row of rows) {
    const traceJson = row.trace_json === null || row.trace_json === undefined ? null : String(row.trace_json)
    const finishedAt = String(row.updated_at)
    insert.run(
      String(row.edition_date),
      String(row.period_id ?? DEFAULT_PERIOD_ID),
      String(row.locale),
      attemptState(traceJson),
      finishedAt,
      finishedAt,
      traceJson
    )
  }
  return rows.length
}

function attemptState(traceJson: string | null): 'running' | 'succeeded' | 'failed' {
  if (!traceJson) return 'failed'
  try {
    const state = (JSON.parse(traceJson) as { state?: unknown }).state
    return state === 'running' || state === 'succeeded' ? state : 'failed'
  } catch {
    return 'failed'
  }
}

function currentVersion(db: SqliteDatabase): number {
  const row = db.prepare('pragma user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

function tableExists(db: SqliteDatabase, table: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table) as { name?: string } | undefined
  return row?.name === table
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return tableExists(db, table) && tableColumns(db, table).includes(column)
}

function count(db: SqliteDatabase, table: string): number {
  if (!tableExists(db, table)) return 0
  const row = db.prepare(`select count(*) as rows from ${table}`).get() as { rows?: number } | undefined
  return Number(row?.rows ?? 0)
}

export function tableColumns(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name?: string }>
  return rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
}
