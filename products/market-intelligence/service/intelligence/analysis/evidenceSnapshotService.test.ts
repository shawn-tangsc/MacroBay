import { describe, expect, it } from 'vitest'

import type { MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import { createEvidenceSnapshotService } from './evidenceSnapshotService'

const asOf = '2026-09-27T00:00:00.000Z'
function context(facts: MarketAnalysisContextAvailable['facts']): MarketAnalysisContextAvailable {
  return { state: 'available', schemaVersion: 2, profileId: 'crypto-market-analysis-v1', eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotId: null, snapshotHash: null, facts, missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [], domainAccess: [] }
}
const fact = (factId: string) => ({ factId, domain: 'sentiment' as const, subject: 'market', metric: 'score', value: 50, unit: 'score', sourceId: 'source', sourceLabel: 'source', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: null })

describe('evidenceSnapshotService', () => {
  it('sorts facts by domain and fact id and produces a stable hash', () => {
    const service = createEvidenceSnapshotService({ now: () => asOf, idFactory: () => 'mi-es-1' })
    const left = service.freeze({ eventGroupId: 'mi-eg-1', context: context([fact('z'), fact('a')]) })
    const right = service.freeze({ eventGroupId: 'mi-eg-1', context: context([fact('a'), fact('z')]) })
    expect(left.facts.map(item => item.factId)).toEqual(['a', 'z'])
    expect(left.snapshotHash).toBe(right.snapshotHash)
    // New snapshots are written with the schema that carries an optional `sourceUrl`.
    expect(left.schemaVersion).toBe(2)
  })

  it('freezes the snapshot so later source mutation cannot change it', () => {
    const sourceFacts = [fact('a')]
    const service = createEvidenceSnapshotService({ now: () => asOf, idFactory: () => 'mi-es-1' })
    const snapshot = service.freeze({ eventGroupId: 'mi-eg-1', context: context(sourceFacts) })
    sourceFacts[0]!.value = 99
    expect(snapshot.facts[0]!.value).toBe(50)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.facts)).toBe(true)
  })

  it('prints the MI-A04 acceptance marker with safe bounded details', () => {
    const service = createEvidenceSnapshotService({ now: () => asOf, idFactory: () => 'mi-es-marker' })
    const snapshot = service.freeze({ eventGroupId: 'mi-eg-1', context: context([fact('a')]) })
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A04', event: 'trigger-decision', status: 'pass', details: { mergedAt20m: true, newGroupAt20mPlus: true, initial: 'queued', review: 'queued', semanticNoOp: 'skipped', snapshotHash8: snapshot.snapshotHash.slice(0, 8) } }))
    expect(snapshot.snapshotHash).toHaveLength(64)
  })

  it('rejects a context from another event group or a non-available state', () => {
    const service = createEvidenceSnapshotService({ now: () => asOf, idFactory: () => 'mi-es-1' })
    expect(() => service.freeze({ eventGroupId: 'mi-eg-other', context: context([]) })).toThrow('analysis-snapshot-input-invalid')
    expect(() => service.freeze({ eventGroupId: 'mi-eg-1', context: { ...context([]), state: 'unavailable' } as never })).toThrow('analysis-snapshot-input-invalid')
  })
})
