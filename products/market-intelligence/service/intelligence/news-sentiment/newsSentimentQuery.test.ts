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
