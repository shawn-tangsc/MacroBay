import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { isBriefingGenerationTrace, isDailyBriefingDocumentWithinBudget } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore, DailyBriefingStoredEdition } from './dailyBriefingService'
import {
  DAILY_BRIEFING_STORAGE_VERSION,
  LEGACY_EDITION_SERIAL,
  createAttemptsSql,
  createEditionsSql,
  migrateDailyBriefingStorage
} from './dailyBriefingStorageMigration'

export const dailyBriefingStoragePolicy = Object.freeze({
  fileName: 'daily-briefings.sqlite',
  schemaVersion: DAILY_BRIEFING_STORAGE_VERSION,
  /** Every edition written before issue numbers existed is issue "default". */
  defaultEditionSerial: LEGACY_EDITION_SERIAL
})

/**
 * One row per local day per language. Re-generating today replaces the row; history is immutable
 * because nothing writes an older date. The 14-day window is enforced by `prune`, called by the
 * service after a write, so the table can never grow past the retention promise.
 */
export function createDailyBriefingSqliteStore(filePath: string): DailyBriefingStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = openSqliteDatabase(filePath)
  db.exec('pragma synchronous = full;')
  // An edition is written once and never re-derived, so a schema change copies the rows across
  // instead of throwing them away; the migration also leaves a restorable copy beside the file.
  migrateDailyBriefingStorage({ db, filePath, stamp: new Date().toISOString().replace(/[:.]/g, '-') })
  db.exec(createEditionsSql('daily_briefings'))
  db.exec(createAttemptsSql('daily_briefing_attempts'))
  const getStatement = db.prepare('select * from daily_briefings where edition_date = ? and locale = ? and edition_serial = ?')
  const listStatement = db.prepare('select * from daily_briefings where locale = ? and edition_date >= ? and edition_date <= ? order by edition_date asc')
  const putStatement = db.prepare(`
    insert into daily_briefings (edition_date, locale, edition_serial, generated_at, window_start, window_end, document_json, schema_version)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(edition_date, locale, edition_serial) do update set
      generated_at = excluded.generated_at,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      document_json = excluded.document_json,
      schema_version = excluded.schema_version
  `)
  const pruneStatement = db.prepare('delete from daily_briefings where edition_date < ?')
  const putAttemptStatement = db.prepare(`
    insert into daily_briefing_attempts (edition_date, locale, edition_serial, trace_json, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(edition_date, locale, edition_serial) do update set
      trace_json = excluded.trace_json,
      updated_at = excluded.updated_at
  `)
  const getAttemptStatement = db.prepare('select trace_json from daily_briefing_attempts where edition_date = ? and locale = ? and edition_serial = ?')
  const clearAttemptStatement = db.prepare('delete from daily_briefing_attempts where edition_date = ? and locale = ? and edition_serial = ?')
  const pruneAttemptsStatement = db.prepare('delete from daily_briefing_attempts where edition_date < ?')

  return Object.freeze({
    async get(date, locale) {
      return parseRow(getStatement.get(date, locale, dailyBriefingStoragePolicy.defaultEditionSerial) as Row | undefined)
    },
    async put(edition) {
      if (!isDailyBriefingDocumentWithinBudget(edition.document)) throw new Error('daily-briefing-document-too-large')
      putStatement.run(
        edition.date,
        edition.locale,
        dailyBriefingStoragePolicy.defaultEditionSerial,
        edition.generatedAt,
        edition.windowStart,
        edition.windowEnd,
        JSON.stringify(edition.document),
        dailyBriefingStoragePolicy.schemaVersion
      )
    },
    async list(from, to, locale) {
      const rows = listStatement.all(locale, from, to) as Row[]
      return Object.freeze(rows.flatMap((row) => {
        const parsed = parseRow(row)
        return parsed ? [parsed] : []
      }))
    },
    async putAttempt(attempt) {
      putAttemptStatement.run(attempt.date, attempt.locale, dailyBriefingStoragePolicy.defaultEditionSerial, JSON.stringify(attempt.trace), attempt.trace.finishedAt)
    },
    async getAttempt(date, locale) {
      const row = getAttemptStatement.get(date, locale, dailyBriefingStoragePolicy.defaultEditionSerial) as { trace_json?: string } | undefined
      if (!row?.trace_json) return undefined
      try {
        const parsed = JSON.parse(row.trace_json) as unknown
        return isBriefingGenerationTrace(parsed) ? parsed : undefined
      } catch {
        return undefined
      }
    },
    async clearAttempt(date, locale) {
      clearAttemptStatement.run(date, locale, dailyBriefingStoragePolicy.defaultEditionSerial)
    },
    async prune(beforeDate) {
      pruneStatement.run(beforeDate)
      pruneAttemptsStatement.run(beforeDate)
    }
  })
}

type Row = Readonly<{
  edition_date: string
  locale: string
  generated_at: string
  window_start: string
  window_end: string
  document_json: string
  schema_version: number
}>

function parseRow(row: Row | undefined): DailyBriefingStoredEdition | undefined {
  if (!row) return undefined
  if (row.schema_version !== dailyBriefingStoragePolicy.schemaVersion) return undefined
  let document: DailyBriefingDocument
  try {
    document = JSON.parse(row.document_json) as DailyBriefingDocument
  } catch {
    return undefined
  }
  if (!isDailyBriefingDocumentWithinBudget(document)) return undefined
  return Object.freeze({
    date: row.edition_date,
    locale: row.locale as DailyBriefingLocale,
    generatedAt: row.generated_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    document
  })
}
