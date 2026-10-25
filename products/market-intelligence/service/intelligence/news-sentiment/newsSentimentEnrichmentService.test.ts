import { describe, expect, it, vi } from 'vitest'

import { createNewsSentimentSqliteStore } from './newsSentimentStore'
import { createNewsSentimentEnrichmentService } from './newsSentimentEnrichmentService'

function item(overrides: Record<string, unknown>) {
  return {
    itemId: 'item-a',
    sourceId: 'coindesk-rss',
    title: 'U.S. Clarity Act failure gives Asia an edge',
    summary: 'Apex Group CEO Peter Hughes warned about the Clarity Act.',
    url: 'https://www.coindesk.com/policy/2026/10/24/clarity-act',
    publishedAt: '2026-10-24T12:00:00.000Z',
    detectedAt: '2026-10-24T12:01:00.000Z',
    language: 'en',
    ...overrides
  } as never
}

const HTML = `<div class="document-body"><p>${'The U.S. risks losing digital asset business to faster-moving jurisdictions in Asia. '.repeat(5)}</p></div>`

describe('newsSentimentEnrichmentService', () => {
  it('fetches and stores the body for every body source, including Binance CMS', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const binanceJson = JSON.stringify({ data: { body: JSON.stringify({ node: 'root', child: [
      { node: 'element', tag: 'p', child: [{ node: 'text', text: 'Binance will remove PTB, AA, OWL, DORA, ELIZAOS and MEMES. '.repeat(4) }] }
    ] }) } })
    const fetchArticle = vi.fn(async (url: string) => ({ status: 200, bodyText: url.includes('/bapi/') ? binanceJson : HTML }))
    const service = createNewsSentimentEnrichmentService({
      pipeline: {
        listItems: () => [
          item({}),
          item({ itemId: 'item-b', sourceId: 'binance-announcements', url: 'https://www.binance.com/en/support/announcement/detail/abc123' })
        ]
      },
      store,
      fetchArticle,
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.enrichItems({ itemIds: ['item-a', 'item-b'] })
    expect(result).toMatchObject({ processed: 2, available: 2, skipped: 0 })
    expect(fetchArticle).toHaveBeenCalledTimes(2)
    expect(store.getDocument('item-a')?.state).toBe('available')
    expect(store.getDocument('item-b')?.state).toBe('available')
    expect(String(fetchArticle.mock.calls[1]?.[0])).toContain('articleCode=abc123')
  })

  it('records an HTTP failure without throwing the batch', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const service = createNewsSentimentEnrichmentService({
      pipeline: { listItems: () => [item({})] },
      store,
      fetchArticle: async () => ({ status: 403, bodyText: 'denied' }),
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.enrichItems({ itemIds: ['item-a'] })
    expect(result.failed).toBe(1)
    expect(store.getDocument('item-a')).toMatchObject({ state: 'failed', failureCode: 'http-403' })
  })

  it('does not refetch a document extracted with the current version', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    store.upsertDocument({
      itemId: 'item-a',
      sourceId: 'coindesk-rss',
      url: 'https://www.coindesk.com/x',
      fetchedAt: '2026-10-24T12:30:00.000Z',
      bodyText: 'body',
      bodyChars: 4,
      state: 'available'
    })
    const fetchArticle = vi.fn()
    const service = createNewsSentimentEnrichmentService({
      pipeline: { listItems: () => [item({})] },
      store,
      fetchArticle,
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.enrichItems({ itemIds: ['item-a'] })
    expect(result.skipped).toBe(1)
    expect(fetchArticle).not.toHaveBeenCalled()
  })

  it('marks a short extraction as too-short', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const service = createNewsSentimentEnrichmentService({
      pipeline: { listItems: () => [item({})] },
      store,
      fetchArticle: async () => ({ status: 200, bodyText: '<div class="document-body"><p>Too short.</p></div>' }),
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.enrichItems({ itemIds: ['item-a'] })
    expect(result.tooShort).toBe(1)
    expect(store.getDocument('item-a')?.state).toBe('too-short')
  })
})
