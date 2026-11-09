import { statSync } from 'node:fs'

import type { DatabaseSync } from 'node:sqlite'

import { DEFAULT_PERIOD_ID, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'

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

export const DAILY_BRIEFING_STORAGE_VERSION = 4

/** The single issue every row belongs to before issue numbers existed. */
export const DEFAULT_PERIOD_ID_VALUE = DEFAULT_PERIOD_ID

/** Beside the database, one fixed name: the only thing a reader needs to go back to 0.3.x. */
export const DAILY_BRIEFING_BACKUP_SUFFIX = '.bak-v2'

/**
 * 从 v3 升到 v4（运行记录换主键）之前的副本。与 `.bak-v2` 一样只读、不参与迁移、不自动恢复；
 * 同名已存在时改用带 UTC 时间戳的名字，**绝不覆盖**。
 */
export const DAILY_BRIEFING_RUN_BACKUP_SUFFIX = '.bak-v3'

const EDITIONS = 'daily_briefings'
const ATTEMPTS = 'daily_briefing_attempts'
const PERIOD_RUNS = 'daily_briefing_period_runs'
const NEXT_EDITIONS = `${EDITIONS}_v3`
const NEXT_ATTEMPTS = `${ATTEMPTS}_v3`
const NEXT_PERIOD_RUNS = `${PERIOD_RUNS}_v4`

export type DailyBriefingMigrationSkipReason = 'backup-failed' | 'migration-failed'

export type DailyBriefingMigrationOutcome =
  | Readonly<{ status: 'current'; version: number }>
  | Readonly<{ status: 'initialized'; version: number }>
  /** `unknownLocales`: 回填时连 `primary_used` 都推不出语言的行数（坏数据兜底，必须进诊断）。 */
  | Readonly<{ status: 'migrated'; version: number; backupPath: string; unknownLocales: number }>
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
  -- 这一次跑的来源与窗口（用户 2026-11-06：列表每一行要自己说清身份）。老记录为空 → 显示「未记录」，
  -- 不许拿当前设置回填。
  trigger text,
  window_hours integer,
  primary key (edition_date, period_id, locale, attempt_no)
);`
}

export function createAttemptsIndexSql(table: string): string {
  return `create index if not exists idx_${table}_period on ${table}(edition_date, period_id);`
}

/**
 * One row per generated period **per language** (0.4.2 #18 / §7.1): what the run expected, which
 * frozen facts it wrote from, and how far it got. The language is part of the key because the two
 * languages of an issue are two runs; sharing one row made the second overwrite the first.
 *
 * A fresh database builds it directly; a v3 one rebuilds it in `upgradePeriodRuns` below.
 */
export function createPeriodRunsSql(table: string): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  period_id text not null,
  locale text not null,
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
  primary key (edition_date, period_id, locale)
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
  if (hasColumn(db, EDITIONS, 'period_id')) return upgradePeriodRuns({ db, filePath, status: 'current' })
  if (!tableExists(db, EDITIONS)) {
    db.exec(createEditionsSql(EDITIONS))
    db.exec(createAttemptsSql(ATTEMPTS))
    db.exec(createAttemptsIndexSql(ATTEMPTS))
    db.exec(`pragma user_version = ${DAILY_BRIEFING_STORAGE_VERSION};`)
    return upgradePeriodRuns({ db, filePath, status: 'initialized' })
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

  return upgradePeriodRuns({ db, filePath, status: 'migrated', previousBackupPath: backupPath })
}

type PeriodRunsUpgrade = Readonly<{
  db: SqliteDatabase
  filePath: string
  status: 'current' | 'initialized' | 'migrated'
  /** v2→v3 那一步留下的副本；只在前面的升级真的写过它时存在。 */
  previousBackupPath?: string
}>

/**
 * v3 → v4：运行记录表主键补上 `locale`（0.4.2 #18 / §7.1）。
 *
 * 只追加一个分支，不动已发布的 v2→v3 迁移与 `.bak-v2`。门有两道——`user_version` 与主键形状
 * （`pragma table_info` 里 `locale` 是不是主键的一部分）；已是新形状直接 `current`，半成品
 * `_v4` 先删。旧表存在而形状不对时：先 `vacuum into .bak-v3`（同名用 UTC 时间戳，绝不覆盖），
 * 再在一个事务里建新表→逐行回填 locale→计数与键核对→换名；任何一步失败都回滚，旧表与
 * `user_version` 原样，应用继续在旧形状上跑（读写侧有旧形状分支）。
 */
function upgradePeriodRuns(input: PeriodRunsUpgrade): DailyBriefingMigrationOutcome {
  const { db, filePath, status } = input
  const version = DAILY_BRIEFING_STORAGE_VERSION
  if (periodRunKeyHasLocale(db)) {
    if (currentVersion(db) < version) db.exec(`pragma user_version = ${version};`)
    return finishedOutcome(status, version, input.previousBackupPath ?? '', 0)
  }
  if (!tableExists(db, PERIOD_RUNS)) {
    // 全新库（或从未写过运行记录）：直接按新主键建，没有旧行要回填，也不需要副本。
    db.exec(`drop table if exists ${NEXT_PERIOD_RUNS};`)
    db.exec(createPeriodRunsSql(PERIOD_RUNS))
    db.exec(`pragma user_version = ${version};`)
    return finishedOutcome(status, version, input.previousBackupPath ?? '', 0)
  }

  let backupPath = ''
  if (filePath !== ':memory:') {
    backupPath = unusedBackupPath(filePath, DAILY_BRIEFING_RUN_BACKUP_SUFFIX)
    try {
      db.exec(`vacuum into '${backupPath.replaceAll("'", "''")}'`)
    } catch {
      return { status: 'skipped', version: currentVersion(db), reason: 'backup-failed' }
    }
  }

  db.exec('begin immediate')
  try {
    // 我们自己的临时物：上一次失败留下的半成品先删再建。
    db.exec(`drop table if exists ${NEXT_PERIOD_RUNS};`)
    db.exec(createPeriodRunsSql(NEXT_PERIOD_RUNS))
    const { copied, unknownLocales } = copyPeriodRuns(db)
    if (copied !== count(db, PERIOD_RUNS) || distinctRunKeys(db, NEXT_PERIOD_RUNS) !== distinctRunKeys(db, PERIOD_RUNS)) {
      throw new Error('daily-briefing-run-migration-row-count-mismatch')
    }
    db.exec(`drop table ${PERIOD_RUNS}; alter table ${NEXT_PERIOD_RUNS} rename to ${PERIOD_RUNS};`)
    db.exec(`pragma user_version = ${version};`)
    db.exec('commit')
    return { status: 'migrated', version, backupPath, unknownLocales }
  } catch {
    rollbackQuietly(db)
    return { status: 'skipped', version: currentVersion(db), reason: 'migration-failed' }
  }
}

