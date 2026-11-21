import { describe, expect, it } from 'vitest'

import { parseBlsEconomicSeriesPayload } from './blsEconomicSeriesParser'
import { parseAlternativeFearGreedPayload } from './alternativeFearGreedParser'
import { parseBinanceSpotMarketPayload } from './binanceSpotMarketParser'
import { parseBinanceFundingRatePayload } from './binanceFuturesPositioningParser'

const config = {
  sourceId: 'test-source',
  sourceName: 'Test',
  sourceGroup: 'macro-regulation',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'macro',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'manual',
  desiredRuntimeState: 'polling',
  parserStrategy: 'test',
  noisePolicy: 'balanced',
  scopePolicy: 'all',
  rawArchiveEnabled: false,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: false,
  adapterConfig: { symbol: 'ETHUSDT' }
} as const

describe('metric parsers', () => {
  it('parses BLS CPI fixture into YoY metric drafts from index levels', () => {
    const drafts = parseBlsEconomicSeriesPayload(
      {
        Results: {
          series: [
            {
              seriesID: 'CUSR0000SA0',
              data: [
                { year: '2026', period: 'M06', value: '310.500' },
                { year: '2025', period: 'M06', value: '300.000' },
                { year: '2026', period: 'M05', value: '309.000' },
                { year: '2025', period: 'M05', value: '299.500' }
              ]
            }
          ]
        }
      },
      config
    )

    expect(drafts[0]?.metricKey).toBe('US_CPI_HEADLINE_YOY')
    expect(drafts[0]?.actual).toBeCloseTo(3.5, 2)
    expect(drafts[0]?.previous).toBeCloseTo(3.172, 2)
    expect(drafts[0]?.releaseTime).toBe('2026-07-13T12:30:00.000Z')
  })

  it('parses fear and greed fixture', () => {
    const drafts = parseAlternativeFearGreedPayload(
      { data: [{ value: '22', value_classification: 'Extreme Fear', timestamp: '1719619200' }] },
      { ...config, sourceId: 'alternative-fear-greed', category: 'mainstream-news' }
    )
    expect(drafts[0]?.metricKind).toBe('fear-greed')
    expect(drafts[0]?.actual).toBe(22)
  })

  it('parses every day in a fear and greed payload, newest first', () => {
    const drafts = parseAlternativeFearGreedPayload(
      { data: [
        { value: '24', value_classification: 'Extreme Fear', timestamp: '1795046400' },
        { value: '31', value_classification: 'Fear', timestamp: '1794960000' },
        { value: '40', value_classification: 'Fear', timestamp: '1794873600' }
      ] },
      { ...config, sourceId: 'alternative-fear-greed', category: 'mainstream-news' }
    )
    expect(drafts.map((draft) => draft.period)).toEqual(['2026-11-19', '2026-11-18', '2026-11-17'])
    expect(drafts.map((draft) => draft.actual)).toEqual([24, 31, 40])
    expect(drafts[0]?.releaseTime).toBe('2026-11-19T00:00:00.000Z')
  })

  it('skips fear and greed days with no timestamp instead of pretending they are today', () => {
    const drafts = parseAlternativeFearGreedPayload(
      { data: [
        { value: '24', value_classification: 'Extreme Fear', timestamp: '1795046400' },
        { value: 'not-a-number' },
        { value: '31', value_classification: 'Fear' }
      ] },
      { ...config, sourceId: 'alternative-fear-greed', category: 'mainstream-news' }
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.period).toBe('2026-11-19')
  })

  it('throws when no fear and greed day carries a usable timestamp and value', () => {
    expect(() => parseAlternativeFearGreedPayload(
      { data: [{ value: '24' }, { value: 'x', timestamp: '1795046400' }] },
      { ...config, sourceId: 'alternative-fear-greed', category: 'mainstream-news' }
    )).toThrow(/alternative-fear-greed/)
  })

  it('parses Binance ETH ticker fixture', () => {
    const drafts = parseBinanceSpotMarketPayload(
      {
        symbol: 'ETHUSDT',
        priceChangePercent: '4.25',
        lastPrice: '3450.12',
        closeTime: 1720209600000
      },
      { ...config, sourceId: 'binance-spot-market', category: 'exchange-announcement' }
    )
    expect(drafts[0]?.metricKey).toBe('ETHUSDT_24H_TICKER')
    expect(drafts[0]?.actual).toBe(4.25)
  })

  it('parses Binance funding fixture', () => {
    const drafts = parseBinanceFundingRatePayload(
      [{ symbol: 'ETHUSDT', fundingRate: '0.00081234', fundingTime: 1720209600000 }],
      { ...config, sourceId: 'binance-futures-positioning', category: 'exchange-announcement' }
    )
    expect(drafts[0]?.metricKey).toBe('ETHUSDT_FUNDING_RATE')
    expect(drafts[0]?.metricKind).toBe('funding-rate')
  })

  it('throws when required numeric fields are missing', () => {
    expect(() => parseBinanceSpotMarketPayload({ symbol: 'ETHUSDT' }, config)).toThrow(
      /missing priceChangePercent/
    )
  })
})
