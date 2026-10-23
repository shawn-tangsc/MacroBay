import { describe, expect, it } from 'vitest'

import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from './queryContracts'
import { buildEvidenceExcerpt, buildEvidenceRef } from './evidenceSnapshotBuilder'

function sampleItem(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1',
    primaryRawRecordId: 'raw-1',
    canonicalDedupeKey: 'dedupe-1',
    sourceId: 'binance-announcements',
    eventType: 'listing',
    title: 'Listing update',
    summary: 'BTC listing announced with api_key=secret-value in body',
    sourceCategory: 'exchange-announcement',
    sourceTrust: 'high',
    detectedAt: '2026-07-08T09:00:00.000Z',
    publishedAt: '2026-07-08T08:30:00.000Z',
    timelineStatus: 'evaluated',
    normalizerVersion: 'v1',
    ...overrides
  }
}

describe('evidenceSnapshotBuilder', () => {
  it('builds stable evidence refs with renderer-safe summaries', () => {
    const ref = buildEvidenceRef({ item: sampleItem(), asOf: '2026-07-08T10:00:00.000Z' })
    expect(ref).toMatchObject({
      evidenceRefId: 'item-1',
      sourceId: 'binance-announcements',
      visibleAt: '2026-07-08T09:00:00.000Z',
      rendererSafeSummary: expect.stringContaining('[REDACTED]')
    })
    expect(ref?.rendererSafeSummary).not.toContain('secret-value')
  })

  it('rejects evidence with visibleAt after asOf', () => {
    const ref = buildEvidenceRef({
      item: sampleItem({ detectedAt: '2026-07-08T11:00:00.000Z' }),
      asOf: '2026-07-08T10:00:00.000Z'
    })
    expect(ref).toBeNull()
  })

  it('bounds excerpt length and omits raw payload fields', () => {
    const excerpt = buildEvidenceExcerpt({
      item: sampleItem({ summary: 'x'.repeat(800) }),
      asOf: '2026-07-08T10:00:00.000Z',
      maxExcerptChars: 100
    })

    expect(excerpt?.excerpt?.length).toBeLessThanOrEqual(100)
    expect(excerpt?.evidenceRef.caveats).not.toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
  })
})
