import type { DatabaseSync, StatementSync } from 'node:sqlite'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPosterFiles } from './briefingPosterFiles'

/**
 * 海报元数据：**一次版次版本一行**，主键 `(date, period_id, locale, edition_generated_at)`。
 *
 * - 重生成 = `edition_generated_at` 变 = 新增一行，**旧行不覆盖**：旧通知记录还带着旧 hash，
 *   删了它就只能发正文。
 * - `status` 是「没有」与「拿不到」的分界：查不到行＝这一版从没出过图；行在但 `status ≠ ready`
 *   ＝出了但失败/超时，原因码在行上。只靠「记录里没有 editionPoster」判两者，就是把失败
 *   显示成没有。
 * - 表里只存 `content_hash`，文件名由它派生（`briefingPosterFiles.posterFileName`）。
 *
 * 清理只有两个入口，都在这里：按日期的保留期 `pruneDate` 与按语言的 `deleteEdition`。
 * 两个调用点各写一遍迟早漏一条，所以仓储层是唯一实现。删文件前查引用：内容相同的两版共用
 * 同一个文件，直接删会把另一版的图删掉。
 */
export type BriefingPosterStatus = 'ready' | 'failed' | 'timeout'

export type BriefingPosterRow = Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
  editionGeneratedAt: string
  status: BriefingPosterStatus
  contentHash: string | null
  width: number | null
  height: number | null
  byteLength: number | null
  failureCode: string | null
  createdAt: string
}>

export type BriefingPosterRecordInput = Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
  editionGeneratedAt: string
  status: BriefingPosterStatus
  contentHash?: string
  width?: number
  height?: number
  byteLength?: number
  failureCode?: string
}>

export type BriefingPosterCleanup = Readonly<{ rows: number; removedFiles: number }>

export function createBriefingPostersSql(table = 'briefing_posters'): string {
  return `create table if not exists ${table} (
  edition_date text not null,
  period_id text not null,
  locale text not null,
  edition_generated_at text not null,
  status text not null check(status in ('ready','failed','timeout')),
  content_hash text,
  width integer,
  height integer,
  byte_length integer,
  failure_code text,
  created_at text not null,
  primary key (edition_date, period_id, locale, edition_generated_at)
);
create index if not exists ${table}_content_hash on ${table}(content_hash);`
}

type RawRow = {
  edition_date?: unknown
  period_id?: unknown
  locale?: unknown
  edition_generated_at?: unknown
  status?: unknown
  content_hash?: unknown
  width?: unknown
  height?: unknown
  byte_length?: unknown
  failure_code?: unknown
  created_at?: unknown
}

function parseRow(raw: RawRow | undefined): BriefingPosterRow | null {
  if (!raw) return null
  const status = raw.status === 'ready' || raw.status === 'failed' || raw.status === 'timeout' ? raw.status : null
  if (status === null) return null
  const locale = raw.locale === 'en-US' ? 'en-US' : 'zh-CN'
  return {
    date: String(raw.edition_date ?? ''),
    periodId: String(raw.period_id ?? ''),
    locale,
    editionGeneratedAt: String(raw.edition_generated_at ?? ''),
    status,
    contentHash: typeof raw.content_hash === 'string' && raw.content_hash.length > 0 ? raw.content_hash : null,
    width: typeof raw.width === 'number' ? raw.width : null,
    height: typeof raw.height === 'number' ? raw.height : null,
    byteLength: typeof raw.byte_length === 'number' ? raw.byte_length : null,
    failureCode: typeof raw.failure_code === 'string' && raw.failure_code.length > 0 ? raw.failure_code : null,
    createdAt: String(raw.created_at ?? '')
  }
}

export type BriefingPosterStore = Readonly<{
  record: (input: BriefingPosterRecordInput) => void
  byContentHash: (contentHash: string) => BriefingPosterRow | null
  byEdition: (input: Readonly<{
    date: string
    periodId: string
    locale: DailyBriefingLocale
    editionGeneratedAt: string
  }>) => BriefingPosterRow | null
  pruneDate: (beforeDate: string) => Promise<BriefingPosterCleanup>
  deleteEdition: (input: Readonly<{
    date: string
    periodId: string
    locale: DailyBriefingLocale
  }>) => Promise<BriefingPosterCleanup>
}>

