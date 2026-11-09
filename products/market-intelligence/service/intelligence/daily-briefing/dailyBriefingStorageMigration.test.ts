import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { DEFAULT_PERIOD_ID, type DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingSqliteStore, dailyBriefingStoragePolicy } from './dailyBriefingStore'
import {
  DAILY_BRIEFING_BACKUP_SUFFIX,
  DAILY_BRIEFING_RUN_BACKUP_SUFFIX,
  migrateDailyBriefingStorage
} from './dailyBriefingStorageMigration'

/**
 * Upgrading the briefing store.
 *
 * Three promises are being kept here, and they are the reason this migration exists at all: an
 * edition is written once and never re-derived, so it must survive a schema change; the previous
 * release can only be reached by restoring the copy this migration leaves behind, which means that
 * copy has to be a complete database on its own rather than a set of files that happen to sit
 * together; and a failed upgrade must leave the application working on the old shape instead of
 * taking the product down.
 */

const document = (date: string, text: string): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date, locale: 'zh-CN', generatedAt: `${date}T00:30:00.000Z`,
    windowStart: `${date}T00:00:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text, generatedAt: `${date}T00:30:00.000Z` },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: `${date}T00:30:00.000Z` }
})

let directory: string | undefined

afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

const workingDirectory = (): string => {
  directory = mkdtempSync(join(tmpdir(), 'briefing-migration-'))
  return directory
}

/** A database as the previous release wrote it: one row per day, no issue number. */
function previousReleaseDatabase(): string {
  const filePath = join(workingDirectory(), 'daily-briefings.sqlite')
  const db = openSqliteDatabase(filePath)
  db.exec(`
    create table daily_briefings (
      edition_date text not null,
      locale text not null,
      generated_at text not null,
      window_start text not null,
      window_end text not null,
      document_json text not null,
      schema_version integer not null,
      primary key (edition_date, locale)
    );
    create table daily_briefing_attempts (
      edition_date text not null,
      locale text not null,
      trace_json text not null,
      updated_at text not null,
      primary key (edition_date, locale)
    );
    pragma user_version = 2;
  `)
  const put = db.prepare(`insert into daily_briefings
    (edition_date, locale, generated_at, window_start, window_end, document_json, schema_version)
    values (?, ?, ?, ?, ?, ?, 2)`)
  for (const date of ['2026-10-29', '2026-10-30']) {
    put.run(date, 'zh-CN', `${date}T00:30:00.000Z`, `${date}T00:00:00.000Z`, `${date}T00:30:00.000Z`, JSON.stringify(document(date, `${date} 要点`)))
  }
  db.prepare(`insert into daily_briefing_attempts (edition_date, locale, trace_json, updated_at)
    values (?, ?, ?, ?)`).run('2026-10-30', 'zh-CN', JSON.stringify({
    attemptId: 'a', startedAt: '2026-10-30T00:30:00.000Z', finishedAt: '2026-10-30T00:31:00.000Z',
    state: 'failed', stages: [{ id: 'source', state: 'failed' }]
  }), '2026-10-30T00:31:00.000Z')
  db.close()
  return filePath
}

const rowsIn = (filePath: string, sql: string): unknown[] => {
  const db = openSqliteDatabase(filePath)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

const editionRows = (filePath: string): unknown[] => rowsIn(filePath, 'select edition_date, locale, document_json from daily_briefings order by edition_date, locale')

/**
 * A database at the v3 shape **after #19**: the two migrated tables already carry `period_id`,
 * `attempts` already has `nominal_at`, `user_version` is still 3, and the run table still has the
 * old `(edition_date, period_id)` key. This is the real starting point of the v4 upgrade, so the
 * fixture must not be one version older than the data it stands for.
 */
type V3RunRow = Readonly<{ date: string; periodId: string; expectedLocales: string; primaryUsed: string; state?: string }>

function v3Database(rows?: readonly V3RunRow[]): string {
  const filePath = join(workingDirectory(), 'daily-briefings.sqlite')
  const db = openSqliteDatabase(filePath)
  db.exec(`
    create table daily_briefings (
      edition_date text not null, period_id text not null default '${DEFAULT_PERIOD_ID}', locale text not null,
      generated_at text not null, window_start text not null, window_end text not null,
      document_json text not null, schema_version integer not null,
      primary key (edition_date, period_id, locale)
    );
    create table daily_briefing_attempts (
      edition_date text not null, period_id text not null default '${DEFAULT_PERIOD_ID}', locale text not null,
      attempt_no integer not null, state text not null, failure_code text, started_at text not null,
      finished_at text, trace_json text, cleaned_at text, trigger text, window_hours integer, nominal_at text,
      primary key (edition_date, period_id, locale, attempt_no)
    );
    create table daily_briefing_period_runs (
      edition_date text not null, period_id text not null, expected_locales text not null,
      primary_requested text not null, primary_used text not null, fallback_reason text,
      snapshot_id text not null, snapshot_hash text not null, content_version integer not null default 1,
      writing_rounds integer not null default 0, direction text not null default 'undecided',
      edition_rows text not null default '[]', state text not null, started_at text not null, finished_at text,
      primary key (edition_date, period_id)
    );
    pragma user_version = 3;
  `)
  const insert = db.prepare(`insert into daily_briefing_period_runs
    (edition_date, period_id, expected_locales, primary_requested, primary_used, snapshot_id, snapshot_hash, state, started_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const fixtureRows: readonly V3RunRow[] = rows ?? Array.from({ length: 21 }, (_, index) => {
    const date = `2026-10-${String(20 + Math.floor(index / 7)).padStart(2, '0')}`
    const periodId = index % 7 === 0 ? 'default' : `period_${String(index % 7)}`
    const locale = index % 3 === 0 ? 'en-US' : 'zh-CN'
    return { date, periodId, expectedLocales: JSON.stringify([locale]), primaryUsed: locale }
  })
  for (const row of fixtureRows) {
    insert.run(row.date, row.periodId, row.expectedLocales, row.primaryUsed, row.primaryUsed,
      `bs_${row.date}_${row.periodId}`, 'hash', row.state ?? 'published', `${row.date}T00:00:00.000Z`)
  }
  db.close()
  return filePath
}

