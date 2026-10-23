import { describe, expect, it } from 'vitest'

import { evaluateCentralBankRules } from './centralBankImpactRules'
import { evaluateExchangeAnnouncementRules } from './exchangeAnnouncementImpactRules'
import { evaluateRegulatorRules } from './regulatorImpactRules'
import { evaluateStatusIncidentRules } from './statusIncidentImpactRules'
import { evaluateMarketStructureRules } from './marketStructureImpactRules'
import { getIntelligenceSourceDefinition } from '../sourceCatalog'
import type { IntelligenceItem } from '../../schema/intelligenceRecord'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'

function buildItem(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-test',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'test:1',
    sourceId: 'federal-reserve-rss',
    eventType: 'macro',
    title: 'Fed statement',
    sourceCategory: 'macro',
    sourceTrust: 'high',
    detectedAt: new Date().toISOString(),
    timelineStatus: 'new',
    normalizerVersion: 'v1',
    ...overrides
  }
}

describe('P0 core domain impact rules', () => {
  it('evaluates Fed hawkish and dovish impacts', () => {
    const source = getIntelligenceSourceDefinition('federal-reserve-rss')!
    const hawkish = evaluateCentralBankRules({
      item: buildItem({ title: 'Fed signals further tightening as inflation remains elevated' }),
      sourceDefinition: source
    })
    const dovish = evaluateCentralBankRules({
      item: buildItem({ title: 'Fed officials open to pause and lower rates' }),
      sourceDefinition: source
    })
    expect(hawkish.some((impact) => impact.ruleId === 'macro.fed.hawkish.v1')).toBe(true)
    expect(dovish.some((impact) => impact.ruleId === 'macro.fed.dovish.v1')).toBe(true)
  })

  it('uses classifier impact hints when the headline is generic', () => {
    const source = getIntelligenceSourceDefinition('federal-reserve-rss')!
    const hawkish = evaluateCentralBankRules({
      item: buildItem({
        title: 'Federal Reserve Press Release',
        summary: 'Read the full statement.',
        processingLabelsJson: JSON.stringify({
          relevanceOutcome: 'full-intelligence',
          sentimentEligible: true,
          impactHintJson: JSON.stringify({ direction: 'bearish', reasonCode: 'hawkish', horizon: '1w' })
        })
      }),
      sourceDefinition: source
    })
    expect(hawkish.some((impact) => impact.ruleId === 'macro.fed.hawkish.v1')).toBe(true)
  })

  it('evaluates regulator positive and negative impacts', () => {
    const source = getIntelligenceSourceDefinition('sec-rss')!
    const negative = evaluateRegulatorRules({
      item: buildItem({
        sourceId: 'sec-rss',
        sourceCategory: 'regulation',
        title: 'SEC enforcement action against crypto exchange'
      }),
      sourceDefinition: source
    })
    const positive = evaluateRegulatorRules({
      item: buildItem({
        sourceId: 'sec-rss',
        sourceCategory: 'regulation',
        title: 'SEC approves ETF approval framework'
      }),
      sourceDefinition: source
    })
    expect(negative.some((impact) => impact.ruleId === 'macro.regulation.negative.v1')).toBe(true)
    expect(positive.some((impact) => impact.ruleId === 'macro.regulation.positive.v1')).toBe(true)
  })

  it('uses regulator eventSubtype when the headline omits enforcement keywords', () => {
    const source = getIntelligenceSourceDefinition('sec-rss')!
    const negative = evaluateRegulatorRules({
      item: buildItem({
        sourceId: 'sec-rss',
        sourceCategory: 'regulation',
        title: 'SEC Press Release',
        summary: 'Read the full release.',
        processingLabelsJson: JSON.stringify({
          relevanceOutcome: 'full-intelligence',
          sentimentEligible: true,
          eventSubtype: 'regulator-enforcement',
          impactHintJson: JSON.stringify({ direction: 'bearish', reasonCode: 'regulator-enforcement' })
        })
      }),
      sourceDefinition: source
    })
    expect(negative.some((impact) => impact.ruleId === 'macro.regulation.negative.v1')).toBe(true)
  })

  it('evaluates exchange listing and API context impacts', () => {
    const source = getIntelligenceSourceDefinition('binance-announcements')!
    const listing = evaluateExchangeAnnouncementRules({
      item: buildItem({
        sourceId: 'binance-announcements',
        sourceCategory: 'exchange-announcement',
        title: 'Binance Will List Example (ABC)',
        symbolsJson: '["ABC"]'
      }),
      sourceDefinition: source
    })
    const api = evaluateExchangeAnnouncementRules({
      item: buildItem({
        sourceId: 'binance-api-updates',
        sourceCategory: 'exchange-announcement',
        title: 'Binance API Update: endpoint change',
        processingLabelsJson: JSON.stringify({
          relevanceOutcome: 'context-only',
          eventSubtype: 'exchange-api-update'
        })
      }),
      sourceDefinition: getIntelligenceSourceDefinition('binance-api-updates')!
    })
    expect(listing.some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(true)
    expect(api.some((impact) => impact.ruleId === 'micro.exchange.api-context.v1')).toBe(true)
  })

  it('uses exchange eventSubtype when listing keywords are only in classifier output', () => {
    const listing = evaluateExchangeAnnouncementRules({
      item: buildItem({
        sourceId: 'binance-announcements',
        sourceCategory: 'exchange-announcement',
        title: 'Binance Announcement',
        summary: 'See catalog details.',
        symbolsJson: '["ABC"]',
        processingLabelsJson: JSON.stringify({
          relevanceOutcome: 'full-intelligence',
          sentimentEligible: true,
          eventSubtype: 'exchange-listing',
          impactHintJson: JSON.stringify({ direction: 'bullish', reasonCode: 'exchange-listing', horizon: '1d' })
        })
      }),
      sourceDefinition: getIntelligenceSourceDefinition('binance-announcements')!
    })
    expect(listing.some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(true)
  })

  it('evaluates status outage and resolved context impacts', () => {
    const active = evaluateStatusIncidentRules({
      item: buildItem({
        sourceId: 'coinbase-status',
        sourceCategory: 'exchange-status',
        eventType: 'incident',
        title: 'Trading degraded'
      }),
      sourceDefinition: getIntelligenceSourceDefinition('coinbase-status')!
    })
    const resolved = evaluateStatusIncidentRules({
      item: buildItem({
        sourceId: 'coinbase-status',
        sourceCategory: 'exchange-status',
        eventType: 'incident',
        title: 'Trading restored',
        processingLabelsJson: JSON.stringify({
          relevanceOutcome: 'context-only',
          eventSubtype: 'status-incident-resolved'
        })
      }),
      sourceDefinition: getIntelligenceSourceDefinition('coinbase-status')!
    })
    expect(active.some((impact) => impact.ruleId === 'micro.exchange.incident.v1')).toBe(true)
    expect(resolved.some((impact) => impact.ruleId === 'micro.status.resolved-context.v1')).toBe(true)
  })

  it('evaluates contrarian funding impacts', () => {
    const metric = (overrides: Partial<MetricIntelligenceEvent>): MetricIntelligenceEvent => ({
      metricEventId: 'metric-1',
      itemId: 'item-test',
      sourceId: 'binance-futures-positioning',
      metricKey: 'ETHUSDT_FUNDING_RATE',
      metricName: 'ETH Funding Rate',
      metricKind: 'funding-rate',
      actual: 155_000_000_000,
      previous: 150_000_000_000,
      comparisonBasis: 'actual-vs-previous',
      surpriseDirection: 'up',
      releaseTime: new Date().toISOString(),
      metricVersion: 'v1',
      ...overrides
    })

    const funding = evaluateMarketStructureRules({
      item: buildItem({
        sourceId: 'binance-futures-positioning',
        symbolsJson: '["ETH"]',
        processingLabelsJson: JSON.stringify({ relevanceOutcome: 'full-intelligence', sentimentEligible: true })
      }),
      metricEvent: metric({
        sourceId: 'binance-futures-positioning',
        metricKey: 'ETHUSDT_FUNDING_RATE',
        metricName: 'ETH Funding Rate',
        metricKind: 'funding-rate',
        actual: 0.08,
        previous: undefined,
        comparisonBasis: 'level',
        surpriseDirection: 'unknown'
      }),
      sourceDefinition: getIntelligenceSourceDefinition('binance-futures-positioning')!
    })

    expect(funding.some((impact) => impact.ruleId === 'micro.funding.crowded-long.v1')).toBe(true)
    expect(funding[0]?.evidenceJson).toContain('contrarian-metric')
  })
})
