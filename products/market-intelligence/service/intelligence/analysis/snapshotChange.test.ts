import { describe, expect, it } from 'vitest'

import type { AgentFact, AgentEvidenceRef, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { computeSnapshotChange, isUnchangedSnapshot, snapshotChangePolicy } from './snapshotChange'

const fact = (factId: string, value: string, metric = 'actual'): AgentFact => ({
  factId, domain: 'macro', subject: 'CPI', metric, value, unit: '%', sourceId: 'official', sourceLabel: '官方',
  observedAt: '2026-10-06T00:00:00.000Z', asOf: '2026-10-06T00:00:00.000Z', freshness: 'fresh', confidence: 1,
  comparability: 'comparable', evidenceRefId: 'ev-1'
})

const ref = (evidenceRefId: string): AgentEvidenceRef => ({
  evidenceRefId, sourceId: 'official', sourceLabel: '官方', itemId: null, occurredAt: null, publishedAt: null,
  detectedAt: null, computedAt: null, visibleAt: '2026-10-06T00:00:00.000Z', excerptHash: evidenceRefId
})

const snapshot = (overrides: Partial<EvidenceSnapshot> & Pick<EvidenceSnapshot, 'facts'>): EvidenceSnapshot => ({
  id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf: '2026-10-06T00:00:00.000Z', dataCutoff: '2026-10-06T00:00:00.000Z',
  snapshotHash: 'hash-1', profileId: 'crypto-market-analysis-v1', missingDomains: [], caveats: [], evidenceRefs: [ref('ev-1')],
  sourceHealth: [], createdAt: '2026-10-06T00:00:00.000Z', policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
  change: { sequence: 1, previousSnapshotHash: null, facts: [], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: [] },
  ...overrides
})

describe('snapshot change', () => {
  it('marks the first snapshot of an event group as sequence one with no movement', () => {
    const change = computeSnapshotChange({ current: { facts: [fact('f1', '3.2')], missingDomains: [], caveats: [], evidenceRefs: [ref('ev-1')] } })
    expect(change.sequence).toBe(snapshotChangePolicy.emptySequence)
    expect(change.previousSnapshotHash).toBeNull()
    expect(change.facts).toEqual([])
    expect(isUnchangedSnapshot(change)).toBe(true)
  })

  it('reports added, changed and removed facts with both values', () => {
    const previous = snapshot({ facts: [fact('f1', '3.2'), fact('f2', '0.1', 'previous')], snapshotHash: 'hash-1' })
    const change = computeSnapshotChange({
      current: { facts: [fact('f1', '3.4'), fact('f3', '+29K', 'actual')], missingDomains: [], caveats: [], evidenceRefs: [ref('ev-1')] },
      previous
    })

    expect(change.sequence).toBe(2)
    expect(change.previousSnapshotHash).toBe('hash-1')
    // The change also carries the display fields, so a reader can describe it
    // instead of showing a fact id.
    const display = { subject: 'CPI', unit: '%', sourceLabel: '官方' }
    expect(change.facts).toEqual([
      { factId: 'f1', domain: 'macro', ...display, metric: 'actual', kind: 'changed', previousValue: '3.2', value: '3.4' },
      { factId: 'f2', domain: 'macro', ...display, metric: 'previous', kind: 'removed', previousValue: '0.1' },
      { factId: 'f3', domain: 'macro', ...display, metric: 'actual', kind: 'added', value: '+29K' }
    ])
    expect(isUnchangedSnapshot(change)).toBe(false)
  })

  it('reports missing domains, caveats and evidence additions and removals', () => {
    const previous = snapshot({ facts: [], missingDomains: ['cross-asset'], caveats: ['stale'], evidenceRefs: [ref('ev-1'), ref('ev-2')] })
    const change = computeSnapshotChange({
      current: { facts: [], missingDomains: ['funding'], caveats: ['consensus-unavailable'], evidenceRefs: [ref('ev-1'), ref('ev-3')] },
      previous
    })

    expect(change.missingDomainsAdded).toEqual(['funding'])
    expect(change.missingDomainsRemoved).toEqual(['cross-asset'])
    expect(change.caveatsAdded).toEqual(['consensus-unavailable'])
    expect(change.caveatsRemoved).toEqual(['stale'])
    expect(change.evidenceRefsAdded).toEqual(['ev-3'])
    expect(change.evidenceRefsRemoved).toEqual(['ev-2'])
  })

  it('treats an identical refresh as no movement so no new conclusion is implied', () => {
    const previous = snapshot({ facts: [fact('f1', '3.2')], missingDomains: ['funding'], caveats: ['stale'] })
    const change = computeSnapshotChange({
      current: { facts: [fact('f1', '3.2')], missingDomains: ['funding'], caveats: ['stale'], evidenceRefs: [ref('ev-1')] },
      previous
    })
    expect(change.sequence).toBe(2)
    expect(isUnchangedSnapshot(change)).toBe(true)
  })

  it('bounds the stored fact diff', () => {
    const previous = snapshot({ facts: [] })
    const facts = Array.from({ length: snapshotChangePolicy.maximumFactChanges + 25 }, (_, index) => fact(`f${String(index).padStart(4, '0')}`, '1'))
    const change = computeSnapshotChange({ current: { facts, missingDomains: [], caveats: [], evidenceRefs: [ref('ev-1')] }, previous })
    expect(change.facts).toHaveLength(snapshotChangePolicy.maximumFactChanges)
  })
})
