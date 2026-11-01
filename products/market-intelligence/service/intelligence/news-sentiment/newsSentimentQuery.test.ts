import { describe, expect, it } from 'vitest'

import { createNewsSentimentSqliteStore } from './newsSentimentStore'
import { createNewsSentimentQuery } from './newsSentimentQuery'

const ITEMS = [
  {
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    title: 'SEC Approves Spot Ethereum ETF Options',
    url: 'https://www.coindesk.com/a',
    publishedAt: '2026-10-24T12:00:00.000Z',
    detectedAt: '2026-10-24T12:01:00.000Z',
    sourceCategory: 'mainstream-news',
    sourceTrust: 'high'
  },
  {
    itemId: 'item-b',
    sourceId: 'binance-announcements',
    title: 'Binance Will Delist XYZ Perpetual',
    url: 'https://www.binance.com/b',
    publishedAt: '2026-10-24T11:00:00.000Z',
    detectedAt: '2026-10-24T11:01:00.000Z',
    sourceCategory: 'exchange-announcement',
    sourceTrust: 'high'
  }
] as never[]

function seed() {
  const store = createNewsSentimentSqliteStore(':memory:')
  store.upsertSentiment({
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    publishedAt: '2026-10-24T12:00:00.000Z',
    scoredAt: '2026-10-24T12:05:00.000Z',
    polarity: 'bullish',
    strength: 4,
    confidence: 78,
    symbols: ['ETH'],
    reasonCode: 'etf-approval',
    evidenceQuote: 'approved options on spot Ether ETFs',
    engine: 'model',
    modelRef: 'p:m',
    promptVersion: 'news-polarity-v1',
    caveats: []
  })
  store.upsertSentiment({
    itemId: 'item-b',
    sourceId: 'binance-announcements',
    publishedAt: '2026-10-24T11:00:00.000Z',
    scoredAt: '2026-10-24T11:05:00.000Z',
    polarity: 'bearish',
    strength: 4,
    confidence: 75,
    symbols: [],
    reasonCode: 'news.delisting.v1',
    evidenceQuote: 'Binance Will Delist XYZ Perpetual',
    engine: 'rules',
    ruleId: 'news.delisting.v1',
    caveats: []
  })
  return store
}

function query(store: ReturnType<typeof seed>, translation?: { resolveDisplayTexts: () => Promise<Record<string, { title?: string; status?: string }>> }) {
  return createNewsSentimentQuery({
    store,
    pipeline: { listItems: () => ITEMS },
    ...(translation ? { translation } : {}),
    now: () => '2026-10-24T13:00:00.000Z'
  })
}

describe('newsSentimentQuery', () => {
  it('aggregates the window and maps engine versions', async () => {
    const view = await query(seed()).query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h' })
    expect(view.state).toBe('available')
    expect(view.summary).toMatchObject({ itemCount: 2, engineMix: { model: 1, rules: 1 } })
    // The age badge on a populated card reads the same field the stale empty state does.
    expect(view.latestKnownItemAt).toBe('2026-10-24T12:00:00.000Z')
    expect(view.items.map((item) => item.sourceName)).toEqual(['CoinDesk RSS', 'Binance Announcements'])
  })

  it('filters by symbol scope and direction', async () => {
    const service = query(seed())
    const eth = await service.query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h', scope: 'ETH' })
    expect(eth.summary?.itemCount).toBe(1)
    const bearish = await service.query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h', direction: 'bearish' })
    expect(bearish.summary?.itemCount).toBe(1)
    expect(bearish.items[0]?.itemId).toBe('item-b')
  })

  it('returns only judgments visible at the requested instant', async () => {
    const view = await query(seed()).query({ asOf: '2026-10-24T12:01:00.000Z', window: '24h' })
    expect(view.summary?.itemCount).toBe(1)
    expect(view.items[0]?.itemId).toBe('item-b')
  })

  it('uses the translated title when the existing translation is ready', async () => {
    const view = await query(seed(), {
      resolveDisplayTexts: async () => ({ 'item-a': { title: 'SEC 批准以太坊现货 ETF 期权', status: 'translated' } })
    }).query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h' })
    expect(view.items.find((item) => item.itemId === 'item-a')?.displayTitle).toBe('SEC 批准以太坊现货 ETF 期权')
  })

  it('returns empty for a window with no items', async () => {
    const view = await query(seed()).query({ asOf: '2026-10-25T13:00:00.000Z', window: '1h' })
    expect(view.state).toBe('empty')
  })
})