const runFixture = (filePath: string) => {
  const db = openSqliteDatabase(filePath)
  try {
    return migrateDailyBriefingStorage({ db, filePath })
  } finally {
    db.close()
  }
}

describe('daily briefing storage migration', () => {
  it('copies every edition and attempt across instead of dropping them', async () => {
    const filePath = previousReleaseDatabase()
    const before = editionRows(filePath)
    const store = createDailyBriefingSqliteStore(filePath)

    expect((await store.get('2026-10-29', 'zh-CN'))?.document.lede.text).toBe('2026-10-29 要点')
    expect((await store.get('2026-10-30', 'zh-CN'))?.document.lede.text).toBe('2026-10-30 要点')
    expect(await store.getAttempt?.('2026-10-30', 'zh-CN')).toMatchObject({ state: 'failed' })
    expect(store.upgradeState?.()).toEqual({ state: 'ready' })

    // The document bytes are the acceptance item; the period is the only new column on the row.
    expect(editionRows(filePath)).toEqual(before)
    const rows = rowsIn(filePath, 'select period_id, schema_version from daily_briefings order by edition_date')
    expect(rows).toEqual([
      { period_id: DEFAULT_PERIOD_ID, schema_version: dailyBriefingStoragePolicy.schemaVersion },
      { period_id: DEFAULT_PERIOD_ID, schema_version: dailyBriefingStoragePolicy.schemaVersion }
    ])

    // The old attempt was the last failed attempt of its edition: attempt 1, finished at its last
    // write, with the trace kept and no cleanup mark invented.
    expect(rowsIn(filePath, `select edition_date, period_id, locale, attempt_no, state, failure_code, started_at, finished_at, cleaned_at
      from daily_briefing_attempts`)).toEqual([{
      edition_date: '2026-10-30', period_id: DEFAULT_PERIOD_ID, locale: 'zh-CN', attempt_no: 1,
      state: 'failed', failure_code: null,
      started_at: '2026-10-30T00:31:00.000Z', finished_at: '2026-10-30T00:31:00.000Z', cleaned_at: null
    }])
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: dailyBriefingStoragePolicy.schemaVersion }])
  })

  it('leaves a standalone copy of the previous release beside the database', async () => {
    const filePath = previousReleaseDatabase()
    const before = editionRows(filePath)

    createDailyBriefingSqliteStore(filePath)

    const backupPath = `${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`
    expect(existsSync(backupPath)).toBe(true)
    expect(rowsIn(backupPath, 'pragma user_version')).toEqual([{ user_version: 2 }])

    // The copy is the downgrade path, so it has to work on its own: move it away from the database
    // it came from, then open it like a reader restoring it would.
    const elsewhere = workingDirectory()
    const moved = join(elsewhere, 'restored.sqlite')
    renameSync(backupPath, moved)
    expect(rowsIn(moved, 'select edition_date, locale, document_json from daily_briefings order by edition_date, locale')).toEqual(before)
    expect(rowsIn(moved, 'pragma integrity_check')).toEqual([{ integrity_check: 'ok' }])
  })

  it('proves the plain file copy this migration replaced loses rows', async () => {
    // A WAL database keeps uncheckpointed pages in `-wal`. Copying the main file while writes are
    // pending is exactly the shortcut the plan forbids, and this case exists so nobody can quietly
    // go back to it: the same "open it alone and read it" check must fail.
    const root = workingDirectory()
    const sourcePath = join(root, 'wal.sqlite')
    const db = openSqliteDatabase(sourcePath)
    db.exec('pragma wal_autocheckpoint = 0;')
    db.exec('create table daily_briefings (edition_date text primary key, document_json text not null);')
    for (const date of ['2026-10-29', '2026-10-30']) {
      db.prepare('insert into daily_briefings (edition_date, document_json) values (?, ?)').run(date, '{"ok":true}')
    }
    const copied = join(root, 'plain-copy.sqlite')
    copyFileSync(sourcePath, copied)
    db.close()

    // Reading the copy the same way a restored archive is read: the rows are simply not there.
    const recovered = ((): unknown[] => {
      try {
        return rowsIn(copied, 'select edition_date from daily_briefings order by edition_date')
      } catch {
        return []
      }
    })()
    expect(recovered).not.toEqual([{ edition_date: '2026-10-29' }, { edition_date: '2026-10-30' }])
    expect(rowsIn(sourcePath, 'select edition_date from daily_briefings order by edition_date')).toEqual([
      { edition_date: '2026-10-29' }, { edition_date: '2026-10-30' }
    ])
  })

  it('runs safely a second time and does not replace the first copy', async () => {
    const filePath = previousReleaseDatabase()
    createDailyBriefingSqliteStore(filePath)
    const firstPass = readdirSync(join(filePath, '..')).filter((name) => name.startsWith('daily-briefings.sqlite'))
    const rowsAfterFirst = editionRows(filePath)

    const reopened = createDailyBriefingSqliteStore(filePath)
    expect(await reopened.get('2026-10-30', 'zh-CN')).toBeDefined()
    expect(reopened.upgradeState?.()).toEqual({ state: 'ready' })
    expect(editionRows(filePath)).toEqual(rowsAfterFirst)
    expect(readdirSync(join(filePath, '..')).filter((name) => name.startsWith('daily-briefings.sqlite'))).toEqual(firstPass)
  })

  it('keeps working on the old shape when the backup cannot be written, then upgrades on retry', async () => {
    const filePath = previousReleaseDatabase()
    const before = editionRows(filePath)
    // A directory where the backup belongs makes `vacuum into` fail without touching the database.
    mkdirSync(`${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`, { recursive: true })

    const store = createDailyBriefingSqliteStore(filePath)
    expect(store.upgradeState?.()).toEqual({ state: 'incomplete', reason: 'backup-failed' })
    // The reader keeps their history and can still generate while the upgrade is pending.
    expect((await store.get('2026-10-30', 'zh-CN'))?.document.lede.text).toBe('2026-10-30 要点')
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: 2 }])

    rmSync(`${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`, { recursive: true, force: true })
    expect(await store.retryUpgrade?.()).toEqual({ state: 'ready' })
    expect((await store.get('2026-10-30', 'zh-CN'))?.document.lede.text).toBe('2026-10-30 要点')
    expect(rowsIn(filePath, 'select edition_date, locale, document_json from daily_briefings order by edition_date, locale')).toEqual(before)
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: dailyBriefingStoragePolicy.schemaVersion }])
  })

  it('does not throw when the migration itself fails, and leaves the database on the old shape', async () => {
    const filePath = previousReleaseDatabase()
    // A table with the temporary name a successful migration would create makes the copy step fail.
    const db = openSqliteDatabase(filePath)
    db.exec('create table daily_briefings_v3 (wrong text);')
    db.close()

    const store = createDailyBriefingSqliteStore(filePath)
    expect(store.upgradeState?.()).toEqual({ state: 'incomplete', reason: 'migration-failed' })
    expect((await store.get('2026-10-29', 'zh-CN'))?.document.lede.text).toBe('2026-10-29 要点')
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: 2 }])
    expect(rowsIn(filePath, 'pragma table_info(daily_briefings)').map((row) => (row as { name: string }).name)).toEqual([
      'edition_date', 'locale', 'generated_at', 'window_start', 'window_end', 'document_json', 'schema_version'
    ])
  })

  it('starts a fresh database at the current version without a backup', async () => {
    const filePath = join(workingDirectory(), 'daily-briefings.sqlite')
    const store = createDailyBriefingSqliteStore(filePath)
    await store.put({
      date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
      windowStart: '2026-10-30T00:00:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z',
      document: document('2026-10-30', '新库')
    })
    expect(store.upgradeState?.()).toEqual({ state: 'ready' })
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: dailyBriefingStoragePolicy.schemaVersion }])
    expect(existsSync(`${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`)).toBe(false)
  })
})