function finishedOutcome(
  status: PeriodRunsUpgrade['status'],
  version: number,
  backupPath: string,
  unknownLocales: number
): DailyBriefingMigrationOutcome {
  return status === 'migrated'
    ? { status, version, backupPath, unknownLocales }
    : { status, version }
}

/** `user_version` 门之外的第二道：`locale` 必须真的在主键里，而不只是存在这一列。 */
function periodRunKeyHasLocale(db: SqliteDatabase): boolean {
  if (!tableExists(db, PERIOD_RUNS)) return false
  const rows = db.prepare(`pragma table_info(${PERIOD_RUNS})`).all() as Array<{ name?: unknown; pk?: unknown }>
  return rows.some((row) => row.name === 'locale' && Number(row.pk ?? 0) > 0)
}

/** 同名副本已存在时换一个带 UTC 时间戳的名字；任何情况下都不覆盖已有副本。 */
function unusedBackupPath(filePath: string, suffix: string): string {
  const base = `${filePath}${suffix}`
  if (!isRegularFile(base)) return base
  const stamp = new Date().toISOString().replace(/[-:.]/g, '')
  let candidate = `${base}-${stamp}`
  let index = 1
  while (isRegularFile(candidate)) candidate = `${base}-${stamp}-${index++}`
  return candidate
}

