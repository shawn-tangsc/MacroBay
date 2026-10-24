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
  it('fetches and stores the body for a body source and skips Binance', async () => {
    const store = createNewsSentimentSqliteStore(':memory:')
    const fetchArticle = vi.fn(async () => ({ status: 200, bodyText: HTML }))
    const service = createNewsSentimentEnrichmentService({
      pipeline: {
        listItems: () => [
          item({}),
          item({ itemId: 'item-b', sourceId: 'binance-announcements', url: 'https://www.binance.com/x' })
        ]
      },
      store,
      fetchArticle,
      now: () => '2026-10-24T13:00:00.000Z'
    })

    const result = await service.enrichItems({ itemIds: ['item-a', 'item-b'] })
    expect(result).toMatchObject({ processed: 1, available: 1, skipped: 1 })
    expect(fetchArticle).toHaveBeenCalledTimes(1)
    expect(store.getDocument('item-a')?.state).toBe('available')
    expect(store.getDocument('item-b')).toBeUndefined()
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
      extractionVersion: 'news-body-v1',
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
