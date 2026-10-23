// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { computeSnapshotChange } from '../../../service/intelligence/analysis/snapshotChange'
import { marketAnalysisTimelineClient } from './marketAnalysisTimelineClient'

const asOf = '2026-10-07T09:06:14.792Z'
const fact = (value: unknown) => ({
  factId: 'mi-fact-1', domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', value, unit: 'USD',
  sourceId: 'x', sourceLabel: 'x', observedAt: asOf, asOf, freshness: 'fresh', comparability: 'comparable', evidenceRefId: 'ev-1'
})

/** Mirrors exactly what the timeline service sends for a run. */
function runDetail(change: ReturnType<typeof computeSnapshotChange>) {
  return {
    id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
    queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1,
    change: {
      summary: 's',
      facts: change.facts.map(f => ({
        domain: String(f.domain), subject: f.subject ?? null, metric: f.metric, unit: f.unit ?? null, kind: f.kind,
        previousValue: f.previousValue ?? null, value: f.value ?? null
      })),
      missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0
    }
  }
}

const entry = {
  id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
  occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: 't', safeExcerpt: null, version: 1
}

const summary = {
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  eventAssessment: 'c', knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [],
  counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
}

/**
 * The client rejects the whole detail when one field is malformed, so an added or
 * removed fact - which legitimately has only one of the two values - must still
 * cross the wire as an available detail.
 */
describe('market analysis change over the IPC boundary', () => {
  it('keeps a detail available when a fact was only added', async () => {
    const change = computeSnapshotChange({
      current: { facts: [fact(314)], missingDomains: [], caveats: [], evidenceRefs: [] } as never,
      previous: { snapshotHash: 'h', facts: [], missingDomains: [], caveats: [], evidenceRefs: [] } as never
    })
    vi.stubGlobal('platform', { products: { invoke: async (_p: string, method: string) => method === 'marketAnalysis.getAnalysisRun' ? runDetail(change) : method === 'marketAnalysis.getSummary' ? summary : [] } })

    const detail = await marketAnalysisTimelineClient.getDetail(entry)
    expect(detail.state).toBe('available')
    expect(detail.state === 'available' ? detail.detail.run.change?.facts[0] : undefined).toEqual(
      expect.objectContaining({ metric: 'etf-net-flow-usd', subject: 'BTC', kind: 'added', previousValue: null, value: 314 })
    )
  })

  it('keeps a detail available for a large diff, which previously exceeded the text bound', async () => {
    // A real diff reached 104 facts and the compact encoding of it was 23,852
    // characters, past MAX_TEXT_LENGTH, which rejected the whole detail. The
    // renderer view must not carry that encoding at all.
    const facts = Array.from({ length: 104 }, (_, index) => ({
      domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', unit: 'USD', kind: 'removed' as const,
      previousValue: index * 1_000_000, value: null
    }))
    const run = { ...runDetail(computeSnapshotChange({ current: { facts: [], missingDomains: [], caveats: [], evidenceRefs: [] } as never })), change: {
      facts, missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0
    } }
    vi.stubGlobal('platform', { products: { invoke: async (_p: string, method: string) => method === 'marketAnalysis.getAnalysisRun' ? run : method === 'marketAnalysis.getSummary' ? summary : [] } })

    const detail = await marketAnalysisTimelineClient.getDetail(entry)
    expect(detail.state).toBe('available')
    expect(detail.state === 'available' ? detail.detail.run.change?.facts.length : 0).toBe(104)
  })

  it('keeps a detail available when a fact was only removed', async () => {
    const change = computeSnapshotChange({
      current: { facts: [], missingDomains: [], caveats: [], evidenceRefs: [] } as never,
      previous: { snapshotHash: 'h', facts: [fact(314)], missingDomains: [], caveats: [], evidenceRefs: [] } as never
    })
    vi.stubGlobal('platform', { products: { invoke: async (_p: string, method: string) => method === 'marketAnalysis.getAnalysisRun' ? runDetail(change) : method === 'marketAnalysis.getSummary' ? summary : [] } })

    const detail = await marketAnalysisTimelineClient.getDetail(entry)
    expect(detail.state).toBe('available')
  })
})
