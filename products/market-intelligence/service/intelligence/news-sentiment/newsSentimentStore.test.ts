import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import type { NewsDocumentRecord, NewsSentimentRecord } from '../schema/newsSentiment'
import { createNewsSentimentSqliteStore, newsSentimentStoragePolicy } from './newsSentimentStore'

const BASE: NewsDocumentRecord = {
  itemId: 'item-a',
  sourceId: 'coindesk-rss',
  url: 'https://example.com/a',
  fetchedAt: '2026-10-24T12:01:00.000Z',
  bodyText: 'body',
  bodyChars: 4,
  state: 'available'
}

function sentiment(overrides: Partial<NewsSentimentRecord>): NewsSentimentRecord {
  return {
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    publishedAt: '2026-10-24T12:00:00.000Z',
    scoredAt: '2026-10-24T12:01:00.000Z',
    polarity: 'bullish',
    strength: 3,
    confidence: 70,
    symbols: ['BTC'],
    reasonCode: 'news.listing.v1',
    evidenceQuote: 'quote',
    caveats: [],
    engine: 'rules',
    ruleId: 'news.listing.v1',
    ...overrides
  }
}

describe('newsSentimentStore', () => {
  it('stores and reads a document', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertDocument(BASE)
    expect(store.getDocument('item-a')).toMatchObject({ state: 'available', bodyChars: 4 })
  })

  it('appends judgments and reads the one visible at asOf', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertSentiment(sentiment({}))
    store.upsertSentiment(
      sentiment({
        scoredAt: '2026-10-24T12:30:00.000Z',
        polarity: 'bearish',
        promptVersion: 'news-polarity-v2',
        engine: 'model',
        modelRef: 'p:m'
      })
    )

    expect(store.getLatestSentiment('item-a', '2026-10-24T12:15:00.000Z')?.polarity).toBe('bullish')
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')?.polarity).toBe('bearish')
  })

  it('returns the latest judgment per item inside the window', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertSentiment(sentiment({}))
    store.upsertSentiment(sentiment({ itemId: 'item-b', publishedAt: '2026-10-24T11:00:00.000Z', polarity: 'bearish' }))
    store.upsertSentiment(sentiment({ itemId: 'item-c', publishedAt: '2026-10-24T08:00:00.000Z', polarity: 'neutral' }))

    const rows = store.listLatestSentiment({ from: '2026-10-24T09:00:00.000Z', to: '2026-10-24T13:00:00.000Z' })
    expect(rows.map((row) => row.itemId).sort()).toEqual(['item-a', 'item-b'])
  })

  it('is idempotent for the same engine version of an item', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    expect(store.upsertSentiment(sentiment({}))).toBe('inserted')
    expect(
      store.upsertSentiment(sentiment({ scoredAt: '2026-10-24T12:05:00.000Z' }))
    ).toBe('unchanged')
  })

  it('round-trips entities, story key and why', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertSentiment(
      sentiment({
        engine: 'model',
        ruleId: undefined,
        entities: [
          { name: 'democrats', kind: 'org' },
          { name: 'bitcoin', kind: 'asset' }
        ],
        storyKey: 'story:2026-10-24:item-a',
        why: '选举结果改变监管预期。'
      })
    )
    expect(store.getLatestSentiment('item-a', '2026-10-24T13:00:00.000Z')).toMatchObject({
      storyKey: 'story:2026-10-24:item-a',
      why: '选举结果改变监管预期。',
      entities: [
        { name: 'democrats', kind: 'org' },
        { name: 'bitcoin', kind: 'asset' }
      ]
    })
  })

  it('rejects a story key whose shape did not come from the builder, and an over-long why', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    expect(() => store.upsertSentiment(sentiment({ storyKey: 'item-a' }))).toThrow()
    expect(() => store.upsertSentiment(sentiment({ storyKey: 'story:2026-10-24:' }))).toThrow()
    expect(() => store.upsertSentiment(sentiment({ why: 'x'.repeat(41) }))).toThrow()
    expect(() => store.upsertSentiment(sentiment({ why: '   ' }))).toThrow()
  })

  it('rejects invalid judgments', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    expect(() => store.upsertSentiment(sentiment({ strength: 9 }))).toThrow()
    expect(() => store.upsertSentiment(sentiment({ polarity: 'up' as never }))).toThrow()
    expect(() => store.upsertSentiment(sentiment({ symbols: ['DOGE' as never] }))).toThrow()
  })

  it('purges documents and judgments before their cutoffs', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertDocument(BASE)
    store.upsertSentiment(sentiment({}))
    const purged = store.purgeBefore({
      documentsBefore: '2026-10-25T00:00:00.000Z',
      sentimentsBefore: '2026-10-25T00:00:00.000Z'
    })
    expect(purged.documents).toBe(1)
    expect(purged.sentiments).toBe(1)
    expect(store.getDocument('item-a')).toBeUndefined()
  })
})

/**
 * 版本兼容：判断是**写给读者复盘用的历史**，不是可以重算的缓存。
 *
 * 旧库只能升级、不能清空——上一版写入的行必须读得出来；未来版本只能拒绝，不能盲读。
 * 这两个用例在修复前都是红的：旧版会把两张表 drop 掉，未来版会被当成「需要重置」。
 */
