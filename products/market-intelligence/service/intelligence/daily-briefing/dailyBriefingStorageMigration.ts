import { copyFileSync, existsSync } from 'node:fs'

import type { DatabaseSync } from 'node:sqlite'

/** The handle the store owns; the migration needs nothing beyond it. */
export type SqliteDatabase = DatabaseSync

/**
 * Storage migration for the daily brief: from one edition per day to one edition per day *and*
 * issue number.
 *
 * Two rules shape this file, both from the release it prepares:
 *
 * - **No `drop table` on the data.** The old store threw the table away whenever the schema version
 *   moved, which was fine while the document could be rebuilt. It is not fine here: an edition is
 *   written once and never re-derived, so dropping it loses the reader's history. The migration
 *   builds the new table beside the old one, copies row by row, checks the row counts match, and
 *   only then swaps it in.
 * - **Back up before touching anything.** Going back to the previous release means restoring that
 *   copy, not running a reverse migration — the release note says so, and this is the file that
 *   makes the sentence true.
 *
 * Re-running is safe: a database already at the current version reports "already current", and a
 * half-finished migration resumes from whatever tables exist.
 */

export const DAILY_BRIEFING_STORAGE_VERSION = 3

/** The issue number every row gets when the date alone identified it. */
export const LEGACY_EDITION_SERIAL = 'default'

const EDITIONS = 'daily_briefings'
const ATTEMPTS = 'daily_briefing_attempts'
const NEXT_EDITIONS = `${EDITIONS}_v3`
const NEXT_ATTEMPTS = `${ATTEMPTS}_v3`

/** The editions table, under any name: the migration builds it beside the old one, then swaps. */
export function createEditionsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  locale text not null,
  edition_serial text not null default '${LEGACY_EDITION_SERIAL}',
  generated_at text not null,
  window_start text not null,
  window_end text not null,
  document_json text not null,
  schema_version integer not null,
  primary key (edition_date, locale, edition_serial)
);`
}

/** Failed attempts, same shape: the issue number joins the key. */
export function createAttemptsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  locale text not null,
  edition_serial text not null default '${LEGACY_EDITION_SERIAL}',
  trace_json text not null,
  updated_at text not null,
  primary key (edition_date, locale, edition_serial)
);`
}

export type MigrationOutcome = Readonly<{
  from: number
  to: number
  /** False when the database was already at the current version. */
  migrated: boolean
  /** Where the pre-migration copy went; absent for an in-memory database or nothing to lose. */
  backupPath?: string
}>

type MigrationInput = Readonly<{
  db: SqliteDatabase
  /** The database file, so the pre-migration copy can sit beside it. `:memory:` has no file. */
  filePath: string
  /** Suffix for the backup file; a timestamp keeps two upgrades on one day apart. */
  stamp: string
}>

export function migrateDailyBriefingStorage(input: MigrationInput): MigrationOutcome {
  const { db, filePath, stamp } = input
  const from = currentVersion(db)
  if (from >= DAILY_BRIEFING_STORAGE_VERSION) {
    return { from, to: from, migrated: false }
  }

  const legacyEditions = hasRows(db, EDITIONS)
  const legacyAttempts = hasRows(db, ATTEMPTS)
  const backupPath = legacyEditions || legacyAttempts
    ? backupBeforeMigrating(filePath, stamp)
    : undefined

  // Both tables are built, filled and swapped inside one transaction: a crash leaves either the old
  // world or the new one, never half of each.
  db.exec('begin immediate')
  try {
    createNextTables(db)
    if (legacyEditions) copyEditions(db)
    if (legacyAttempts) copyAttempts(db)
    const editionsMatch = !legacyEditions || count(db, EDITIONS) === count(db, NEXT_EDITIONS)
    const attemptsMatch = !legacyAttempts || count(db, ATTEMPTS) === count(db, NEXT_ATTEMPTS)
    if (!editionsMatch || !attemptsMatch) throw new Error('daily-briefing-migration-row-count-mismatch')
    db.exec(`drop table if exists ${EDITIONS}; alter table ${NEXT_EDITIONS} rename to ${EDITIONS};`)
    db.exec(`drop table if exists ${ATTEMPTS}; alter table ${NEXT_ATTEMPTS} rename to ${ATTEMPTS};`)
    db.exec(`pragma user_version = ${DAILY_BRIEFING_STORAGE_VERSION};`)
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }

  return {
    from,
    to: DAILY_BRIEFING_STORAGE_VERSION,
    migrated: true,
    ...(backupPath === undefined ? {} : { backupPath })
  }
}

/**
 * The pre-migration copy.
 *
 * Never overwrites: the first backup of an upgrade is the one that matches the release the reader
 * may want to go back to, and a second run of a resumed migration must not replace it with a
 * half-migrated file.
 */
function backupBeforeMigrating(filePath: string, stamp: string): string | undefined {
  if (filePath === ':memory:') return undefined
  const backupPath = `${filePath}.pre-${DAILY_BRIEFING_STORAGE_VERSION}-${stamp}.bak`
  if (existsSync(backupPath)) return backupPath
  copyFileSync(filePath, backupPath)
  return backupPath
}

function currentVersion(db: SqliteDatabase): number {
  const row = db.prepare('pragma user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

function tableExists(db: SqliteDatabase, table: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table) as { name?: string } | undefined
  return row?.name === table
}

function hasRows(db: SqliteDatabase, table: string): boolean {
  if (!tableExists(db, table)) return false
  return count(db, table) > 0
}

function count(db: SqliteDatabase, table: string): number {
  const row = db.prepare(`select count(*) as rows from ${table}`).get() as { rows?: number } | undefined
  return Number(row?.rows ?? 0)
}

function createNextTables(db: SqliteDatabase): void {
  // Built under temporary names first: the final names still hold the old rows.
  db.exec(createEditionsSql(NEXT_EDITIONS))
  db.exec(createAttemptsSql(NEXT_ATTEMPTS))
}

function copyEditions(db: SqliteDatabase): void {
  const columns = tableColumns(db, EDITIONS)
  // A row written by the current version already has the serial; an older one gets the default.
  const serial = columns.includes('edition_serial') ? 'edition_serial' : `'${LEGACY_EDITION_SERIAL}'`
  db.exec(`insert or ignore into ${NEXT_EDITIONS}
    (edition_date, locale, edition_serial, generated_at, window_start, window_end, document_json, schema_version)
    select edition_date, locale, ${serial}, generated_at, window_start, window_end, document_json, ${DAILY_BRIEFING_STORAGE_VERSION}
    from ${EDITIONS}`)
}

function copyAttempts(db: SqliteDatabase): void {
  const columns = tableColumns(db, ATTEMPTS)
  const serial = columns.includes('edition_serial') ? 'edition_serial' : `'${LEGACY_EDITION_SERIAL}'`
  db.exec(`insert or ignore into ${NEXT_ATTEMPTS} (edition_date, locale, edition_serial, trace_json, updated_at)
    select edition_date, locale, ${serial}, trace_json, updated_at from ${ATTEMPTS}`)
}

function tableColumns(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name?: string }>
  return rows.flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
}
