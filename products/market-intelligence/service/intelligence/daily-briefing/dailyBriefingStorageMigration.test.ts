import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingSqliteStore, dailyBriefingStoragePolicy } from './dailyBriefingStore'

/**
 * Upgrading the briefing store.
 *
 * Two promises are being kept here, and they are the reason this migration exists at all: an edition
 * is written once and never re-derived, so it must survive a schema change; and the previous release
 * can only be reached by restoring the copy this migration leaves behind, which means that copy has
 * to be a real, complete database rather than a directory listing.
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

/** A database as the previous release wrote it: one row per day, no issue number. */
function previousReleaseDatabase(): string {
  directory = mkdtempSync(join(tmpdir(), 'briefing-migration-'))
  const filePath = join(directory, 'daily-briefings.sqlite')
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

describe('daily briefing storage migration', () => {
  it('copies every edition and attempt across instead of dropping them', async () => {
    const filePath = previousReleaseDatabase()
    const store = createDailyBriefingSqliteStore(filePath)

    const first = await store.get('2026-10-29', 'zh-CN')
    const second = await store.get('2026-10-30', 'zh-CN')
    expect(first?.document.lede.text).toBe('2026-10-29 要点')
    expect(second?.document.lede.text).toBe('2026-10-30 要点')
    expect(await store.getAttempt?.('2026-10-30', 'zh-CN')).toMatchObject({ state: 'failed' })

    // The rows keep their issue number, which is what makes them reachable by the old API.
    const rows = rowsIn(filePath, 'select edition_serial, schema_version from daily_briefings order by edition_date')
    expect(rows).toEqual([
      { edition_serial: dailyBriefingStoragePolicy.defaultEditionSerial, schema_version: dailyBriefingStoragePolicy.schemaVersion },
      { edition_serial: dailyBriefingStoragePolicy.defaultEditionSerial, schema_version: dailyBriefingStoragePolicy.schemaVersion }
    ])
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: dailyBriefingStoragePolicy.schemaVersion }])
  })

  it('leaves a complete copy of the previous release beside the database', async () => {
    const filePath = previousReleaseDatabase()
    const before = rowsIn(filePath, 'select document_json from daily_briefings order by edition_date')

    createDailyBriefingSqliteStore(filePath)

    // This copy is how a reader goes back to 0.3.1: it must be a database, not a marker.
    const backups = readdirSync(join(filePath, '..')).filter((name) => name.startsWith('daily-briefings.sqlite.pre-'))
    expect(backups).toHaveLength(1)
    const backupPath = join(filePath, '..', backups[0]!)
    expect(rowsIn(backupPath, 'pragma user_version')).toEqual([{ user_version: 2 }])
    expect(rowsIn(backupPath, 'select document_json from daily_briefings order by edition_date')).toEqual(before)
  })

  it('runs safely a second time and does not replace the first copy', async () => {
    const filePath = previousReleaseDatabase()
    createDailyBriefingSqliteStore(filePath)
    const firstPass = readdirSync(join(filePath, '..')).filter((name) => name.startsWith('daily-briefings.sqlite.pre-'))
    const rowsAfterFirst = rowsIn(filePath, 'select document_json from daily_briefings order by edition_date')

    const reopened = createDailyBriefingSqliteStore(filePath)
    expect(await reopened.get('2026-10-30', 'zh-CN')).toBeDefined()
    expect(rowsIn(filePath, 'select document_json from daily_briefings order by edition_date')).toEqual(rowsAfterFirst)
    // A resumed run must not overwrite the copy that matches the release the reader came from.
    expect(readdirSync(join(filePath, '..')).filter((name) => name.startsWith('daily-briefings.sqlite.pre-'))).toEqual(firstPass)
  })

  it('starts a fresh database at the current version without a backup', async () => {
    directory = mkdtempSync(join(tmpdir(), 'briefing-migration-'))
    const filePath = join(directory, 'daily-briefings.sqlite')
    const store = createDailyBriefingSqliteStore(filePath)
    await store.put({
      date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
      windowStart: '2026-10-30T00:00:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z',
      document: document('2026-10-30', '新库')
    })
    expect(rowsIn(filePath, 'pragma user_version')).toEqual([{ user_version: dailyBriefingStoragePolicy.schemaVersion }])
    expect(existsSync(`${filePath}.pre-3-x.bak`)).toBe(false)
    expect(readdirSync(directory).filter((name) => name.includes('.pre-'))).toEqual([])
  })
})
