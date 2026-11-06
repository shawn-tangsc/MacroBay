import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import type {
  NewsBodyTranslationRecord,
  NewsDocumentRecord,
  NewsSentimentEntity,
  NewsSentimentRecord,
  NewsSentimentSymbol
} from '../schema/newsSentiment'
import { NEWS_SENTIMENT_LIMITS, isNewsPolarity, isNewsSymbol } from '../schema/newsSentiment'

export const newsSentimentStoragePolicy = Object.freeze({
  fileName: 'intelligence-news-sentiment.sqlite',
  /**
   * 升版即重建：这个库没有迁移路径（见 `openOrReset` 与下面的 `drop table`）。
   *
   * v3 加了 `entities_json` / `story_key` / `why_text`。重建的代价是 377 篇正文与 427 条评分
   * 重跑一轮——**推送账本因此不能放在这里**，独立存在 `intelligence-news-push-ledger.sqlite`，
   * 否则一次重建就把「推过没有」抹掉，历史会被整批重推。
   */
  schemaVersion: 3
})

export type NewsSentimentStore = ReturnType<typeof createNewsSentimentSqliteStore>

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * 舆情判断与正文的产品自有存储。判断按 `item_id + scored_at` 追加，查询取
 * `scored_at <= asOf` 的最新一条，因此历史复盘不会被之后的重新评分改写。
 */
