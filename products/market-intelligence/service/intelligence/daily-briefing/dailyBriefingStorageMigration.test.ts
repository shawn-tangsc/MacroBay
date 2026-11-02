import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { DEFAULT_PERIOD_ID, type DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingSqliteStore, dailyBriefingStoragePolicy } from './dailyBriefingStore'
import { DAILY_BRIEFING_BACKUP_SUFFIX } from './dailyBriefingStorageMigration'

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
