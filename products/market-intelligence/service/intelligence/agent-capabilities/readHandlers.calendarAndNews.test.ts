import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

vi.mock('../intelligenceModule', () => ({ getIntelligenceModule: vi.fn() }))

import { getIntelligenceModule } from '../intelligenceModule'
import { guardProductToolOutput } from './sensitiveDataGuard'
import {
  handleGetNewsSentimentItem,
  handleQueryMacroCalendar,
  handleQueryNewsSentiment
} from './readHandlers'

const deps = {
  jobRuntime: {} as JobRuntime,
  getAppLanguage: async () => 'zh-CN' as const,
  macroCalendarOps: {} as never,
  crossAssetOps: {} as never
}

function moduleWith(parts: {
  official?: unknown
  market?: unknown
  marketThrows?: boolean
  newsQuery?: unknown
}) {
  return {
    publicQueryService: {
      queryMacroEconomicCalendarMonth: vi.fn(async () => parts.official ?? { state: 'available', events: [] }),
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
      official: { eventCount: number }
      market: { eventCount: number; state: string }
      events: Array<{ source: string; eventKey: string }>
      caveats: string[]
    }

    expect(result.state).toBe('available')
    expect(result.official.eventCount).toBe(1)
    expect(result.market.eventCount).toBe(1)
    expect(result.events.map((event) => [event.source, event.eventKey])).toEqual([
      ['official', 'official-cpi'],
      ['market', 'market-fomc']
    ])
    expect(result.caveats).toEqual([])
    // The real handler output goes through this guard before the platform sees it; a Promise or
    // other non-JSON value (a missing await) would fail here.
    expect(() => guardProductToolOutput(result)).not.toThrow()
  })

  it('gives the agent the same surprise verdict and magnitude the surfaces use', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      official: {
        state: 'available',
        events: [{
          eventKey: 'official-cpi', title: 'CPI', scheduledAt: '2026-10-14T12:30:00.000Z', scheduledDate: '2026-10-14',
          actual: { displayValue: '3.4%' }, consensus: null
        }]
      },
      market: {
        state: 'available',
        events: [{
          eventKey: 'market-payrolls', title: 'Nonfarm payrolls', scheduledAt: '2026-10-14T13:30:00.000Z',
          providerActual: { displayValue: '165' }, providerPrevious: { displayValue: '150' }, consensus: { displayValue: '150' }
        }]
      }
    }) as never)

    const result = await handleQueryMacroCalendar({ month: '2026-10', asOf: '2026-10-14T14:00:00.000Z' }, deps) as never as {
      events: Array<Record<string, unknown>>
    }
    const official = result.events.find(event => event.eventKey === 'official-cpi')!
    const market = result.events.find(event => event.eventKey === 'market-payrolls')!

    // The official route never carries a consensus; the reason says which side is missing.
    expect(official).toMatchObject({ actual: '3.4%', surprise: 'consensus-unavailable', surpriseReason: 'missing-consensus' })
    expect(official.surpriseValue).toBeUndefined()

    // The market route used to drop providerActual/providerPrevious entirely; now the same contract
    // the card and facts read answers with a direction and a displayable magnitude.
    expect(market).toMatchObject({
      actual: '165', previous: '150', consensus: '150', surprise: 'beat',
      surpriseUnit: 'relative-percent'
    })
    expect(market.surpriseReason).toBeUndefined()
    expect(Number(market.surpriseValue)).toBeCloseTo(10, 10)
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

  it('follows every market page so a later date is not hidden behind the first page', async () => {
    const pages = [
      { state: 'available', events: [{ eventKey: 'market-early', title: 'Early', scheduledAt: '2026-10-14T12:00:00.000Z' }], nextCursor: 'page-2' },
      { state: 'available', events: [{ eventKey: 'market-late', title: 'Late', scheduledAt: '2026-10-28T12:30:00.000Z' }] }
    ]
    const queryMarketCalendarMonth = vi.fn(() => pages.shift())
    vi.mocked(getIntelligenceModule).mockReturnValue({
      publicQueryService: {
        queryMacroEconomicCalendarMonth: vi.fn(async () => ({ state: 'available', events: [] })),
        queryMarketCalendarMonth
      },
      newsSentiment: {}
    } as never)

    const result = await handleQueryMacroCalendar({ month: '2026-10', asOf: '2026-10-28T07:08:50.417Z' }, deps) as never as {
      events: Array<{ eventKey: string }>
      market: { eventCount: number; pages: number }
    }

    expect(queryMarketCalendarMonth).toHaveBeenCalledTimes(2)
    expect(result.market).toMatchObject({ eventCount: 2, pages: 2 })
    expect(result.events.map((event) => event.eventKey)).toEqual(['market-early', 'market-late'])
  })

  it('keeps the events nearest the query instant when the month overflows the cap', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      official: { state: 'available', events: [] },
      market: {
        state: 'available',
        events: [
          { eventKey: 'old', title: 'Old', scheduledAt: '2026-10-01T12:00:00.000Z' },
          { eventKey: 'middle', title: 'Middle', scheduledAt: '2026-10-15T12:00:00.000Z' },
          { eventKey: 'today', title: 'Today', scheduledAt: '2026-10-28T12:30:00.000Z' }
        ]
      }
    }) as never)

    const result = await handleQueryMacroCalendar({
      month: '2026-10',
      asOf: '2026-10-28T08:00:00.000Z',
      maxEvents: 2
    }, deps) as never as { events: Array<{ eventKey: string }>; truncated: boolean; totalEvents: number }

    expect(result.events.map((event) => event.eventKey)).toEqual(['middle', 'today'])
    expect(result.truncated).toBe(true)
    expect(result.totalEvents).toBe(3)
  })

  it('narrows to a date window when the caller asks about one day', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      official: { state: 'available', events: [] },
      market: {
        state: 'available',
        events: [
          { eventKey: 'market-early', title: 'Early', scheduledAt: '2026-10-14T12:00:00.000Z' },
          { eventKey: 'market-today', title: 'Today', scheduledAt: '2026-10-28T12:30:00.000Z' }
        ]
      }
    }) as never)

    const result = await handleQueryMacroCalendar({
      month: '2026-10',
      asOf: '2026-10-28T07:08:50.417Z',
      from: '2026-10-28T00:00:00.000+08:00',
      to: '2026-10-29T00:00:00.000+08:00'
    }, deps) as never as { events: Array<{ eventKey: string }>; totalEvents: number }

    expect(result.events.map((event) => event.eventKey)).toEqual(['market-today'])
    expect(result.totalEvents).toBe(1)
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