export function createNewsSentimentSqliteStore(filePath: string) {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = openOrReset(filePath)
  db.exec('pragma synchronous = full;')
  const storedVersion = Number((db.prepare('pragma user_version').get() as { user_version?: number }).user_version ?? 0)
  if (storedVersion !== newsSentimentStoragePolicy.schemaVersion) {
    // One schema, no upgrade paths: derived rows are rebuilt from the pipeline instead.
    db.exec('drop table if exists news_sentiment; drop table if exists news_document;')
  }
  db.exec(`
    create table if not exists news_document (
      item_id text primary key,
      source_id text not null,
      url text not null,
      fetched_at text not null,
      body_text text,
      body_chars integer not null,
      state text not null check (state in ('available','too-short','failed')),
      failure_code text
    );
    create table if not exists news_sentiment (
      item_id text not null,
      source_id text not null,
      published_at text not null,
      scored_at text not null,
      polarity text not null check (polarity in ('bullish','bearish','neutral','mixed')),
      strength integer not null check (strength between 1 and 5),
      confidence integer not null check (confidence between 0 and 100),
      symbols_json text not null,
      reason_code text not null,
      evidence_quote text,
      engine text not null check (engine in ('model','rules')),
      model_ref text,
      prompt_version text,
      rule_id text,
      caveats_json text not null,
      entities_json text not null default '[]',
      story_key text,
      why_text text,
      primary key (item_id, scored_at)
    );
    create index if not exists idx_news_sentiment_published on news_sentiment(published_at);
    create index if not exists idx_news_sentiment_story on news_sentiment(story_key, published_at);
    create table if not exists news_body_translation (
      item_id text primary key,
      body_hash text not null,
      target_locale text not null,
      state text not null check (state in ('translated','failed')),
      title_text text,
      body_text text,
      provider_id text,
      model_id text,
      error_code text,
      translated_at text not null
    );
  `)
  try { db.exec('alter table news_body_translation add column title_text text') } catch { /* already migrated */ }
  db.exec(`pragma user_version = ${newsSentimentStoragePolicy.schemaVersion}`)

  return {
    clearAll(): void {
      db.exec('delete from news_sentiment; delete from news_document; delete from news_body_translation;')
    },

    upsertDocument(document: NewsDocumentRecord): void {
      assertDocument(document)
      db.prepare(`
        insert into news_document (item_id, source_id, url, fetched_at, body_text, body_chars, state, failure_code)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(item_id) do update set
          source_id=excluded.source_id, url=excluded.url, fetched_at=excluded.fetched_at,
          body_text=excluded.body_text, body_chars=excluded.body_chars,
          state=excluded.state,
          failure_code=excluded.failure_code
      `).run(
        document.itemId,
        document.sourceId,
        document.url,
        document.fetchedAt,
        document.bodyText ?? null,
        document.bodyChars,
        document.state,
        document.failureCode ?? null
      )
    },

    getBodyTranslation(itemId: string): NewsBodyTranslationRecord | undefined {
      const row = db.prepare('select * from news_body_translation where item_id = ?').get(itemId) as Record<string, unknown> | undefined
      return row ? toBodyTranslation(row) : undefined
    },

    upsertBodyTranslation(record: NewsBodyTranslationRecord): void {
      db.prepare(`
        insert into news_body_translation (item_id, body_hash, target_locale, state, title_text, body_text, provider_id, model_id, error_code, translated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(item_id) do update set
          body_hash=excluded.body_hash, target_locale=excluded.target_locale, state=excluded.state,
          title_text=excluded.title_text, body_text=excluded.body_text, provider_id=excluded.provider_id, model_id=excluded.model_id,
          error_code=excluded.error_code, translated_at=excluded.translated_at
      `).run(record.itemId, record.bodyHash, record.targetLocale, record.state, record.titleText ?? null, record.bodyText ?? null, record.providerId ?? null, record.modelId ?? null, record.errorCode ?? null, record.translatedAt)
    },

    getDocument(itemId: string): NewsDocumentRecord | undefined {
      const row = db
        .prepare('select * from news_document where item_id = ?')
        .get(itemId) as Record<string, unknown> | undefined
      return row ? toDocument(row) : undefined
    },

    upsertSentiment(record: NewsSentimentRecord): 'inserted' | 'unchanged' {
      assertSentiment(record)
      const existing = db
        .prepare(`
          select 1 from news_sentiment
          where item_id = ? and engine = ?
            and ifnull(model_ref,'') = ? and ifnull(prompt_version,'') = ? and ifnull(rule_id,'') = ?
          limit 1
        `)
        .get(record.itemId, record.engine, record.modelRef ?? '', record.promptVersion ?? '', record.ruleId ?? '')
      if (existing) return 'unchanged'

      db.prepare(`
        insert into news_sentiment (
          item_id, source_id, published_at, scored_at, polarity, strength, confidence,
          symbols_json, reason_code, evidence_quote, engine, model_ref, prompt_version, rule_id, caveats_json,
          entities_json, story_key, why_text
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.itemId,
        record.sourceId,
        record.publishedAt,
        record.scoredAt,
        record.polarity,
        record.strength,
        record.confidence,
        JSON.stringify(record.symbols),
        record.reasonCode,
        record.evidenceQuote ?? null,
        record.engine,
        record.modelRef ?? null,
        record.promptVersion ?? null,
        record.ruleId ?? null,
        JSON.stringify(record.caveats),
        JSON.stringify(record.entities ?? []),
        record.storyKey ?? null,
        record.why ?? null
      )
      return 'inserted'
    },

    getLatestSentiment(itemId: string, asOf: string): NewsSentimentRecord | undefined {
      const row = db
        .prepare(`
          select * from news_sentiment
          where item_id = ? and scored_at <= ?
          order by scored_at desc limit 1
        `)
        .get(itemId, asOf) as Record<string, unknown> | undefined
      return row ? toSentiment(row) : undefined
    },

    listLatestSentiment(input: { from: string; to: string; limit?: number }): NewsSentimentRecord[] {
      const limit = Math.max(1, Math.min(input.limit ?? 500, 500))
      const rows = db
        .prepare(`
          select s.* from news_sentiment s
          join (
            select item_id, max(scored_at) as scored_at
            from news_sentiment
            where scored_at <= ?
            group by item_id
          ) latest on latest.item_id = s.item_id and latest.scored_at = s.scored_at
          where s.published_at >= ? and s.published_at <= ?
          order by s.published_at desc
          limit ?
        `)
        .all(input.to, input.from, input.to, limit) as Array<Record<string, unknown>>
      return rows.map(toSentiment)
    },

    /**
     * The retention pass, bounded per call.
     *
     * `maxRows` is one budget for the whole pass, spent on documents first: a store that has been kept
     * for a year has months of bodies to drop, and an unbounded delete would hold the write lock for
     * as long as that takes. Whatever does not fit waits for the next run — `capped` says so, rather
     * than letting the caller assume the pass finished.
     */
    purgeBefore(input: { documentsBefore: string; sentimentsBefore: string; maxRows?: number }): {
      documents: number
      sentiments: number
      capped: boolean
    } {
      assertIso(input.documentsBefore)
      assertIso(input.sentimentsBefore)
      const budget = Math.max(0, Math.floor(input.maxRows ?? Number.MAX_SAFE_INTEGER))
      const documents = deleteBefore(db, 'news_document', 'fetched_at', input.documentsBefore, budget)
      const sentiments = deleteBefore(db, 'news_sentiment', 'scored_at', input.sentimentsBefore, budget - documents)
      return { documents, sentiments, capped: documents + sentiments >= budget }
    }
  }
}

/**
 * `delete … limit` needs a SQLite build flag this runtime does not guarantee, so the keys are chosen
 * first and removed by primary rowid inside one transaction: a crash mid-pass leaves the rows, not a
 * half-deleted window.
 */
function deleteBefore(
  db: DatabaseSync,
  table: 'news_document' | 'news_sentiment',
  column: 'fetched_at' | 'scored_at',
  cutoff: string,
  limit: number
): number {
  if (limit <= 0) return 0
  const keys = db
    .prepare(`select rowid as row_id from ${table} where ${column} < ? limit ?`)
    .all(cutoff, limit) as Array<{ row_id: number }>
  if (keys.length === 0) return 0
  const remove = db.prepare(`delete from ${table} where rowid = ?`)
  db.exec('begin')
  try {
    for (const key of keys) remove.run(key.row_id)
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }
  return keys.length
}

/** No migration path: a file that cannot be opened is discarded and rebuilt. */
function openOrReset(filePath: string): DatabaseSync {
  try {
    return openSqliteDatabase(filePath)
  } catch (error) {
    if (filePath === ':memory:') throw error
    for (const suffix of ['', '-wal', '-shm']) rmSync(filePath + suffix, { force: true })
    return openSqliteDatabase(filePath)
  }
}

function toDocument(row: Record<string, unknown>): NewsDocumentRecord {
  return {
    itemId: String(row.item_id),
    sourceId: String(row.source_id),
    url: String(row.url),
    fetchedAt: String(row.fetched_at),
    ...(row.title_text == null ? {} : { titleText: String(row.title_text) }),
    ...(row.body_text == null ? {} : { bodyText: String(row.body_text) }),
    bodyChars: Number(row.body_chars),
    state: String(row.state) as NewsDocumentRecord['state'],
    ...(row.failure_code == null ? {} : { failureCode: String(row.failure_code) })
  }
}

function toBodyTranslation(row: Record<string, unknown>): NewsBodyTranslationRecord {
  return {
    itemId: String(row.item_id),
    bodyHash: String(row.body_hash),
    targetLocale: String(row.target_locale),
    state: String(row.state) as NewsBodyTranslationRecord['state'],
    ...(row.title_text == null ? {} : { titleText: String(row.title_text) }),
    ...(row.body_text == null ? {} : { bodyText: String(row.body_text) }),
    ...(row.provider_id == null ? {} : { providerId: String(row.provider_id) }),
    ...(row.model_id == null ? {} : { modelId: String(row.model_id) }),
    ...(row.error_code == null ? {} : { errorCode: String(row.error_code) }),
    translatedAt: String(row.translated_at)
  }
}

function toSentiment(row: Record<string, unknown>): NewsSentimentRecord {
  return {
    itemId: String(row.item_id),
    sourceId: String(row.source_id),
    publishedAt: String(row.published_at),
    scoredAt: String(row.scored_at),
    polarity: String(row.polarity) as NewsSentimentRecord['polarity'],
    strength: Number(row.strength),
    confidence: Number(row.confidence),
    symbols: parseJsonArray(row.symbols_json) as NewsSentimentSymbol[],
    reasonCode: String(row.reason_code),
    ...(row.evidence_quote == null ? {} : { evidenceQuote: String(row.evidence_quote) }),
    engine: String(row.engine) as NewsSentimentRecord['engine'],
    ...(row.model_ref == null ? {} : { modelRef: String(row.model_ref) }),
    ...(row.prompt_version == null ? {} : { promptVersion: String(row.prompt_version) }),
    ...(row.rule_id == null ? {} : { ruleId: String(row.rule_id) }),
    caveats: parseJsonArray(row.caveats_json) as string[],
    ...(row.entities_json == null ? {} : { entities: parseEntities(row.entities_json) }),
    ...(row.story_key == null ? {} : { storyKey: String(row.story_key) }),
    ...(row.why_text == null ? {} : { why: String(row.why_text) })
  }
}

/** 存进去的是规范化后的实体集；读回来的形状不认识就退回空集，绝不让坏数据变成归并依据。 */
function parseEntities(value: unknown): NewsSentimentEntity[] {
  const parsed = parseJsonArray(value)
  const entities: NewsSentimentEntity[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.name !== 'string' || typeof record.kind !== 'string') continue
    if (!['person', 'org', 'bill', 'asset', 'event'].includes(record.kind)) continue
    entities.push({ name: record.name, kind: record.kind as NewsSentimentEntity['kind'] })
  }
  return entities
}

function parseJsonArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function assertDocument(document: NewsDocumentRecord): void {
  if (!document.itemId.trim() || !document.sourceId.trim()) throw new Error('invalid-news-document')
  if (document.state !== 'failed' && !document.url.trim()) throw new Error('invalid-news-document')
  assertIso(document.fetchedAt)
  if (!Number.isSafeInteger(document.bodyChars) || document.bodyChars < 0) throw new Error('invalid-news-document')
  if (!['available', 'too-short', 'failed'].includes(document.state)) throw new Error('invalid-news-document')
}

function assertSentiment(record: NewsSentimentRecord): void {
  if (!record.itemId.trim() || !record.sourceId.trim()) throw new Error('invalid-news-sentiment')
  assertIso(record.publishedAt)
  assertIso(record.scoredAt)
  if (!isNewsPolarity(record.polarity)) throw new Error('invalid-news-sentiment')
  if (!Number.isInteger(record.strength) || record.strength < 1 || record.strength > 5) {
    throw new Error('invalid-news-sentiment')
  }
  if (!Number.isInteger(record.confidence) || record.confidence < 0 || record.confidence > 100) {
    throw new Error('invalid-news-sentiment')
  }
  if (record.symbols.some((symbol) => !isNewsSymbol(symbol))) throw new Error('invalid-news-sentiment')
  if (record.engine !== 'model' && record.engine !== 'rules') throw new Error('invalid-news-sentiment')
  for (const entity of record.entities ?? []) {
    if (!entity.name.trim()) throw new Error('invalid-news-sentiment')
    if (!['person', 'org', 'bill', 'asset', 'event'].includes(entity.kind)) throw new Error('invalid-news-sentiment')
  }
  // 键的形状由 `storyKeyOf` 独占；写进来的东西不符合这个形状，就是有人绕过了合成函数。
  if (record.storyKey !== undefined && !/^story:\d{4}-\d{2}-\d{2}:.+$/.test(record.storyKey)) {
    throw new Error('invalid-news-sentiment')
  }
  if (record.why !== undefined && (record.why.trim().length === 0 || record.why.length > NEWS_SENTIMENT_LIMITS.whyChars)) {
    throw new Error('invalid-news-sentiment')
  }
}

function assertIso(value: string): void {
  if (!ISO_RE.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('invalid-timestamp')
  }
}