/**
 * v3 → v4：运行记录的主键补上语言（0.4.2 #18，架构师方案 §7.1 的七条验收）。
 *
 * 这一笔只动存储：主键不是目的，`readRun`/`settleRun` 也必须按语言取键，否则第二语言照样改到
 * 第一语言那一行。下面第二、三条守的正是这件事。
 */
describe('v3 → v4: the run table is keyed by language', () => {
  const runInfo = (filePath: string): Array<{ name: string; pk: number }> =>
    rowsIn(filePath, 'pragma table_info(daily_briefing_period_runs)') as Array<{ name: string; pk: number }>

  it('keeps all 21 rows, gives each one a language, and no row falls back to unknown', () => {
    const filePath = v3Database()
    expect(runFixture(filePath)).toEqual({
      status: 'migrated',
      version: 4,
      backupPath: `${filePath}${DAILY_BRIEFING_RUN_BACKUP_SUFFIX}`,
      unknownLocales: 0
    })

    expect(rowsIn(filePath, 'select count(*) as n from daily_briefing_period_runs')).toEqual([{ n: 21 }])
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: 4 }])
    // 每个 (日期, 期号) 都还在，且语言只可能是这两种之一。
    const keys = rowsIn(filePath, 'select edition_date, period_id, locale from daily_briefing_period_runs') as Array<{ edition_date: string; period_id: string; locale: string }>
    expect(new Set(keys.map((key) => `${key.edition_date}:${key.period_id}`)).size).toBe(21)
    expect(keys.every((key) => key.locale === 'zh-CN' || key.locale === 'en-US')).toBe(true)
    // 形状门：`locale` 必须真的在主键里（第 3 列），不是只加了一列。
    expect(runInfo(filePath).find((row) => row.name === 'locale')?.pk).toBe(3)
  })

  it('keeps one row per language, so a zh settle never lands on the en row', async () => {
    const filePath = v3Database()
    const store = createDailyBriefingSqliteStore(filePath)
    const periodId = 'period_bilingual'
    const runOf = (locale: 'zh-CN' | 'en-US', snapshotId: string) => ({
      date: '2026-11-02', periodId, locale, expectedLocales: [locale] as const,
      primaryRequested: locale, primaryUsed: locale, snapshotId, snapshotHash: `hash-${locale}`,
      contentVersion: 1, writingRounds: 0, direction: 'bearish' as const, editionRows: [],
      state: 'running' as const, startedAt: '2026-11-02T00:00:00.000Z'
    })
    await store.openPeriodRun!(runOf('zh-CN', 'bs_zh'))
    await store.openPeriodRun!(runOf('en-US', 'bs_en'))
    await store.settlePeriodRun!({ date: '2026-11-02', periodId, locale: 'zh-CN', state: 'published', finishedAt: '2026-11-02T00:05:00.000Z', writingRounds: 1 })
    await store.settlePeriodRun!({ date: '2026-11-02', periodId, locale: 'en-US', state: 'failed', finishedAt: '2026-11-02T00:06:00.000Z' })

    const runs = await store.listPeriodRuns!('2026-11-02', '2026-11-02')
    expect(runs.map((run) => [run.locale, run.snapshotId, run.state]))
      .toEqual([['en-US', 'bs_en', 'failed'], ['zh-CN', 'bs_zh', 'published']])
    // 各自 `readRun` 取到自己的行：settle 带语言才修得掉「改到另一语言」这个症状。
    expect(await store.getPeriodRun!('2026-11-02', periodId, 'zh-CN'))
      .toMatchObject({ locale: 'zh-CN', snapshotId: 'bs_zh', state: 'published' })
    expect(await store.getPeriodRun!('2026-11-02', periodId, 'en-US'))
      .toMatchObject({ locale: 'en-US', snapshotId: 'bs_en', state: 'failed' })
  })

  it('runs a second time as current, without a new backup or a changed count', () => {
    const filePath = v3Database()
    expect(runFixture(filePath)).toMatchObject({ status: 'migrated' })
    expect(runFixture(filePath)).toEqual({ status: 'current', version: 4 })
    expect(rowsIn(filePath, 'select count(*) as n from daily_briefing_period_runs')).toEqual([{ n: 21 }])
    expect(readdirSync(join(filePath, '..')).filter((name) => name.includes(DAILY_BRIEFING_RUN_BACKUP_SUFFIX))).toHaveLength(1)
  })

  it('falls back to primary_used for a bad expected_locales, and counts an unknowable row', () => {
    const filePath = v3Database([
      { date: '2026-11-01', periodId: 'period_bad_expected', expectedLocales: '{not-json', primaryUsed: 'en-US' },
      { date: '2026-11-01', periodId: 'period_bad_both', expectedLocales: '[]', primaryUsed: 'bogus' }
    ])
    expect(runFixture(filePath)).toMatchObject({ status: 'migrated', unknownLocales: 1 })
    expect(rowsIn(filePath, 'select period_id, locale from daily_briefing_period_runs order by period_id')).toEqual([
      { period_id: 'period_bad_both', locale: 'unknown' },
      { period_id: 'period_bad_expected', locale: 'en-US' }
    ])
    expect(rowsIn(filePath, 'select count(*) as n from daily_briefing_period_runs')).toEqual([{ n: 2 }])
  })

  it('rolls back and keeps the old shape when a row cannot be copied', () => {
    const filePath = v3Database([
      { date: '2026-11-02', periodId: 'period_ok', expectedLocales: '["zh-CN"]', primaryUsed: 'zh-CN' },
      // 夹具故意没有 state 的 CHECK：这一行拷进新表时会被新表的 CHECK 拒绝，模拟拷贝中途抛错。
      { date: '2026-11-02', periodId: 'period_bad_state', expectedLocales: '["zh-CN"]', primaryUsed: 'zh-CN', state: 'bogus' }
    ])
    expect(runFixture(filePath)).toEqual({ status: 'skipped', version: 3, reason: 'migration-failed' })

    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: 3 }])
    expect(runInfo(filePath).some((row) => row.name === 'locale')).toBe(false)
    expect(rowsIn(filePath, 'select count(*) as n from daily_briefing_period_runs')).toEqual([{ n: 2 }])
    // 回滚后我们自己的临时表不许留下。
    expect(rowsIn(filePath, "select name from sqlite_master where type = 'table' and name = 'daily_briefing_period_runs_v4'")).toEqual([])
  })

  it('never touches .bak-v2 and writes .bak-v3 before the rebuild', () => {
    const filePath = v3Database()
    const v2Copy = `${filePath}${DAILY_BRIEFING_BACKUP_SUFFIX}`
    writeFileSync(v2Copy, 'reader can still restore 0.3.x')
    expect(runFixture(filePath)).toMatchObject({ status: 'migrated' })

    expect(readFileSync(v2Copy, 'utf8')).toBe('reader can still restore 0.3.x')
    const runBackup = `${filePath}${DAILY_BRIEFING_RUN_BACKUP_SUFFIX}`
    expect(existsSync(runBackup)).toBe(true)
    expect(rowsIn(runBackup, 'pragma user_version')).toEqual([{ user_version: 3 }])
    expect((rowsIn(runBackup, 'pragma table_info(daily_briefing_period_runs)') as Array<{ name: string }>)
      .some((row) => row.name === 'locale')).toBe(false)
  })

  it('creates the new key directly for a database that has never run a period', () => {
    const filePath = join(workingDirectory(), 'daily-briefings.sqlite')
    createDailyBriefingSqliteStore(filePath)
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: 4 }])
    expect(runInfo(filePath).find((row) => row.name === 'locale')?.pk).toBe(3)
    expect(existsSync(`${filePath}${DAILY_BRIEFING_RUN_BACKUP_SUFFIX}`)).toBe(false)
  })
})
