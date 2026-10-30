import { describe, expect, it } from 'vitest'

import { withoutSourceUrlsForModel } from './registerMarketAnalysisProductTool'

describe('market analysis context tool redaction', () => {
  it('removes source URLs from facts and evidence before an Agent sees the context', () => {
    const context = {
      state: 'available' as const,
      schemaVersion: 2 as const,
      profileId: 'crypto-market-analysis-v1' as const,
      eventGroupId: 'mi-eg-1',
      asOf: '2026-10-30T15:05:00.000Z',
      dataCutoff: '2026-10-30T15:05:00.000Z',
      snapshotId: null,
      snapshotHash: null,
      facts: [{
        factId: 'mi-fact-policy', domain: 'macro' as const, subject: 'hike-25', metric: 'policy-implied-probability',
        value: 71, unit: 'percent', sourceId: 'policy-path-market', sourceLabel: 'policy-path-market',
        observedAt: '2026-10-30T15:00:00.000Z', asOf: '2026-10-30T15:05:00.000Z', freshness: 'fresh' as const,
        confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-policy',
        sourceUrl: 'https://polymarket.com/'
      }],
      missingDomains: [], caveats: [], sourceHealth: [], domainAccess: [],
      evidenceRefs: [{
        evidenceRefId: 'ev-policy', sourceId: 'policy-path-market', sourceLabel: 'policy-path-market', itemId: null,
        occurredAt: '2026-10-30T15:00:00.000Z', publishedAt: '2026-10-30T15:00:00.000Z', detectedAt: '2026-10-30T15:00:00.000Z',
        computedAt: '2026-10-30T15:05:00.000Z', visibleAt: '2026-10-30T15:05:00.000Z', excerptHash: 'hash',
        sourceUrl: 'https://polymarket.com/'
      }]
    }

    const output = withoutSourceUrlsForModel(context)

    expect(output.state).toBe('available')
    expect(JSON.stringify(output)).not.toContain('https://')
    expect(output.state === 'available' ? output.facts[0] : undefined).toMatchObject({ metric: 'policy-implied-probability', value: 71 })
  })
})
