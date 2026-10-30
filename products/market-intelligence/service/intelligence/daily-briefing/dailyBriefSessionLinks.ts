import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const dailyBriefSessionLinkStoragePolicy = Object.freeze({
  fileName: 'daily-brief-sessions.sqlite',
  schemaVersion: 1
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
  find: (editionKey: string) => Promise<DailyBriefSessionLink | undefined>
  list: () => Promise<readonly DailyBriefSessionLink[]>
  put: (link: DailyBriefSessionLink) => Promise<void>
  remove: (sessionIds: readonly string[]) => Promise<void>
  listBefore: (date: string) => Promise<readonly DailyBriefSessionLink[]>
}>

export function createDailyBriefSessionLinkStore(filePath: string): DailyBriefSessionLinkStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('pragma journal_mode = wal; pragma synchronous = full;')
  db.exec(`
    create table if not exists daily_brief_session_links (
      edition_key text primary key,
      session_id text not null unique,
      edition_date text not null,
      locale text not null,
      state text not null check(state in ('running','accepted','failed','abandoned')),
      created_at text not null,
      updated_at text not null
    );
    create index if not exists idx_daily_brief_session_links_date on daily_brief_session_links(edition_date);
    pragma user_version = ${dailyBriefSessionLinkStoragePolicy.schemaVersion};
  `)
  const get = db.prepare('select * from daily_brief_session_links where edition_key = ?')
  const all = db.prepare('select * from daily_brief_session_links order by edition_date desc')
  const before = db.prepare('select * from daily_brief_session_links where edition_date < ? order by edition_date asc')
  const put = db.prepare(`
    insert into daily_brief_session_links (edition_key, session_id, edition_date, locale, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(edition_key) do update set session_id = excluded.session_id, state = excluded.state, updated_at = excluded.updated_at
  `)
  const remove = db.prepare('delete from daily_brief_session_links where session_id = ?')
  return Object.freeze({
    async find(editionKey) { return row(get.get(editionKey) as Row | undefined) },
    async list() { return Object.freeze((all.all() as Row[]).map(row).filter(isLink)) },
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