describe('the widest window is capped at 100 rows', () => {
  // The UI no longer calls this window "all": it returns at most 100 rows, and the label says so.
  // This is the other half of that promise — 120 stored judgments really do come back as 100.
  it('returns the newest 100 of 120 rows', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const items = []
    for (let index = 0; index < 120; index += 1) {
      const at = new Date(Date.UTC(2026, 9, 24, 0, index, 0)).toISOString()
      items.push({ itemId: `item-${index}`, sourceId: 'coindesk-rss', title: `News ${index}`, publishedAt: at })
      store.upsertSentiment({
        itemId: `item-${index}`, sourceId: 'coindesk-rss', publishedAt: at, scoredAt: at,
        polarity: 'neutral', strength: 1, confidence: 50, symbols: [], reasonCode: 'news.no-rule.v1',
        engine: 'rules', ruleId: 'news.no-rule.v1', caveats: []
      })
    }
    const view = await createNewsSentimentQuery({
      store,
      pipeline: { listItems: () => items as never },
      now: () => '2026-10-24T13:00:00.000Z'
    }).query({ asOf: '2026-10-24T13:00:00.000Z', window: 'all', limit: 500 })
    expect(view.items).toHaveLength(100)
    expect(view.items[0]?.itemId).toBe('item-119')
  })
})

describe('empty windows carry their cause', () => {
  const readiness = {
    total: 4, enabledCount: 4, failedCount: 1, neverRanCount: 0,
    failedSourceIds: ['sec-rss'], neverRanSourceIds: [],
    lastSuccessAt: '2026-10-24T12:00:00.000Z'
  }

  it('reports the newest judgment even when it is outside the window', async () => {
    // Without this the DTO cannot tell "this hour had no news" from "nothing arrived since yesterday".
    const view = await createNewsSentimentQuery({
      store: seed(),
      pipeline: { listItems: () => ITEMS },
      readSourceReadiness: async () => readiness,
      now: () => '2026-10-25T13:00:00.000Z'
    }).query({ asOf: '2026-10-25T13:00:00.000Z', window: '1h' })
    expect(view.state).toBe('empty')
    expect(view.latestKnownItemAt).toBe('2026-10-24T12:00:00.000Z')
    expect(view.readiness).toEqual(readiness)
  })

  it('stays readable when the source status itself fails', async () => {
    const view = await createNewsSentimentQuery({
      store: seed(),
      pipeline: { listItems: () => ITEMS },
      readSourceReadiness: async () => { throw new Error('sources down') },
      now: () => '2026-10-24T13:00:00.000Z'
    }).query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h' })
    expect(view.state).toBe('available')
    expect(view.readiness).toBeUndefined()
  })
})

describe('seven-day window', () => {
  // Regression: '7d' is not a sentiment horizon, so the aggregate filtered every signal out and
  // reported "0 directional / score 0 / neutral" for a window full of directional items. The query
  // now publishes no summary at all for windows it cannot express — absence, not a fake zero.
  it('returns the items but publishes no summary it cannot compute', async () => {
    const store = seed()
    store.upsertSentiment({
      itemId: 'item-3d',
      sourceId: 'coindesk-rss',
      publishedAt: '2026-10-21T12:00:00.000Z',
      scoredAt: '2026-10-21T12:05:00.000Z',
      polarity: 'bearish',
      strength: 5,
      confidence: 80,
      symbols: ['BTC'],
      reasonCode: 'exploit',
      engine: 'model',
      modelRef: 'p:m',
      promptVersion: 'news-polarity-v1',
      caveats: []
    })
    const view = await createNewsSentimentQuery({
      store,
      pipeline: { listItems: () => [...ITEMS, { itemId: 'item-3d', sourceId: 'coindesk-rss', title: 'Exchange exploit', publishedAt: '2026-10-21T12:00:00.000Z' }] as never },
      now: () => '2026-10-24T13:00:00.000Z'
    }).query({ asOf: '2026-10-24T13:00:00.000Z', window: '7d' })
    expect(view.state).toBe('available')
    expect(view.items.map((item) => item.itemId)).toContain('item-3d')
    expect(view.summary).toBeUndefined()
  })

  it('still summarizes the windows that have a real horizon', async () => {
    const view = await query(seed()).query({ asOf: '2026-10-24T13:00:00.000Z', window: '24h' })
    expect(view.summary?.directionalCount).toBeGreaterThan(0)
  })
})

describe('all-time window', () => {
  it('returns rows older than seven days', async () => {
    const store = seed()
    store.upsertSentiment({
      itemId: 'item-old', sourceId: 'sec-rss', publishedAt: '2026-01-01T00:00:00.000Z', scoredAt: '2026-01-01T00:05:00.000Z',
      polarity: 'neutral', strength: 1, confidence: 50, symbols: [], reasonCode: 'news.no-rule.v1', engine: 'rules', caveats: []
    })
    const view = await createNewsSentimentQuery({
      store,
      pipeline: { listItems: () => [...ITEMS, { itemId: 'item-old', sourceId: 'sec-rss', title: 'Old SEC notice', publishedAt: '2026-01-01T00:00:00.000Z' }] as never },
      now: () => '2026-10-24T13:00:00.000Z'
    }).query({ asOf: '2026-10-24T13:00:00.000Z', window: 'all' })
    expect(view.state).toBe('available')
    expect(view.items.map((item) => item.itemId)).toContain('item-old')
  })
})
