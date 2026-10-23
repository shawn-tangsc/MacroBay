import { describe, expect, it } from 'vitest'
import type { MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'

const asOf = '2026-10-03T00:00:00.000Z'
const publishedAt = '2026-09-22T00:00:00.000Z'
const context: MarketAnalysisContextAvailable = { state: 'available', schemaVersion: 1, profileId: 'crypto-market-analysis-v1', eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotId: null, snapshotHash: null, facts: [], missingDomains: ['macro'], caveats: ['evidence-unavailable'], evidenceRefs: [], sourceHealth: [], domainAccess: [] }
const ref = { evidenceRefId: 'item-1', itemId: 'item-1', sourceId: 'alternative-fear-greed', visibleAt: publishedAt, publishedAt, detectedAt: publishedAt, excerptHash: 'a'.repeat(64) }
const result = { evidenceRefs: [ref], data: { evidenceRef: ref, title: '情绪指标', excerpt: '恐惧贪婪指数为 80', sourceUrl: 'https://example.test/private' } }

describe('appendAnalysisEventEvidence', () => {
  it('rejects current item content when a revision arrived after the cutoff', async () => {
    const updated = await appendAnalysisEventEvidence(context, { eventRefs: ['item-1'], groupType: 'sentiment' }, { getEvidenceExcerpt: async () => result } as never,
      () => [{ itemId: 'item-1', detectedAt: '2026-10-04T00:00:00.000Z' }])
    expect(updated.facts).toHaveLength(0)
  })
  it('freezes the actual event excerpt without relabeling it as a current market observation', async () => {
    const updated = await appendAnalysisEventEvidence(context, { eventRefs: ['item-1'], groupType: 'sentiment' }, { getEvidenceExcerpt: async () => result } as never)
    expect(updated.evidenceRefs).toHaveLength(1)
    expect(updated.facts[0]).toMatchObject({ metric: 'event-excerpt', value: result.data.excerpt, observedAt: publishedAt, evidenceRefId: 'item-1' })
    expect(JSON.stringify(updated)).not.toContain('https://')
    expect(updated.caveats).toContain('evidence-unavailable')
    expect(context.facts).toHaveLength(0)
  })

  it.each([
    { ...result, evidenceRefs: [] },
    { ...result, evidenceRefs: [{ ...ref, visibleAt: '2026-10-05T00:00:00.000Z' }] },
    { ...result, data: { ...result.data, excerpt: '详情 https://example.test' } },
    { ...result, data: { ...result.data, excerpt: '[REDACTED]=sk-live-ABC' } },
    { ...result, evidenceRefs: [{ ...ref, itemId: 'unrelated-item' }] }
  ])('does not invent or admit invalid event evidence', async value => {
    const updated = await appendAnalysisEventEvidence(context, { eventRefs: ['item-1'], groupType: 'sentiment' }, { getEvidenceExcerpt: async () => value } as never)
    expect(updated.facts).toHaveLength(0)
    expect(updated.evidenceRefs).toHaveLength(0)
  })
})
