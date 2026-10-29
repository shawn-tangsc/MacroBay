import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

vi.mock('../intelligenceModule', () => ({ getIntelligenceModule: vi.fn() }))

import { getIntelligenceModule } from '../intelligenceModule'
import { handleGetDailyPulse } from './readHandlers'

const asOf = '2026-10-30T00:30:00.000Z'

const fearGreed = { state: 'available' as const, asOf, score: 48, bucket: 'fear' as const, observedAt: '2026-10-30T00:00:00.000Z' }
const funding = {
  state: 'available' as const, asOf,
  btc: [{ observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.008696 }],
  eth: [{ observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.005932 }]
}
const capital = {
  state: 'available' as const, asOf,
  etf: {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter', windowEnd: '2026-10-29', verifiedAt: asOf,
    btc: { asset: 'BTC' as const, rows: [{ tradingDate: '2026-10-29', netFlowUsd: 110_300_000, observedAt: '2026-10-29T00:00:00.000Z' }] },
    eth: { asset: 'ETH' as const, rows: [{ tradingDate: '2026-10-29', netFlowUsd: -88_600_000, observedAt: '2026-10-29T00:00:00.000Z' }] }
  },
  coreStablecoins: {
    observedAt: '2026-10-30T00:12:00.000Z', verifiedAt: asOf, currentUsd: 253_033_903_673.4,
    change1dUsd: -843_904_300.6, change1dPercent: -0.3324,
    change7dUsd: -2_075_176_969.6, change7dPercent: -0.8134,
    change30dUsd: -5_877_104_441.1, change30dPercent: -2.2699
  },
  conclusion: 'partial' as const
}

const profiles = [
  { sourceId: 'alternative-fear-greed', enabled: true },
  { sourceId: 'binance-futures-positioning', enabled: true },
  { sourceId: 'defillama-stablecoins', enabled: true },
  { sourceId: '0xrouter-aggregate-provider', enabled: true },
  { sourceId: 'macro-calendar-fed', enabled: true }
]

function moduleWith(overrides: Record<string, unknown> = {}) {
  return {
    publicQueryService: {
      queryFearGreedSnapshot: vi.fn(async () => fearGreed),
      queryFundingRateHistory: vi.fn(async () => funding),
      queryCapitalConditionsSnapshot: vi.fn(async () => capital)
    },
    newsSentiment: {
      query: {
        query: vi.fn(async () => ({
          state: 'available', asOf, generatedAt: asOf, window: '24h',
          items: [
            { itemId: 'n1', title: 'A', sourceId: 's', sourceName: 'S', publishedAt: asOf, scoredAt: asOf, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: [] },
            { itemId: 'n2', title: 'B', sourceId: 's', sourceName: 'S', publishedAt: asOf, scoredAt: asOf, polarity: 'bullish', strength: 3, confidence: 80, symbols: ['ETH'], reasonCode: 'x', engine: 'rules', caveats: [] }
          ],
          caveats: []
        }))
      }
    },
    sourceProfileStore: { listProfiles: vi.fn(async () => profiles) },
    ...overrides
  }
}

const deps = {
  jobRuntime: {} as JobRuntime,
  getAppLanguage: async () => 'zh-CN' as const,
  macroCalendarOps: {} as never,
  crossAssetOps: {} as never
}

beforeEach(() => vi.mocked(getIntelligenceModule).mockReset())

describe('handleGetDailyPulse', () => {
  it('returns the six readings and the 24h news summary without writing anything', async () => {
    const module = moduleWith()
    vi.mocked(getIntelligenceModule).mockReturnValue(module as never)

    const result = (await handleGetDailyPulse({ asOf }, deps)) as Record<string, unknown>
    expect(result).toMatchObject({ state: 'available', asOf, news: { state: 'available', itemCount: 2, counts: { bearish: 1, bullish: 1 } } })
    const readings = result.readings as Array<Record<string, unknown>>
    expect(readings).toHaveLength(6)
    expect(readings.find((row) => row.id === 'fear-greed')).toMatchObject({ group: 'sentiment', state: 'available', value: { number: 48, format: 'score' } })
    expect(readings.find((row) => row.id === 'etf-btc')).toMatchObject({ state: 'available', value: { number: 110_300_000, format: 'flow-usd' } })
    expect(result.caveats).toEqual([])
  })

  it('marks a switched-off ETF source instead of inventing a reading', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      sourceProfileStore: { listProfiles: vi.fn(async () => profiles.filter((profile) => profile.sourceId !== '0xrouter-aggregate-provider')) }
    }) as never)

    const result = (await handleGetDailyPulse({ asOf }, deps)) as Record<string, unknown>
    expect(result.state).toBe('partial')
    expect((result.readings as Array<Record<string, unknown>>).filter((row) => String(row.id).startsWith('etf-')).map((row) => row.state))
      .toEqual(['source-disabled', 'source-disabled'])
    expect(result.caveats).toContain('reading-gap')
  })

  it('keeps a query failure as a stated gap and survives a missing news query', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      publicQueryService: {
        queryFearGreedSnapshot: vi.fn(async () => { throw new Error('down') }),
        queryFundingRateHistory: vi.fn(async () => funding),
        queryCapitalConditionsSnapshot: vi.fn(async () => capital)
      },
      newsSentiment: {}
    }) as never)

    const result = (await handleGetDailyPulse({ asOf }, deps)) as Record<string, unknown>
    expect(result.state).toBe('partial')
    expect((result.readings as Array<Record<string, unknown>>).find((row) => row.id === 'fear-greed')).toMatchObject({
      state: 'unavailable', reason: 'query-failed'
    })
    expect(result.news).toEqual({ state: 'unavailable' })
    expect(result.caveats).toContain('news-unavailable')
  })

  it('treats an unreadable profile store as unknown and an invalid asOf as a rejected request', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith({
      sourceProfileStore: { listProfiles: vi.fn(async () => { throw new Error('no store') }) }
    }) as never)
    const result = (await handleGetDailyPulse({ asOf }, deps)) as Record<string, unknown>
    expect(result.caveats).toContain('source-switches-unknown')
    await expect(handleGetDailyPulse({ asOf: 'not-a-time' }, deps)).rejects.toThrow('daily-pulse-invalid-as-of')
  })
})
