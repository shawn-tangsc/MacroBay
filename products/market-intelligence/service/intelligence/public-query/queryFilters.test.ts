import { describe, expect, it } from 'vitest'

import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligenceSentimentAggregate } from '../schema/intelligenceSentiment'
import {
  aggregateMatchesQueryFilters,
  impactMatchesQueryFilters,
  itemMatchesImpactFilters,
  itemMatchesQueryFilters
} from './queryFilters'

function item(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'dedupe-1',
    sourceId: 'binance-announcements',
    eventType: 'listing',
    title: 'Listing',
    sourceCategory: 'exchange-announcement',
    sourceTrust: 'high',
    detectedAt: '2026-07-08T09:00:00.000Z',
    timelineStatus: 'evaluated',
    normalizerVersion: 'v1',
    ...overrides
  }
}

function impact(overrides: Partial<IntelligenceImpact> = {}): IntelligenceImpact {
  return {
    impactId: 'impact-1',
    itemId: 'item-1',
    layer: 'asset',
    scopeType: 'symbol',
    scopeKey: 'BTCUSDT',
    direction: 'bullish',
    magnitude: 3,
    confidence: 80,
    horizon: 'intraday',
    reasoning: 'test',
    evidenceJson: '[]',
    ruleId: 'rule-1',
    ruleVersion: 'v1',
    createdAt: '2026-07-08T09:05:00.000Z',
    ...overrides
  }
}

describe('queryFilters', () => {
  it('filters items by sourceIds', () => {
    expect(itemMatchesQueryFilters(item(), { sourceIds: ['binance-announcements'] })).toBe(true)
    expect(itemMatchesQueryFilters(item(), { sourceIds: ['coindesk-rss'] })).toBe(false)
  })

  it('filters impacts by layer, direction, and minConfidence', () => {
    expect(impactMatchesQueryFilters(impact(), { layers: ['asset'], directions: ['bullish'], minConfidence: 50 })).toBe(
      true
    )
    expect(impactMatchesQueryFilters(impact(), { directions: ['bearish'] })).toBe(false)
    expect(impactMatchesQueryFilters(impact({ confidence: 20 }), { minConfidence: 50 })).toBe(false)
  })

  it('filters impacts by sourceIds when item is provided', () => {
    expect(impactMatchesQueryFilters(impact(), { sourceIds: ['binance-announcements'] }, item())).toBe(true)
    expect(impactMatchesQueryFilters(impact(), { sourceIds: ['coindesk-rss'] }, item())).toBe(false)
    expect(impactMatchesQueryFilters(impact(), { sourceIds: ['binance-announcements'] })).toBe(false)
  })

  it('requires matching impacts for related-event filters when impacts exist', () => {
    expect(
      itemMatchesImpactFilters(item(), [impact()], {
        directions: ['bullish']
      })
    ).toBe(true)
    expect(
      itemMatchesImpactFilters(item(), [impact({ direction: 'bearish' })], {
        directions: ['bullish']
      })
    ).toBe(false)
  })

  it('filters aggregates by sourceIds and horizon', () => {
    const aggregate: IntelligenceSentimentAggregate = {
      aggregateId: 'agg-1',
      scopeType: 'symbol',
      scopeKey: 'BTCUSDT',
      horizon: '1h',
      aggregateScore: 0.5,
      aggregateLabel: 'positive',
      confidence: 0.8,
      signalCount: 1,
      supportingItemIdsJson: '["item-1"]',
      layerBreakdownJson: '{"asset":1}',
      directionBreakdownJson: '{"bullish":1}',
      updatedAt: '2026-07-08T09:00:00.000Z',
      aggregateVersion: 'v1'
    }

    const itemsById = new Map([['item-1', item()]])
    expect(
      aggregateMatchesQueryFilters(aggregate, itemsById, {
        horizon: '1h',
        sourceIds: ['binance-announcements'],
        layers: ['asset'],
        directions: ['bullish']
      })
    ).toBe(true)
    expect(
      aggregateMatchesQueryFilters(aggregate, itemsById, {
        sourceIds: ['coindesk-rss']
      })
    ).toBe(false)
  })
})
