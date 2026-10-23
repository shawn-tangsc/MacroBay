import { describe, expect, it } from 'vitest'

import { evaluateImpact } from './impactRuleEngine'
import { getIntelligenceSourceDefinition } from '../sourceCatalog'
import type { IntelligenceItem } from '../../schema/intelligenceRecord'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'

function buildItem(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-test',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'metric:test',
    sourceId: 'bls-economic-series',
    eventType: 'macro',
    title: 'US CPI Headline YoY',
    sourceCategory: 'macro',
    sourceTrust: 'high',
    detectedAt: new Date().toISOString(),
    timelineStatus: 'new',
    normalizerVersion: 'v1',
    ...overrides
  }
}

function buildMetric(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1',
    itemId: 'item-test',
    sourceId: 'bls-economic-series',
    metricKey: 'US_CPI_HEADLINE_YOY',
    metricName: 'US CPI Headline YoY',
    metricKind: 'inflation',
    actual: 3.4,
    previous: 3.1,
    comparisonBasis: 'actual-vs-previous',
    surpriseDirection: 'above',
    releaseTime: new Date().toISOString(),
    metricVersion: 'v1',
    ...overrides
  }
}

describe('impact rule engine', () => {
  it('creates bearish macro impacts for hot CPI', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bls-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem(),
      metricEvent: buildMetric(),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.scopeType === 'risk-assets' && impact.direction === 'bearish')).toBe(true)
    expect(impacts.some((impact) => impact.scopeType === 'crypto-market' && impact.direction === 'bearish')).toBe(true)
    expect(impacts.every((impact) => impact.evidenceJson.includes('US CPI Headline YoY'))).toBe(true)
  })

  it('creates bullish macro impacts for cooling CPI', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bls-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem(),
      metricEvent: buildMetric({ actual: 2.8, previous: 3.1, surpriseDirection: 'below' }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.direction === 'bullish')).toBe(true)
  })

  it('creates symbol-level funding impact without touching unrelated symbols', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('binance-futures-positioning')!
    const impacts = evaluateImpact({
      item: buildItem({
        sourceId: 'binance-futures-positioning',
        sourceCategory: 'exchange-announcement',
        title: 'ETH Funding Rate',
        symbolsJson: '["ETH"]'
      }),
      metricEvent: buildMetric({
        sourceId: 'binance-futures-positioning',
        metricKey: 'ETHUSDT_FUNDING_RATE',
        metricName: 'ETH Funding Rate',
        metricKind: 'funding-rate',
        actual: 0.08
      }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.scopeType === 'symbol' && impact.scopeKey === 'ETH')).toBe(true)
    expect(impacts.some((impact) => impact.scopeKey === 'BTC')).toBe(false)
  })

  it('creates bullish symbol impact for Binance listing headlines', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('binance-announcements')!
    const impacts = evaluateImpact({
      item: buildItem({
        sourceId: 'binance-announcements',
        sourceCategory: 'exchange-announcement',
        title: 'Binance Will List Example (ABC)',
        symbolsJson: '["ABC"]'
      }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(true)
  })

  it('creates bearish symbol impact for Binance delisting headlines', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('binance-announcements')!
    const impacts = evaluateImpact({
      item: buildItem({
        sourceId: 'binance-announcements',
        sourceCategory: 'exchange-announcement',
        eventType: 'exchange-announcement',
        title: 'Binance Will Delist Example Token (XYZ)',
        summary: 'Delisting'
      }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.ruleId === 'micro.binance.delisting.v1')).toBe(true)
    expect(impacts.some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(false)
  })

  it('creates recession-risk impacts for a large NFP miss before moderate cooling', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bls-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem({ title: 'US Nonfarm Payrolls' }),
      metricEvent: buildMetric({
        metricKey: 'US_PAYROLLS_NFP',
        metricName: 'US Nonfarm Payrolls',
        metricKind: 'employment',
        actual: 120,
        previous: 220,
        forecast: 220,
        surpriseDirection: 'below',
        surpriseMagnitude: 100
      }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.ruleId === 'macro.employment.recession-risk.v1')).toBe(true)
    expect(impacts.some((impact) => impact.ruleId === 'macro.employment.cooling.v1')).toBe(false)
  })

  it('creates moderate cooling impacts for a small NFP miss', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bls-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem({ title: 'US Nonfarm Payrolls' }),
      metricEvent: buildMetric({
        metricKey: 'US_PAYROLLS_NFP',
        metricName: 'US Nonfarm Payrolls',
        metricKind: 'employment',
        actual: 200,
        previous: 220,
        forecast: 220,
        surpriseDirection: 'below',
        surpriseMagnitude: 20
      }),
      sourceDefinition
    })

    expect(impacts.some((impact) => impact.ruleId === 'macro.employment.cooling.v1')).toBe(true)
    expect(impacts.some((impact) => impact.ruleId === 'macro.employment.recession-risk.v1')).toBe(false)
  })

  it('creates bearish macro impacts for hot PCE', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bea-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem({ sourceId: 'bea-economic-series', title: 'US PCE Headline YoY' }),
      metricEvent: buildMetric({
        metricKey: 'US_PCE_HEADLINE_YOY',
        metricName: 'US PCE Headline YoY',
        metricKind: 'inflation',
        actual: 3.6,
        previous: 3.1,
        surpriseDirection: 'above'
      }),
      sourceDefinition
    })
    expect(impacts.some((impact) => impact.ruleId === 'macro.inflation.hot.v1')).toBe(true)
  })

  it('creates mixed growth impacts for weak GDP', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('bea-economic-series')!
    const impacts = evaluateImpact({
      item: buildItem({ sourceId: 'bea-economic-series', title: 'US Real GDP QoQ Annualized' }),
      metricEvent: buildMetric({
        metricKey: 'US_GDP_REAL_QOQ_ANNUALIZED',
        metricName: 'US Real GDP QoQ Annualized',
        metricKind: 'growth',
        actual: 0.8,
        previous: 1.6,
        surpriseDirection: 'below'
      }),
      sourceDefinition
    })
    expect(impacts.some((impact) => impact.ruleId === 'macro.growth.weak.v1')).toBe(true)
  })

  it('creates bearish macro impacts for rising FRED yields', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('fred-rates-liquidity')!
    const impacts = evaluateImpact({
      item: buildItem({ sourceId: 'fred-rates-liquidity', title: 'US 10Y Treasury Yield' }),
      metricEvent: buildMetric({
        metricKey: 'US_10Y_YIELD',
        metricName: 'US 10Y Treasury Yield',
        metricKind: 'treasury-yield',
        actual: 4.52,
        previous: 4.35,
        surpriseDirection: 'up'
      }),
      sourceDefinition
    })
    expect(impacts.some((impact) => impact.ruleId === 'macro.yields.up.v1')).toBe(true)
  })

  it('creates low-confidence treasury liquidity proxy impacts with caveat evidence', () => {
    const sourceDefinition = getIntelligenceSourceDefinition('treasury-fiscal-data')!
    const impacts = evaluateImpact({
      item: buildItem({ sourceId: 'treasury-fiscal-data', title: 'Treasury General Account Balance' }),
      metricEvent: buildMetric({
        metricKey: 'US_TGA_BALANCE',
        metricName: 'Treasury General Account Balance',
        metricKind: 'liquidity',
        actual: 780000,
        previous: 760000,
        surpriseDirection: 'up'
      }),
      sourceDefinition
    })
    expect(impacts.some((impact) => impact.ruleId === 'macro.treasury.liquidity-drain.v1')).toBe(true)
    expect(impacts.every((impact) => impact.evidenceJson.includes('fiscal-liquidity-proxy'))).toBe(true)
    expect(impacts.every((impact) => impact.confidence <= 50)).toBe(true)
  })
})
