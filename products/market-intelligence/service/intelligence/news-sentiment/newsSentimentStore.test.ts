import { describe, expect, it } from 'vitest'

import type { NewsDocumentRecord, NewsSentimentRecord } from '../schema/newsSentiment'
import { createNewsSentimentSqliteStore } from './newsSentimentStore'

const BASE: NewsDocumentRecord = {
  itemId: 'item-a',
  sourceId: 'coindesk-rss',
  url: 'https://example.com/a',
  fetchedAt: '2026-10-24T12:01:00.000Z',
  bodyText: 'body',
  bodyChars: 4,
  extractionVersion: 'news-body-v1',
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
