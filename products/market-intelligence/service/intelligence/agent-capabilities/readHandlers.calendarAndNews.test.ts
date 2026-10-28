import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

vi.mock('../intelligenceModule', () => ({ getIntelligenceModule: vi.fn() }))

import { getIntelligenceModule } from '../intelligenceModule'
import {
  handleGetNewsSentimentItem,
  handleQueryMacroCalendar,
  handleQueryNewsSentiment
} from './readHandlers'

const deps = {
  jobRuntime: {} as JobRuntime,
  getAppLanguage: async () => 'zh-CN' as const
}

function moduleWith(parts: {
  official?: unknown
  market?: unknown
  marketThrows?: boolean
  newsQuery?: unknown
}) {
  return {
    publicQueryService: {
      queryMacroEconomicCalendarMonth: vi.fn(() => parts.official ?? { state: 'available', events: [] }),
      queryMarketCalendarMonth: vi.fn(() => {
        if (parts.marketThrows) throw new Error('market unavailable')
        return parts.market ?? { state: 'available', events: [] }
      })
    },
    newsSentiment: { query: parts.newsQuery }
  }
}

beforeEach(() => {
  vi.mocked(getIntelligenceModule).mockReset()
})

describe('handleQueryMacroCalendar', () => {
  it('returns both calendars and a merged, source-tagged timeline', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      official: {
        state: 'available',
        events: [{ eventKey: 'official-cpi', title: 'CPI', scheduledAt: '2026-10-14T12:30:00.000Z', scheduledDate: '2026-10-14' }]
      },
      market: {
        state: 'available',
        events: [{ eventKey: 'market-fomc', title: 'FOMC', scheduledAt: '2026-10-28T18:00:00.000Z', importance: 'high', countryName: '美国' }]
      }
    }) as never)

    const result = await handleQueryMacroCalendar({ month: '2026-10', asOf: '2026-10-28T06:50:04.794Z' }, deps) as never as {
      state: string
      official: { events: unknown[] }
      market: { events: unknown[] }
      events: Array<{ source: string; eventKey: string }>
      caveats: string[]
    }

    expect(result.state).toBe('available')
    expect(result.official.events).toHaveLength(1)
    expect(result.market.events).toHaveLength(1)
    expect(result.events.map((event) => [event.source, event.eventKey])).toEqual([
      ['official', 'official-cpi'],
      ['market', 'market-fomc']
    ])
    expect(result.caveats).toEqual([])
  })

  it('keeps the official calendar when the market side is unavailable', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      official: { state: 'available', events: [{ eventKey: 'official-cpi', title: 'CPI', scheduledAt: '2026-10-14T12:30:00.000Z' }] },
      marketThrows: true
    }) as never)

    const result = await handleQueryMacroCalendar({ month: '2026-10', asOf: '2026-10-28T06:50:04.794Z' }, deps) as never as {
      state: string
      market: { state: string }
      events: unknown[]
      caveats: string[]
    }

    expect(result.state).toBe('available')
    expect(result.market.state).toBe('unavailable')
    expect(result.events).toHaveLength(1)
    expect(result.caveats).toContain('market-calendar-unavailable')
  })

  it('says empty rather than unavailable when both sides answer with nothing', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({}) as never)

    const result = await handleQueryMacroCalendar({ month: '2026-10', asOf: '2026-10-28T06:50:04.794Z' }, deps) as never as {
      state: string
      events: unknown[]
      caveats: string[]
    }

    expect(result.state).toBe('empty')
    expect(result.events).toEqual([])
    expect(result.caveats).toEqual(['official-calendar-empty', 'market-calendar-empty'])
  })
})

describe('news sentiment handlers', () => {
  it('passes the filters through and returns the view untouched', async () => {
    const query = vi.fn(async () => ({ state: 'available', items: [{ itemId: 'a' }], caveats: [] }))
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({ newsQuery: { query, getItem: vi.fn() } }) as never)

    const input = { asOf: '2026-10-28T06:50:04.794Z', window: '24h', direction: 'bearish', limit: 10 }
    const result = await handleQueryNewsSentiment(input, deps)

    expect(query).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({ state: 'available' })
  })

  it('reports unavailable when the sentiment store is not wired', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({}) as never)

    const result = await handleQueryNewsSentiment(
      { asOf: '2026-10-28T06:50:04.794Z', window: '24h' },
      deps
    ) as never as { state: string; items: unknown[]; caveats: string[] }

    expect(result.state).toBe('unavailable')
    expect(result.items).toEqual([])
    expect(result.caveats).toEqual(['news-sentiment-unavailable'])
  })

  it('returns the item detail and says unavailable when it is missing', async () => {
    const getItem = vi.fn(async () => ({ itemId: 'a', title: 'Headline' }))
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({ newsQuery: { query: vi.fn(), getItem } }) as never)

    await expect(handleGetNewsSentimentItem({ itemId: 'a', asOf: '2026-10-28T06:50:04.794Z' }, deps)).resolves.toEqual({
      state: 'available',
      item: { itemId: 'a', title: 'Headline' }
    })

    getItem.mockResolvedValueOnce(undefined as never)
    await expect(handleGetNewsSentimentItem({ itemId: 'b', asOf: '2026-10-28T06:50:04.794Z' }, deps)).resolves.toEqual({
      state: 'unavailable',
      itemId: 'b'
    })
  })
})