describe('newsSentimentStore across storage versions', () => {
  const V2_SENTIMENT_SQL = `create table news_sentiment (
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
  create index if not exists idx_news_sentiment_published on news_sentiment(published_at);`

  const V2_DOCUMENT_SQL = `create table news_document (
    item_id text primary key,
    source_id text not null,
    url text not null,
    fetched_at text not null,
    body_text text,
    body_chars integer not null,
    state text not null check (state in ('available','too-short','failed')),
    failure_code text
  );`

  /** 最早那一版还带 `extraction_version`（`news_document`），且没有 `user_version`。 */
  const UNVERSIONED_DOCUMENT_SQL = `create table news_document (
    item_id text primary key,
    source_id text not null,
    url text not null,
    fetched_at text not null,
    body_text text,
    body_chars integer not null,
    extraction_version text not null,
    state text not null check (state in ('available','too-short','failed')),
    failure_code text
  );`

  function seedLegacyDatabase(
    file: string,
    options: { version: number; legacyDocument?: boolean }
  ): void {
    const db = new DatabaseSync(file)
    try {
      db.exec('pragma journal_mode = wal;')
      db.exec(options.legacyDocument ? UNVERSIONED_DOCUMENT_SQL : V2_DOCUMENT_SQL)
      db.exec(V2_SENTIMENT_SQL)
      db.prepare(`insert into news_sentiment (
        item_id, source_id, published_at, scored_at, polarity, strength, confidence,
        symbols_json, reason_code, evidence_quote, engine, model_ref, prompt_version, rule_id, caveats_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'item-a', 'coindesk-rss', '2026-10-24T12:00:00.000Z', '2026-10-24T12:01:00.000Z',
        'bearish', 4, 80, '["BTC"]', 'news.rule.v1', 'quote', 'model', 'p:m', 'news-polarity-v1', null, '[]'
      )
      if (options.legacyDocument) {
        db.prepare(`insert into news_document (
          item_id, source_id, url, fetched_at, body_text, body_chars, extraction_version, state, failure_code
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          'item-a', 'coindesk-rss', 'https://example.com/a', '2026-10-24T12:01:00.000Z', 'body', 4, 'v1', 'available', null
        )
      } else {
        db.prepare(`insert into news_document (
          item_id, source_id, url, fetched_at, body_text, body_chars, state, failure_code
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          'item-a', 'coindesk-rss', 'https://example.com/a', '2026-10-24T12:01:00.000Z', 'body', 4, 'available', null
        )
      }
      db.exec(`pragma user_version = ${options.version}`)
    } finally {
      db.close()
    }
  }

  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  function fileInTempDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'news-sentiment-store-'))
    return join(dir, 'store.sqlite')
  }

  it('reads judgments written by the previous version, and keeps them', () => {
    const file = fileInTempDir()
    seedLegacyDatabase(file, { version: 2 })

    const store = createNewsSentimentSqliteStore(file)
    const record = store.getLatestSentiment('item-a', '2026-10-25T00:00:00.000Z')
    expect(record).toMatchObject({ itemId: 'item-a', polarity: 'bearish', strength: 4, engine: 'model' })
    // 上一版没有这三列：补列用空值，不编造实体、不补 storyKey、不补 why。
    expect(record?.entities ?? []).toEqual([])
    expect(record?.storyKey).toBeUndefined()
    expect(record?.why).toBeUndefined()
    expect(store.getDocument('item-a')).toMatchObject({ state: 'available', bodyChars: 4 })

    const check = new DatabaseSync(file)
    try {
      expect(check.prepare('select count(*) as count from news_sentiment').get()).toEqual({ count: 1 })
      expect(check.prepare('pragma user_version').get()).toEqual({
        user_version: newsSentimentStoragePolicy.schemaVersion
      })
    } finally {
      check.close()
    }
  })

  it('upgrades the earliest unversioned shape without losing its rows', () => {
    const file = fileInTempDir()
    seedLegacyDatabase(file, { version: 0, legacyDocument: true })

    const store = createNewsSentimentSqliteStore(file)
    expect(store.getLatestSentiment('item-a', '2026-10-25T00:00:00.000Z')?.polarity).toBe('bearish')
    expect(store.getDocument('item-a')?.bodyChars).toBe(4)
    // 旧表的 `extraction_version` 是 not null 且没有默认值：新代码不再写它，
    // 若迁移没处理掉，下面这次插入会直接失败。
    expect(() => store.upsertDocument({ ...BASE, itemId: 'item-b', url: 'https://example.com/b' })).not.toThrow()
    expect(store.getDocument('item-b')?.state).toBe('available')
  })

  it('refuses a database newer than this build, and leaves its rows alone', () => {
    const file = fileInTempDir()
    const store = createNewsSentimentSqliteStore(file)
    store.upsertSentiment(sentiment({}))

    const bump = new DatabaseSync(file)
    try {
      bump.exec('pragma user_version = 4')
    } finally {
      bump.close()
    }

    expect(() => createNewsSentimentSqliteStore(file)).toThrow(/storage-version-newer/)

    const check = new DatabaseSync(file)
    try {
      expect(check.prepare('select count(*) as count from news_sentiment').get()).toEqual({ count: 1 })
      expect(check.prepare('pragma user_version').get()).toEqual({ user_version: 4 })
    } finally {
      check.close()
    }
  })
})
