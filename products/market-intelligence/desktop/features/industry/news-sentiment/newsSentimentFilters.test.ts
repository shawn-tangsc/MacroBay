import { describe, expect, it } from 'vitest'

import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { filterNewsSentimentRows, passesNeutralFilter } from './newsSentimentFilters'

const item = (itemId: string, polarity: 'bullish' | 'bearish' | 'neutral' | 'mixed', sourceId = 'coindesk-rss') => ({
  itemId, title: itemId, sourceId, sourceName: sourceId, publishedAt: '2026-10-24T12:00:00.000Z',
  scoredAt: '2026-10-24T12:01:00.000Z', polarity, strength: 3, confidence: 60, symbols: ['BTC'], reasonCode: 'x', engine: 'rules' as const, caveats: []
})
const view = { state: 'available', asOf: '2026-10-24T13:00:00.000Z', generatedAt: '2026-10-24T13:00:00.000Z', window: '7d', items: [item('a', 'bullish'), item('b', 'bearish'), item('c', 'neutral')], caveats: [] } as unknown as NewsSentimentView

describe('newsSentimentFilters', () => {
  it('shares the neutral rule between the card and the drawer', () => {
    expect(passesNeutralFilter(item('a', 'bullish'), true)).toBe(true)
    expect(passesNeutralFilter(item('c', 'neutral'), false)).toBe(false)
  })

  it('filters direction and source without dropping neutral by default', () => {
    const filters = { direction: 'bearish' as const, sourceId: 'all', scope: 'market' as const, includeNeutral: true }
    expect(filterNewsSentimentRows(view, filters).map((row) => row.itemId)).toEqual(['b'])
    expect(filterNewsSentimentRows(view, { ...filters, includeNeutral: false }).map((row) => row.itemId)).toEqual(['b'])
  })
})
