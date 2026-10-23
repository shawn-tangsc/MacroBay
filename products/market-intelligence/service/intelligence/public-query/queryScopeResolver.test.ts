import { describe, expect, it } from 'vitest'

import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from './queryContracts'
import { impactMatchesScope, itemMatchesScope, normalizeQueryScope } from './queryScopeResolver'

function sampleItem(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'dedupe-1',
    sourceId: 'binance-announcements',
    eventType: 'listing',
    title: 'Listing update',
    sourceCategory: 'exchange-announcement',
    sourceTrust: 'high',
    detectedAt: '2026-07-08T09:00:00.000Z',
    symbolsJson: '["BTCUSDT"]',
    timelineStatus: 'evaluated',
    normalizerVersion: 'v1',
    ...overrides
  }
}

function sampleImpact(overrides: Partial<IntelligenceImpact> = {}): IntelligenceImpact {
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

describe('queryScopeResolver', () => {
  it('matches exact symbol scope for items and impacts', () => {
    const scope = normalizeQueryScope({ symbol: 'BTCUSDT' })
    expect(itemMatchesScope(sampleItem(), scope).matched).toBe(true)
    expect(impactMatchesScope(sampleImpact(), sampleItem(), scope).matched).toBe(true)
  })

  it('falls back to asset scope and adds caveat', () => {
    const scope = normalizeQueryScope({ asset: 'BTC' })
    const result = itemMatchesScope(sampleItem(), scope)
    expect(result.matched).toBe(true)
    expect(result.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.scopeResolvedByAssetFallback)
  })

  it('does not treat venue-specific events as market-wide without market scope', () => {
    const scope = normalizeQueryScope({ symbol: 'ETHUSDT' })
    expect(itemMatchesScope(sampleItem(), scope).matched).toBe(false)
  })

  it('treats empty scope as market-wide without returning all raw rows blindly', () => {
    const scope = normalizeQueryScope(undefined)
    expect(scope.isMarketWide).toBe(true)
    expect(itemMatchesScope(sampleItem(), scope).matched).toBe(true)
  })
})
