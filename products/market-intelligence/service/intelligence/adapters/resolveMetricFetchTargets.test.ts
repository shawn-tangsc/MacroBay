import { describe, expect, it } from 'vitest'

import { resolveMetricFetchTargets } from './resolveMetricFetchTargets'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

const baseConfig: IntelligenceSourceConfig = {
  sourceId: 'binance-spot-market',
  sourceName: 'Binance Spot Market',
  sourceGroup: 'exchange-announcement',
  adapterType: 'rest-api-poller',
  executionMode: 'polling',
  enabled: true,
  category: 'exchange-announcement',
  trustLevel: 'high',
  language: 'en',
  collectionPreset: 'balanced',
  desiredRuntimeState: 'polling',
  parserStrategy: 'binance-spot-market-v1',
  noisePolicy: 'balanced',
  includeInSentiment: true,
  scopePolicy: 'watchlist-priority',
  rawArchiveEnabled: false,
  retentionMode: 'balanced',
  autoReplayAfterParserUpgrade: false,
  sentimentEligible: true,
  adapterConfig: {
    endpointUrl: 'https://api.binance.com/api/v3/ticker/24hr',
    symbolParam: 'symbol',
    symbols: ['ETHUSDT', 'BTCUSDT']
  }
}

describe('resolveMetricFetchTargets', () => {
  it('expands one URL per configured symbol', () => {
    const targets = resolveMetricFetchTargets(baseConfig)
    expect(targets).toHaveLength(2)
    expect(targets[0]?.url).toContain('symbol=ETHUSDT')
    expect(targets[1]?.url).toContain('symbol=BTCUSDT')
  })

  it('keeps single endpoint when symbol expansion is not configured', () => {
    const targets = resolveMetricFetchTargets({
      ...baseConfig,
      adapterConfig: {
        endpointUrl: 'https://api.alternative.me/fng/?limit=1'
      }
    })
    expect(targets).toEqual([{ url: 'https://api.alternative.me/fng/?limit=1', symbol: undefined }])
  })

  it('preserves static query params for funding endpoints', () => {
    const targets = resolveMetricFetchTargets({
      ...baseConfig,
      sourceId: 'binance-futures-positioning',
      adapterConfig: {
        endpointUrl: 'https://fapi.binance.com/fapi/v1/fundingRate',
        symbolParam: 'symbol',
        symbols: ['ETHUSDT'],
        limit: 1
      }
    })
    expect(targets[0]?.url).toContain('symbol=ETHUSDT')
    expect(targets[0]?.url).toContain('limit=1')
  })

  it('routes macro sources through macro request builders', () => {
    const targets = resolveMetricFetchTargets({
      ...baseConfig,
      sourceId: 'bea-economic-series',
      category: 'macro',
      adapterConfig: {
        endpointUrl: 'https://apps.bea.gov/api/data',
        requestMode: 'bea-dataset',
        freshnessWindowMs: 45 * 24 * 60 * 60 * 1000,
        releaseCadence: 'monthly',
        series: [
          {
            key: 'US_GDP_REAL_QOQ_ANNUALIZED',
            dataset: 'NIPA',
            table: 'T10101',
            lineCode: '1',
            metricName: 'US Real GDP QoQ Annualized',
            metricKind: 'growth',
            comparisonBasis: 'actual-vs-previous',
            frequency: 'quarterly'
          }
        ],
        requestDefaults: { method: 'GetData', Year: 'ALL' }
      }
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]?.url).toContain('TableName=T10101')
  })
})
