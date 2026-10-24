import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  NewsDocumentRecord,
  NewsSentimentRecord,
  NewsSentimentSymbol
} from '../schema/newsSentiment'
import { isNewsPolarity, isNewsSymbol } from '../schema/newsSentiment'

export const newsSentimentStoragePolicy = Object.freeze({
  fileName: 'intelligence-news-sentiment.sqlite',
  schemaVersion: 1
})

export type NewsSentimentStore = ReturnType<typeof createNewsSentimentSqliteStore>

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * 舆情判断与正文的产品自有存储。判断按 `item_id + scored_at` 追加，查询取
 * `scored_at <= asOf` 的最新一条，因此历史复盘不会被之后的重新评分改写。
 */
export function createNewsSentimentSqliteStore(filePath: string) {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  db.exec('pragma journal_mode = wal; pragma synchronous = full;')
  db.exec(`
    create table if not exists news_document (
      item_id text primary key,
      source_id text not null,
      url text not null,
      fetched_at text not null,
      body_text text,
      body_chars integer not null,
      extraction_version text not null,
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
      primary key (item_id, scored_at)
    );
    create index if not exists idx_news_sentiment_published on news_sentiment(published_at);
  `)

  return {
    upsertDocument(document: NewsDocumentRecord): void {
      assertDocument(document)
      db.prepare(`
        insert into news_document (item_id, source_id, url, fetched_at, body_text, body_chars, extraction_version, state, failure_code)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(item_id) do update set
          source_id=excluded.source_id, url=excluded.url, fetched_at=excluded.fetched_at,
          body_text=excluded.body_text, body_chars=excluded.body_chars,
          extraction_version=excluded.extraction_version, state=excluded.state,
          failure_code=excluded.failure_code
      `).run(
        document.itemId,
        document.sourceId,
        document.url,
        document.fetchedAt,
        document.bodyText ?? null,
        document.bodyChars,
        document.extractionVersion,
        document.state,
        document.failureCode ?? null
      )
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
          symbols_json, reason_code, evidence_quote, engine, model_ref, prompt_version, rule_id, caveats_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(record.caveats)
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

    purgeBefore(input: { documentsBefore: string; sentimentsBefore: string }): {
      documents: number
      sentiments: number
    } {
      assertIso(input.documentsBefore)
      assertIso(input.sentimentsBefore)
      const documents = Number(
        db.prepare('delete from news_document where fetched_at < ?').run(input.documentsBefore).changes
      )
      const sentiments = Number(
        db.prepare('delete from news_sentiment where scored_at < ?').run(input.sentimentsBefore).changes
      )
      return { documents, sentiments }
    }
  }
}

function toDocument(row: Record<string, unknown>): NewsDocumentRecord {
  return {
    itemId: String(row.item_id),
    sourceId: String(row.source_id),
    url: String(row.url),
    fetchedAt: String(row.fetched_at),
    ...(row.body_text == null ? {} : { bodyText: String(row.body_text) }),
    bodyChars: Number(row.body_chars),
    extractionVersion: String(row.extraction_version),
    state: String(row.state) as NewsDocumentRecord['state'],
    ...(row.failure_code == null ? {} : { failureCode: String(row.failure_code) })
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
    caveats: parseJsonArray(row.caveats_json) as string[]
  }
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
  if (!document.itemId.trim() || !document.sourceId.trim() || !document.url.trim()) throw new Error('invalid-news-document')
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
}

function assertIso(value: string): void {
  if (!ISO_RE.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('invalid-timestamp')
  }
}
