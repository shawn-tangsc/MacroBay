import { describe, expect, it } from 'vitest'

import {
  buildAnalysisSnapshotHash,
  snapshotHashInput,
  buildAnalysisIdempotencyKey,
  canonicalizeMarketAnalysisJson,
  hashMarketAnalysisJson
} from './analysisHash'

describe('analysisHash', () => {
  it('canonicalizes object keys before hashing', () => {
    const left = { eventGroupId: 'mi-eg-1', snapshotHash: 'abc', analysisPhase: 'initial', triggerKey: 'first' }
    const right = { triggerKey: 'first', analysisPhase: 'initial', snapshotHash: 'abc', eventGroupId: 'mi-eg-1' }

    expect(canonicalizeMarketAnalysisJson(left)).toBe(canonicalizeMarketAnalysisJson(right))
    expect(hashMarketAnalysisJson(left)).toBe(hashMarketAnalysisJson(right))
  })

  it('rejects non-canonical number values before hashing', () => {
    expect(() => canonicalizeMarketAnalysisJson({ value: -0 })).toThrow('analysis-invalid-output-schema')
    expect(() => canonicalizeMarketAnalysisJson({ value: Number.NaN })).toThrow('analysis-invalid-output-schema')
  })

  it('builds the same idempotency key for semantically identical inputs', () => {
    expect(buildAnalysisIdempotencyKey({
      eventGroupId: 'mi-eg-1', snapshotHash: 'snapshot', analysisPhase: 'initial', triggerKey: 'macro-release'
    })).toBe(buildAnalysisIdempotencyKey({
      triggerKey: 'macro-release', analysisPhase: 'initial', snapshotHash: 'snapshot', eventGroupId: 'mi-eg-1'
    }))
  })

  it('hashes an evidence snapshot from its canonical visible contents', () => {
    const common = { profileId: 'crypto-market-analysis-v1', asOf: '2026-09-25T08:30:00.000Z', dataCutoff: '2026-09-25T08:30:00.000Z', missingDomains: ['funding'], caveats: [], evidenceRefs: [{ evidenceRefId: 'ev-2' }, { evidenceRefId: 'ev-1' }] }
    expect(buildAnalysisSnapshotHash({ ...common, facts: [{ factId: 'fact-2' }, { factId: 'fact-1' }] }))
      .toBe(buildAnalysisSnapshotHash({ ...common, facts: [{ factId: 'fact-1' }, { factId: 'fact-2' }] }))
  })

  it('uses domain then fact id when fact identities share an id', () => {
    const common = { profileId: 'crypto-market-analysis-v1', asOf: '2026-09-25T08:30:00.000Z', dataCutoff: '2026-09-25T08:30:00.000Z', missingDomains: [], caveats: [], evidenceRefs: [] }
    expect(buildAnalysisSnapshotHash({ ...common, facts: [{ factId: 'same', domain: 'sentiment' }, { factId: 'same', domain: 'macro' }] }))
      .toBe(buildAnalysisSnapshotHash({ ...common, facts: [{ factId: 'same', domain: 'macro' }, { factId: 'same', domain: 'sentiment' }] }))
  })

  it('covers exactly the visible snapshot fields, so the derived change record cannot alter the hash', () => {
    const common = { profileId: 'crypto-market-analysis-v1', asOf: '2026-09-25T08:30:00.000Z', dataCutoff: '2026-09-25T08:30:00.000Z', facts: [{ factId: 'fact-1' }], missingDomains: [], caveats: [], evidenceRefs: [] }
    const change = { sequence: 2, previousSnapshotHash: 'h1', facts: [{ factId: 'fact-1', domain: 'macro', metric: 'actual', kind: 'changed', previousValue: '3.2', value: '3.4' }], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: [] }
    expect(snapshotHashInput({ ...common, change })).toEqual(common)
    expect(buildAnalysisSnapshotHash(snapshotHashInput({ ...common, change }))).toBe(buildAnalysisSnapshotHash(common))
  })

  it('canonicalizes snapshot caveat and missing-domain order', () => {
    const common = { profileId: 'crypto-market-analysis-v1', asOf: '2026-09-25T08:30:00.000Z', dataCutoff: '2026-09-25T08:30:00.000Z', facts: [], evidenceRefs: [] }
    expect(buildAnalysisSnapshotHash({ ...common, missingDomains: ['sentiment', 'macro'], caveats: ['b', 'a'] }))
      .toBe(buildAnalysisSnapshotHash({ ...common, missingDomains: ['macro', 'sentiment'], caveats: ['a', 'b'] }))
  })
})
