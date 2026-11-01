import { describe, expect, it } from 'vitest'

import { summarizeNewsSentimentReadiness } from './newsSentimentReadiness'

const row = (sourceId: string, productionState: string, latestSuccessAt?: string) => ({ sourceId, productionState, ...(latestSuccessAt ? { latestSuccessAt } : {}) })

describe('news sentiment source readiness', () => {
  it('counts disabled sources as off even when their state is otherwise unknown', () => {
    const readiness = summarizeNewsSentimentReadiness([
      row('sec-rss', 'disabled'), row('coindesk-rss', 'disabled'),
      row('binance-announcements', 'disabled'), row('okx-latest-announcements', 'disabled')
    ])
    expect(readiness).toMatchObject({ total: 4, enabledCount: 0, failedCount: 0, neverRanCount: 0 })
    expect(readiness.failedSourceIds).toEqual([])
    expect(readiness.lastSuccessAt).toBeUndefined()
  })

  it('separates a failed collection from one that has never run', () => {
    const readiness = summarizeNewsSentimentReadiness([
      row('sec-rss', 'pending'), row('coindesk-rss', 'failed', '2026-10-01T00:00:00.000Z'),
      row('binance-announcements', 'fresh', '2026-10-31T20:00:00.000Z'), row('okx-latest-announcements', 'disabled')
    ])
    expect(readiness).toMatchObject({ total: 4, enabledCount: 3, failedCount: 1, neverRanCount: 1 })
    expect(readiness.failedSourceIds).toEqual(['coindesk-rss'])
    expect(readiness.neverRanSourceIds).toEqual(['sec-rss'])
    // The newest success among the enabled sources, not the first one in registry order.
    expect(readiness.lastSuccessAt).toBe('2026-10-31T20:00:00.000Z')
  })

  it('treats a source with a past success as stale rather than never-run', () => {
    const readiness = summarizeNewsSentimentReadiness([
      row('sec-rss', 'stale', '2026-10-20T00:00:00.000Z'), row('coindesk-rss', 'stale', '2026-10-21T00:00:00.000Z'),
      row('binance-announcements', 'stale', '2026-10-22T00:00:00.000Z'), row('okx-latest-announcements', 'stale', '2026-10-23T00:00:00.000Z')
    ])
    expect(readiness).toMatchObject({ enabledCount: 4, failedCount: 0, neverRanCount: 0 })
    expect(readiness.lastSuccessAt).toBe('2026-10-23T00:00:00.000Z')
  })

  it('ignores coverage rows for sources outside the four', () => {
    const readiness = summarizeNewsSentimentReadiness([
      row('fred-rates-liquidity', 'failed'), row('sec-rss', 'fresh', '2026-10-31T00:00:00.000Z')
    ])
    expect(readiness.enabledCount).toBe(1)
    expect(readiness.failedCount).toBe(0)
  })
})
