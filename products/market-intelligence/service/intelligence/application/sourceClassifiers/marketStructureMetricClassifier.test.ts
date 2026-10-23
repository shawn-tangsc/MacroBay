import { describe, expect, it } from 'vitest'

import { classifyMarketStructureMetric } from './marketStructureMetricClassifier'

describe('marketStructureMetricClassifier', () => {
  it('adds contrarian caveat for extreme funding', () => {
    const result = classifyMarketStructureMetric({
      sourceId: 'binance-futures-positioning',
      title: 'ETH Funding Rate',
      metricKey: 'ETHUSDT_FUNDING_RATE',
      metricKind: 'funding-rate',
      metricActual: 0.08,
      comparisonBasis: 'level'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.caveats).toContain('contrarian-metric')
  })

  it('classifies extreme fear with caveat', () => {
    const result = classifyMarketStructureMetric({
      sourceId: 'alternative-fear-greed',
      title: 'Fear & Greed Index',
      metricKey: 'FEAR_GREED_INDEX',
      metricKind: 'fear-greed',
      metricActual: 18
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.eventSubtype).toBe('fear-extreme')
    expect(result.caveats).toContain('contrarian-metric')
  })
})
