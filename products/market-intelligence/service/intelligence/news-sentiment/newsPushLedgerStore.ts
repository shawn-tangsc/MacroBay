import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

export const newsPushLedgerPolicy = Object.freeze({
  fileName: 'intelligence-news-push-ledger.sqlite'
})

export type NewsPushLedgerEntry = {
  itemId: string
  /** 基线行没有键：它们不是哪一件事的报道，只是「开出口之前的记录」。 */
  storyKey?: string
  eventTypeId: string
  pushedAt: string
}

/**
 * 推送账本：**独立文件、只增不改**。
 *
 * 为什么不放在 `news_sentiment`：那个库没有迁移路径，版本一变就 `drop table` 重建
 * （`newsSentimentStore.ts` 的 `openOrReset` 与 `schemaVersion`）。账本放里面，一次重建就把
 * 「推过没有」抹掉，然后**全部历史重推**——读者收到一整批旧闻，而我们的所有用例在重建之前
 * 都是绿的。这条不是实现偏好，是存储结构逼出来的。
 *
 * 也因此这里**不做版本号、不做重建**：表只加行。真需要改形状时，写一条迁移，不要 drop。
 */
export function createNewsPushLedgerStore(filePath: string) {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db: DatabaseSync = openSqliteDatabase(filePath)
  db.exec(`
    create table if not exists news_push_ledger (
      item_id text primary key,
      story_key text,
      event_type_id text not null,
      pushed_at text not null
    );
    create table if not exists news_push_watermark (
      id text primary key check (id = 'outlet'),
      enabled_at text not null
    );
  `)

  return {
    /** 账本闸的唯一读法：`item_id` 存在即视为推过，不区分基线行与真实推送行。 */
    has(itemId: string): boolean {
      const row = db.prepare('select 1 from news_push_ledger where item_id = ? limit 1').get(itemId)
      return Boolean(row)
    },

    /** 真推出去之后记一笔。重复调用不产生第二行（主键）。 */
    markPushed(entry: NewsPushLedgerEntry): void {
      insert(db, entry)
    },

    /**
     * 开出口那一刻的基线：一次事务写入，按 `item_id` 幂等。
     *
     * 不许「每次评分顺带补」——中途再清库一次就会缺一段，而缺的那段事后看不出来（账本里没有
     * 行就是没有行，和「从没推过」长得一样）。
     */
    markBaseline(itemIds: readonly string[], at: string): number {
      let written = 0
      db.exec('begin')
      try {
        for (const itemId of itemIds) {
          written += insert(db, { itemId, eventTypeId: 'baseline', pushedAt: at })
        }
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      return written
    },

    /** 水位：读者按下开关那一刻。没有行 = 从未开启过，一条都不推。 */
    readWatermark(): string | undefined {
      const row = db.prepare("select enabled_at from news_push_watermark where id = 'outlet'").get() as
        | { enabled_at?: string }
        | undefined
      return row?.enabled_at ? String(row.enabled_at) : undefined
    },

    /**
     * 读者按下开关的那一下：**水位与基线在同一个事务里写完**，成功返回之后才允许任何一条发出去。
     *
     * 中间不许有「基线写了一半、推送已经开始」的窗口——那等于把历史当成新闻推一批。
     * 重新启用就把水位改成这一刻（关掉说明这段他不要了），**账本不重置**（推过的不再推）。
     */
    enableOutlet(input: { at: string; baselineItemIds: readonly string[] }): { baselineWritten: number } {
      let baselineWritten = 0
      db.exec('begin')
      try {
        for (const itemId of input.baselineItemIds) {
          baselineWritten += insert(db, { itemId, eventTypeId: 'baseline', pushedAt: input.at })
        }
        db.prepare(
          "insert into news_push_watermark (id, enabled_at) values ('outlet', ?) on conflict(id) do update set enabled_at = excluded.enabled_at"
        ).run(input.at)
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
      return { baselineWritten }
    },

    count(): number {
      const row = db.prepare('select count(*) as n from news_push_ledger').get() as { n?: number } | undefined
      return Number(row?.n ?? 0)
    },

    close(): void {
      db.close()
    }
  }
}

export type NewsPushLedgerStore = ReturnType<typeof createNewsPushLedgerStore>

function insert(db: DatabaseSync, entry: NewsPushLedgerEntry): number {
  const result = db
    .prepare(
      `insert into news_push_ledger (item_id, story_key, event_type_id, pushed_at)
       values (?, ?, ?, ?)
       on conflict(item_id) do nothing`
    )
    .run(entry.itemId, entry.storyKey ?? null, entry.eventTypeId, entry.pushedAt)
  return Number(result.changes)
}