export function createBriefingPosterStore(input: Readonly<{
  db: DatabaseSync
  files: Pick<BriefingPosterFiles, 'remove'>
  now: () => string
}>): BriefingPosterStore {
  const db = input.db
  // 取一次，别在 `record(input)` 里被同名参数遮住——那样写出来的 `created_at` 会是这个库里
  // 唯一一处「时间从参数里拿错了还不报错」的地方。
  const now = input.now
  db.exec(createBriefingPostersSql())

  const upsert = db.prepare(`insert into briefing_posters
    (edition_date, period_id, locale, edition_generated_at, status, content_hash, width, height, byte_length, failure_code, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(edition_date, period_id, locale, edition_generated_at) do update set
      status = excluded.status,
      content_hash = excluded.content_hash,
      width = excluded.width,
      height = excluded.height,
      byte_length = excluded.byte_length,
      failure_code = excluded.failure_code,
      created_at = excluded.created_at`)
  const selectByHash = db.prepare('select * from briefing_posters where content_hash = ? limit 1')
  const selectByEdition = db.prepare(`select * from briefing_posters
    where edition_date = ? and period_id = ? and locale = ? and edition_generated_at = ? limit 1`)
  // 候选必须在**删之前**按同一个判据取（严格早于），否则删完再查永远只剩「还没被删的行」。
  const distinctHashesForDate = db.prepare(`select distinct content_hash from briefing_posters
    where edition_date < ? and content_hash is not null`)
  // 与版次表的保留期同一个判据：**严格早于**截止日，等于那天的不动。
  const deleteForDate = db.prepare('delete from briefing_posters where edition_date < ?')
  const distinctHashesForEdition = db.prepare(`select distinct content_hash from briefing_posters
    where edition_date = ? and period_id = ? and locale = ? and content_hash is not null`)
  const deleteForEdition = db.prepare(`delete from briefing_posters
    where edition_date = ? and period_id = ? and locale = ?`)
  const stillReferenced = db.prepare('select 1 as hit from briefing_posters where content_hash = ? limit 1')

  /** 删行之后统一收尾部：只删「已经没有任何行引用」的文件。 */
  const removeUnreferenced = async (candidates: readonly string[]): Promise<number> => {
    let removed = 0
    for (const hash of candidates) {
      // `get()` 在没有行时按驱动不同可能给 undefined 或 null：两种都算「没有引用」。
      const stillInUse = stillReferenced.get(hash) as unknown
      if (stillInUse !== undefined && stillInUse !== null) continue
      await input.files.remove(hash)
      removed += 1
    }
    return removed
  }

  const hashesOf = (statement: StatementSync, ...args: string[]): string[] => {
    const rows = statement.all(...args) as { content_hash?: unknown }[]
    return rows
      .map((row) => (typeof row.content_hash === 'string' ? row.content_hash : null))
      .filter((hash): hash is string => hash !== null)
  }

  return {
    record(input) {
      upsert.run(
        input.date,
        input.periodId,
        input.locale,
        input.editionGeneratedAt,
        input.status,
        input.contentHash ?? null,
        input.width ?? null,
        input.height ?? null,
        input.byteLength ?? null,
        input.failureCode ?? null,
        now()
      )
    },

    byContentHash(contentHash) {
      return parseRow(selectByHash.get(contentHash) as RawRow | undefined)
    },

    byEdition(byEditionInput) {
      return parseRow(selectByEdition.get(
        byEditionInput.date,
        byEditionInput.periodId,
        byEditionInput.locale,
        byEditionInput.editionGeneratedAt
      ) as RawRow | undefined)
    },

    async pruneDate(beforeDate) {
      // 先取候选 hash 再删行：删完再查就只剩「还没被删的行」，永远判不出引用。
      const candidates = hashesOf(distinctHashesForDate, beforeDate)
      const rows = Number(deleteForDate.run(beforeDate).changes ?? 0)
      return { rows, removedFiles: await removeUnreferenced(candidates) }
    },

    async deleteEdition(byEditionInput) {
      const candidates = hashesOf(
        distinctHashesForEdition,
        byEditionInput.date,
        byEditionInput.periodId,
        byEditionInput.locale
      )
      const rows = Number(deleteForEdition.run(
        byEditionInput.date,
        byEditionInput.periodId,
        byEditionInput.locale
      ).changes ?? 0)
      return { rows, removedFiles: await removeUnreferenced(candidates) }
    }
  }
}