function copyPeriodRuns(db: SqliteDatabase): Readonly<{ copied: number; unknownLocales: number }> {
  const columns = tableColumns(db, PERIOD_RUNS)
  // `direction` / `edition_rows` 是后加的两列：老库可能还没补上，回填时用与读取侧相同的默认值。
  const direction = columns.includes('direction') ? "coalesce(direction, 'undecided')" : "'undecided'"
  const editionRows = columns.includes('edition_rows') ? "coalesce(edition_rows, '[]')" : "'[]'"
  const rows = db.prepare(`select edition_date, period_id, expected_locales, primary_requested, primary_used,
      fallback_reason, snapshot_id, snapshot_hash, content_version, writing_rounds, ${direction} as direction,
      ${editionRows} as edition_rows, state, started_at, finished_at from ${PERIOD_RUNS}`).all() as Array<Record<string, unknown>>
  const insert = db.prepare(`insert into ${NEXT_PERIOD_RUNS}
    (edition_date, period_id, locale, expected_locales, primary_requested, primary_used, fallback_reason,
     snapshot_id, snapshot_hash, content_version, writing_rounds, direction, edition_rows, state, started_at, finished_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  let unknownLocales = 0
  for (const row of rows) {
    const locale = runLocaleOf(row)
    if (locale === 'unknown') unknownLocales += 1
    insert.run(
      String(row.edition_date), String(row.period_id), locale, String(row.expected_locales),
      String(row.primary_requested), String(row.primary_used),
      row.fallback_reason === null || row.fallback_reason === undefined ? null : String(row.fallback_reason),
      String(row.snapshot_id), String(row.snapshot_hash), Number(row.content_version), Number(row.writing_rounds),
      String(row.direction), String(row.edition_rows), String(row.state), String(row.started_at),
      row.finished_at === null || row.finished_at === undefined ? null : String(row.finished_at)
    )
  }
  return Object.freeze({ copied: rows.length, unknownLocales })
}

/**
 * 旧行的语言：`expected_locales` 的**唯一**合法元素 → `primary_used` → `unknown`。
 * 被覆盖掉的那一轮已经不在库里，迁移不补行——报告里写明丢的是哪几轮，不冒充已恢复。
 */
function runLocaleOf(row: Record<string, unknown>): DailyBriefingLocale | 'unknown' {
  const expected = singleExpectedLocale(row.expected_locales)
  if (expected !== undefined) return expected
  const used = row.primary_used
  return used === 'zh-CN' || used === 'en-US' ? used : 'unknown'
}

function singleExpectedLocale(value: unknown): DailyBriefingLocale | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 1) return undefined
    const only = parsed[0]
    return only === 'zh-CN' || only === 'en-US' ? only : undefined
  } catch {
    return undefined
  }
}

function distinctRunKeys(db: SqliteDatabase, table: string): number {
  const row = db.prepare(`select count(*) as keys from (select distinct edition_date, period_id from ${table})`).get() as { keys?: unknown } | undefined
  return Number(row?.keys ?? 0)
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

/**
 * 「删除这一版」的操作记录（用户 2026-11-06 拍板）。
 *
 * **只记录，不还原**：没有正文、没有副本、没有恢复入口，数据删了就是没了；这张表只回答
 * "某天某版是谁在什么时候、从哪个入口删的、成没成"。append-only：谁也不许改自己写过的那一行。
 */
export function createDeleteAuditSql(table = 'daily_briefing_delete_audit'): string {
  return `create table if not exists ${table} (
  at text not null,
  entry text not null check(entry in ('toolbar','row-menu')),
  edition_date text not null,
  period_id text not null,
  locale text not null,
  outcome text not null check(outcome in ('success','failed')),
  failure_code text,
  primary key (at, edition_date, period_id, locale, entry)
);`
}
