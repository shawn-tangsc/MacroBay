import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { isDailyBriefingDocumentWithinBudget } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore, DailyBriefingStoredEdition } from './dailyBriefingService'

export const dailyBriefingStoragePolicy = Object.freeze({
  fileName: 'daily-briefings.sqlite',
  schemaVersion: 1
})

/**
 * One row per local day per language. Re-generating today replaces the row; history is immutable
 * because nothing writes an older date. The 14-day window is enforced by `prune`, called by the
 * service after a write, so the table can never grow past the retention promise.
 */
export function createDailyBriefingSqliteStore(filePath: string): DailyBriefingStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('pragma journal_mode = wal; pragma synchronous = full;')
  const stored = Number((db.prepare('pragma user_version').get() as { user_version?: number }).user_version ?? 0)
  if (stored !== dailyBriefingStoragePolicy.schemaVersion) {
    // The document is derived; when the schema changes, old editions are rebuilt on next open.
    db.exec('drop table if exists daily_briefings;')
  }
  db.exec(`
    create table if not exists daily_briefings (
      edition_date text not null,
      locale text not null,
      generated_at text not null,
      window_start text not null,
      window_end text not null,
      document_json text not null,
      schema_version integer not null,
      primary key (edition_date, locale)
    );
    pragma user_version = ${dailyBriefingStoragePolicy.schemaVersion};
  `)
  const getStatement = db.prepare('select * from daily_briefings where edition_date = ? and locale = ?')
  const listStatement = db.prepare('select * from daily_briefings where locale = ? and edition_date >= ? and edition_date <= ? order by edition_date asc')
  const putStatement = db.prepare(`
    insert into daily_briefings (edition_date, locale, generated_at, window_start, window_end, document_json, schema_version)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(edition_date, locale) do update set
      generated_at = excluded.generated_at,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      document_json = excluded.document_json,
      schema_version = excluded.schema_version
  `)
  const pruneStatement = db.prepare('delete from daily_briefings where edition_date < ?')

  return Object.freeze({
    async get(date, locale) {
      return parseRow(getStatement.get(date, locale) as Row | undefined)
    },
    async put(edition) {
      if (!isDailyBriefingDocumentWithinBudget(edition.document)) throw new Error('daily-briefing-document-too-large')
      putStatement.run(
        edition.date,
        edition.locale,
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
    async prune(beforeDate) {
      pruneStatement.run(beforeDate)
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
