import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition, listIntelligenceSourceDefinitions } from './sourceCatalog'
import {
  isItemApplicableToFocusMarkets,
  isSourceApplicableToFocusMarkets,
  listApplicableSourceDefinitions,
  resolveItemFocusMarkets
} from './intelligenceSourceApplicability'
import type { IntelligenceItem } from '../schema/intelligenceRecord'

describe('intelligenceSourceApplicability', () => {
  it('defaults focus markets to global-macro and digital-assets applicability', () => {
    const applicable = listApplicableSourceDefinitions(['global-macro', 'digital-assets'])
    expect(applicable.some((source) => source.sourceId === 'federal-reserve-rss')).toBe(true)
    expect(applicable.some((source) => source.sourceId === 'binance-announcements')).toBe(true)
  })

  it('hides digital-asset-only sources when digital-assets is disabled', () => {
    const applicable = listApplicableSourceDefinitions(['global-macro'])
    expect(applicable.some((source) => source.sourceId === 'federal-reserve-rss')).toBe(true)
    expect(applicable.some((source) => source.sourceId === 'binance-announcements')).toBe(false)
    expect(applicable.some((source) => source.sourceId === 'alternative-fear-greed')).toBe(false)
  })

  it('requires global-macro for global applicability sources', () => {
    const fed = getIntelligenceSourceDefinition('federal-reserve-rss')!
    expect(isSourceApplicableToFocusMarkets(fed, ['digital-assets'])).toBe(false)
    expect(isSourceApplicableToFocusMarkets(fed, ['global-macro'])).toBe(true)
  })

  it('classifies dynamic SEC items before they affect focus markets', () => {
    const sec = getIntelligenceSourceDefinition('sec-rss')!
    const cryptoItem = sampleItem({
      title: 'SEC charges crypto exchange with securities violations',
      summary: 'Digital asset token offering'
    })
    const equityItem = sampleItem({
      title: 'SEC charges issuer with securities fraud on NASDAQ',
      summary: 'Equity offering'
    })

    expect(resolveItemFocusMarkets(cryptoItem, sec)).toContain('digital-assets')
    expect(resolveItemFocusMarkets(equityItem, sec)).toContain('us-equities')
    expect(isItemApplicableToFocusMarkets(cryptoItem, sec, ['global-macro'])).toBe(false)
    expect(isItemApplicableToFocusMarkets(equityItem, sec, ['us-equities'])).toBe(true)
  })

  it('covers every visible catalog source with applicability metadata', () => {
    for (const source of listIntelligenceSourceDefinitions().filter((entry) => entry.visibility !== 'hidden')) {
      expect(source.sourceKind).toBeTruthy()
      expect(source.applicabilityMode).toBeTruthy()
      expect(source.focusMarkets.length).toBeGreaterThan(0)
    }
  })
})

function sampleItem(input: Pick<IntelligenceItem, 'title' | 'summary'>): IntelligenceItem {
  return {
    itemId: 'item-1',
    sourceId: 'sec-rss',
    sourceCategory: 'regulation',
    title: input.title,
    summary: input.summary,
    eventType: 'regulatory-action',
    detectedAt: '2026-01-01T00:00:00.000Z',
    symbolsJson: '[]',
    dedupeKey: 'dedupe-1',
    rawRecordId: 'raw-1'
  }
}
