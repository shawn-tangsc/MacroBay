import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const dailyBriefSessionLinkStoragePolicy = Object.freeze({
  fileName: 'daily-brief-sessions.sqlite',
  schemaVersion: 2
})

export type DailyBriefSessionState = 'running' | 'accepted' | 'failed' | 'abandoned'

export type DailyBriefSessionLink = Readonly<{
  editionKey: string
  sessionId: string
  editionDate: string
  locale: 'zh-CN' | 'en-US'
  state: DailyBriefSessionState
  createdAt: string
  updatedAt: string
}>

export type DailyBriefSessionLinkStore = Readonly<{
  findBySession: (sessionId: string) => Promise<DailyBriefSessionLink | undefined>
  listByEdition: (editionKey: string) => Promise<readonly DailyBriefSessionLink[]>
  put: (link: DailyBriefSessionLink) => Promise<void>
  remove: (sessionIds: readonly string[]) => Promise<void>
  listBefore: (date: string) => Promise<readonly DailyBriefSessionLink[]>
}>

export function createDailyBriefSessionLinkStore(filePath: string): DailyBriefSessionLinkStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('pragma journal_mode = wal; pragma synchronous = full;')
  const version = Number((db.prepare('pragma user_version').get() as { user_version?: number }).user_version ?? 0)
  const hasOldTable = Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'daily_brief_session_links'").get())
  if (version < 2 && hasOldTable) {
    db.exec('alter table daily_brief_session_links rename to daily_brief_session_links_v1;')
  }
  db.exec(`
    create table if not exists daily_brief_session_links (
      session_id text primary key,
      edition_key text not null,
      edition_date text not null,
      locale text not null,
      state text not null check(state in ('running','accepted','failed','abandoned')),
      created_at text not null,
      updated_at text not null
    );
    create index if not exists idx_daily_brief_session_links_edition on daily_brief_session_links(edition_key, created_at);
    create index if not exists idx_daily_brief_session_links_date on daily_brief_session_links(edition_date);
    pragma user_version = ${dailyBriefSessionLinkStoragePolicy.schemaVersion};
  `)
  if (version < 2 && hasOldTable) {
    db.exec(`
      insert or ignore into daily_brief_session_links (session_id, edition_key, edition_date, locale, state, created_at, updated_at)
      select session_id, edition_key, edition_date, locale, state, created_at, updated_at from daily_brief_session_links_v1;
      drop table if exists daily_brief_session_links_v1;
    `)
  }
  const getBySession = db.prepare('select * from daily_brief_session_links where session_id = ?')
  const byEdition = db.prepare('select * from daily_brief_session_links where edition_key = ? order by created_at asc')
  const before = db.prepare('select * from daily_brief_session_links where edition_date < ? order by edition_date asc')
  const put = db.prepare(`
    insert into daily_brief_session_links (edition_key, session_id, edition_date, locale, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(session_id) do update set state = excluded.state, updated_at = excluded.updated_at
  `)
  const remove = db.prepare('delete from daily_brief_session_links where session_id = ?')
  return Object.freeze({
    async findBySession(sessionId) { return row(getBySession.get(sessionId) as Row | undefined) },
    async listByEdition(editionKey) { return Object.freeze((byEdition.all(editionKey) as Row[]).map(row).filter(isLink)) },
    async listBefore(date) { return Object.freeze((before.all(date) as Row[]).map(row).filter(isLink)) },
    async put(link) { put.run(link.editionKey, link.sessionId, link.editionDate, link.locale, link.state, link.createdAt, link.updatedAt) },
    async remove(sessionIds) { for (const id of sessionIds) remove.run(id) }
  })
}

type Row = Record<string, unknown>

function row(value: Row | undefined): DailyBriefSessionLink | undefined {
  if (!value) return undefined
  const editionKey = String(value.edition_key ?? '')
  const sessionId = String(value.session_id ?? '')
  const editionDate = String(value.edition_date ?? '')
  const locale = value.locale === 'en-US' ? 'en-US' : 'zh-CN'
  const state = value.state
  if (!editionKey || !sessionId || !editionDate || !['running', 'accepted', 'failed', 'abandoned'].includes(String(state))) return undefined
  return Object.freeze({ editionKey, sessionId, editionDate, locale: locale as 'zh-CN' | 'en-US', state: state as DailyBriefSessionState, createdAt: String(value.created_at ?? ''), updatedAt: String(value.updated_at ?? '') })
}

function isLink(value: DailyBriefSessionLink | undefined): value is DailyBriefSessionLink { return Boolean(value) }
