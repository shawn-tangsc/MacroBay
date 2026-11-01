import { describe, expect, it } from 'vitest'

import { createNewsSentimentSqliteStore } from './newsSentimentStore'
import {
  createNewsSentimentRetentionTarget,
  newsSentimentRetentionCutoffs,
  newsSentimentRetentionPolicy
} from './newsSentimentRetention'

const atMs = Date.UTC(2026, 9, 15, 12, 0, 0)
const DAY_MS = 24 * 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

function seedDocument(store: ReturnType<typeof createNewsSentimentSqliteStore>, itemId: string, fetchedAtMs: number) {
  store.upsertDocument({
    itemId,
    sourceId: 'coindesk-rss',
    url: `https://example.test/${itemId}`,
    fetchedAt: iso(fetchedAtMs),
    bodyText: 'body',
    bodyChars: 4,
    state: 'available'
  })
}

function seedSentiment(store: ReturnType<typeof createNewsSentimentSqliteStore>, itemId: string, scoredAtMs: number) {
  store.upsertSentiment({
    itemId,
    sourceId: 'coindesk-rss',
    publishedAt: iso(scoredAtMs),
    scoredAt: iso(scoredAtMs),
    polarity: 'neutral',
    strength: 1,
    confidence: 50,
    symbols: [],
    reasonCode: 'news.no-rule.v1',
    engine: 'rules',
    ruleId: 'news.no-rule.v1',
    caveats: []
  })
}

describe('news sentiment retention', () => {
  it('keeps both windows on the documented boundaries, not one side of them', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    // 31 days old is out, 29 days old is in — the same test on the other side of the edge.
    seedDocument(store, 'doc-31d', atMs - 31 * DAY_MS)
    seedDocument(store, 'doc-29d', atMs - 29 * DAY_MS)
    // 366 days is out, 364 is in.
    seedSentiment(store, 'judgment-366d', atMs - 366 * DAY_MS)
    seedSentiment(store, 'judgment-364d', atMs - 364 * DAY_MS)

    const result = createNewsSentimentRetentionTarget(store).retention({ atMs, cutoffs: {} as never })

    expect(result.deleted).toBe(2)
    expect(store.getDocument('doc-31d')).toBeUndefined()
    expect(store.getDocument('doc-29d')).toBeDefined()
    expect(store.getLatestSentiment('judgment-366d', iso(atMs))).toBeUndefined()
    expect(store.getLatestSentiment('judgment-364d', iso(atMs))).toBeDefined()
  })

  it('spends at most one budget of rows per pass and says when it was capped', () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const expired = 520
    for (let index = 0; index < expired; index += 1) {
      seedDocument(store, `doc-${index}`, atMs - 40 * DAY_MS)
    }

    const target = createNewsSentimentRetentionTarget(store)
    const first = target.retention({ atMs, cutoffs: {} as never })
    expect(first.deleted).toBe(newsSentimentRetentionPolicy.maximumRowsPerRun)
    expect(first.capped).toBe(true)

    const second = target.retention({ atMs, cutoffs: {} as never })
    expect(second.deleted).toBe(expired - newsSentimentRetentionPolicy.maximumRowsPerRun)
    expect(second.capped).toBe(false)
    expect(store.getDocument('doc-0')).toBeUndefined()
  })

  it('derives the cutoffs from the policy rather than restating them', () => {
    const cutoffs = newsSentimentRetentionCutoffs(atMs)
    expect(cutoffs.documentsBefore).toBe(iso(atMs - 30 * DAY_MS))
    expect(cutoffs.sentimentsBefore).toBe(iso(atMs - 365 * DAY_MS))
  })
})
