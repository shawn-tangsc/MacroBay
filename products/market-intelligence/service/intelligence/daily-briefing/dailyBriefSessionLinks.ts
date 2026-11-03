import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'

export const dailyBriefSessionLinkStoragePolicy = Object.freeze({
  fileName: 'daily-brief-sessions.sqlite',
  schemaVersion: 3
})

export type DailyBriefSessionState = 'running' | 'accepted' | 'failed' | 'abandoned'

/**
 * One writing session and the edition it belongs to. The edition's identity is the tuple
 * `(edition_date, period_id, locale)`; no composed `date:locale:period` string exists anywhere,
 * because a string key is what made a migrated row unreachable once the period was added.
 *
 * `attemptNo` references the attempt row the session writes and is never allocated here: the
 * attempt store owns that sequence. Rows written before attempts were recorded keep it absent.
 */
export type DailyBriefSessionLink = Readonly<{
  editionDate: string
  periodId: string
  locale: 'zh-CN' | 'en-US'
  attemptNo?: number
  sessionId: string
  state: DailyBriefSessionState
  createdAt: string
  updatedAt: string
}>

export type DailyBriefSessionLinkStore = Readonly<{
  findBySession: (sessionId: string) => Promise<DailyBriefSessionLink | undefined>
  listByEdition: (editionDate: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<readonly DailyBriefSessionLink[]>
  put: (link: DailyBriefSessionLink) => Promise<void>
  remove: (sessionIds: readonly string[]) => Promise<void>
  listBefore: (date: string) => Promise<readonly DailyBriefSessionLink[]>
  /** Every language of one issue; returns how many links were removed (0 when already clean). */
  deletePeriod: (editionDate: string, periodId: string) => Promise<number>
}>

const TABLE = 'daily_brief_session_links'
/** The old shape that stored the period inside a composed key; copied once, then dropped. */
const COMPOSED_KEY_TABLE = 'daily_brief_session_links_keyed'

export function createDailyBriefSessionLinkStore(filePath: string): DailyBriefSessionLinkStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = openSqliteDatabase(filePath)
  db.exec('pragma synchronous = full;')
  migrateComposedKeyShape(db)
  db.exec(createLinksSql())
  db.exec(`pragma user_version = ${dailyBriefSessionLinkStoragePolicy.schemaVersion};`)
  const getBySession = db.prepare(`select * from ${TABLE} where session_id = ?`)
  const byEdition = db.prepare(`select * from ${TABLE} where edition_date = ? and period_id = ? and locale = ? order by attempt_no asc, created_at asc`)
  const before = db.prepare(`select * from ${TABLE} where edition_date < ? order by edition_date asc`)
  const put = db.prepare(`
    insert into ${TABLE} (edition_date, period_id, locale, attempt_no, session_id, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(session_id) do update set state = excluded.state, updated_at = excluded.updated_at
  `)
  const remove = db.prepare(`delete from ${TABLE} where session_id = ?`)
  const removePeriod = db.prepare(`delete from ${TABLE} where edition_date = ? and period_id = ?`)
  return Object.freeze({
    async findBySession(sessionId) { return row(getBySession.get(sessionId) as Row | undefined) },
    async listByEdition(editionDate, periodId, locale) {
      return Object.freeze((byEdition.all(editionDate, periodId, locale) as Row[]).map(row).filter(isLink))
    },
    async listBefore(date) { return Object.freeze((before.all(date) as Row[]).map(row).filter(isLink)) },
    async put(link) {
      put.run(link.editionDate, link.periodId, link.locale, link.attemptNo ?? null, link.sessionId, link.state, link.createdAt, link.updatedAt)
    },
    async remove(sessionIds) { for (const id of sessionIds) remove.run(id) },
    async deletePeriod(editionDate, periodId) { return Number(removePeriod.run(editionDate, periodId).changes ?? 0) }
  })
}

function createLinksSql(): string {
  return `
    create table if not exists ${TABLE} (
      session_id text primary key,
      edition_date text not null,
      period_id text not null,
      locale text not null,
      attempt_no integer,
      state text not null check(state in ('running','accepted','failed','abandoned')),
      created_at text not null,
      updated_at text not null
    );
    create index if not exists idx_daily_brief_session_links_edition on ${TABLE}(edition_date, period_id, locale, attempt_no);
    create index if not exists idx_daily_brief_session_links_date on ${TABLE}(edition_date);
  `
}

/**
 * Copies the shape that hid the period inside `edition_key` into the column shape, then drops it.
 *
 * The sessions of one edition are numbered in creation order, because that is exactly the ordinal
 * the old code derived (`listByEdition().length + 1`); losing it would lose the "2nd attempt" the
 * history rail shows. `period_id` becomes the literal default: several periods did not exist when
 * these rows were written. The copy runs in one `exec` so a crash leaves either the old table or
 * the complete copy, never half of each.
 */
function migrateComposedKeyShape(db: ReturnType<typeof openSqliteDatabase>): void {
  if (!tableColumns(db, TABLE).includes('edition_key')) return
  db.exec(`alter table ${TABLE} rename to ${COMPOSED_KEY_TABLE};`)
  db.exec(createLinksSql())
  db.exec(`
    insert or ignore into ${TABLE} (session_id, edition_date, period_id, locale, attempt_no, state, created_at, updated_at)
    select legacy.session_id, legacy.edition_date, '${DEFAULT_PERIOD_ID}', legacy.locale,
      (select count(*) from ${COMPOSED_KEY_TABLE} earlier
        where earlier.edition_date = legacy.edition_date
          and earlier.locale = legacy.locale
          and (earlier.created_at < legacy.created_at
            or (earlier.created_at = legacy.created_at and earlier.session_id <= legacy.session_id))),
      legacy.state, legacy.created_at, legacy.updated_at
    from ${COMPOSED_KEY_TABLE} legacy;
    drop table ${COMPOSED_KEY_TABLE};
  `)
}

function tableColumns(db: ReturnType<typeof openSqliteDatabase>, table: string): string[] {
  const exists = db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)
  if (!exists) return []
  return (db.prepare(`pragma table_info(${table})`).all() as { name?: string }[]).map((column) => String(column.name ?? ''))
}

type Row = Record<string, unknown>

function row(value: Row | undefined): DailyBriefSessionLink | undefined {
  if (!value) return undefined
  const sessionId = String(value.session_id ?? '')
  const editionDate = String(value.edition_date ?? '')
  const periodId = String(value.period_id ?? '')
  const state = value.state
  if (!sessionId || !editionDate || !periodId) return undefined
  if (!['running', 'accepted', 'failed', 'abandoned'].includes(String(state))) return undefined
  const attemptNo = typeof value.attempt_no === 'number' && Number.isInteger(value.attempt_no) ? value.attempt_no : undefined
  return Object.freeze({
    editionDate,
    periodId,
    locale: (value.locale === 'en-US' ? 'en-US' : 'zh-CN') as 'zh-CN' | 'en-US',
    ...(attemptNo === undefined ? {} : { attemptNo }),
    sessionId,
    state: state as DailyBriefSessionState,
    createdAt: String(value.created_at ?? ''),
    updatedAt: String(value.updated_at ?? '')
  })
}

function isLink(value: DailyBriefSessionLink | undefined): value is DailyBriefSessionLink { return Boolean(value) }
