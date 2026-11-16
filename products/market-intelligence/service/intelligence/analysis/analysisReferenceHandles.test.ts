import { describe, expect, it } from 'vitest'

import { buildAnalysisReferenceMap, resolveAnalysisReferences } from './analysisReferenceHandles'

const snapshot = {
  facts: [
    { factId: 'mi-fact-capital-BTC-etf-net-flow-usd-2026-08-31T00-00-00-000Z-2026-08-31' },
    { factId: 'mi-fact-capital-BTC-etf-net-flow-usd-2026-09-01T00-00-00-000Z-2026-09-01' }
  ],
  evidenceRefs: [
    { evidenceRefId: 'query:0xrouter:capital:BTC:etf-net-flow-usd:2026-08-31T00:00:00.000Z:98' },
    { evidenceRefId: 'query:0xrouter:capital:BTC:etf-net-flow-usd:2026-09-01T00:00:00.000Z:99' }
  ]
}

describe('analysis reference handles', () => {
  it('derives short handles from the snapshot in a stable order, so the prompt and the validator agree', () => {
    const first = buildAnalysisReferenceMap(snapshot)
    const second = buildAnalysisReferenceMap({ facts: [...snapshot.facts].reverse(), evidenceRefs: [...snapshot.evidenceRefs].reverse() })

    // Sorting makes the handles independent of the order the facts happened to arrive in.
    expect([...first.factHandleById.values()]).toEqual(['f1', 'f2'])
    expect([...second.factHandleById]).toEqual([...first.factHandleById])
    expect(second.evidenceHandleById.get(snapshot.evidenceRefs[1]!.evidenceRefId)).toBe('e2')
    expect(first.factIdByHandle.get('f2')).toBe(snapshot.facts[1]!.factId)
  })

  it('puts the real ids back wherever the model quoted a handle', () => {
    const resolved = resolveAnalysisReferences({
      knownFacts: [{ factId: 'f1', statement: 'x', evidenceRefIds: ['e2'] }],
      transmissionHypotheses: [{ statement: 'x', evidenceRefIds: ['E1'] }],
      marketReaction: [{ statement: 'x', factIds: ['f2'], evidenceRefIds: ['e2'] }],
      supportingEvidence: [{ statement: 'x', evidenceRefId: 'e1' }],
      counterEvidence: [{ statement: 'x', evidenceRefId: 'e1' }],
      nextCatalysts: [{ statement: 'x', evidenceRefIds: ['e1'] }],
      evidenceRefs: ['e1', ' f2 ']
    }, buildAnalysisReferenceMap(snapshot))

    expect(resolved.knownFacts[0]!.factId).toBe(snapshot.facts[0]!.factId)
    expect(resolved.knownFacts[0]!.evidenceRefIds).toEqual([snapshot.evidenceRefs[1]!.evidenceRefId])
    // Trimming and case are tolerated; a fact handle is never read as an evidence handle.
    expect(resolved.transmissionHypotheses[0]!.evidenceRefIds).toEqual([snapshot.evidenceRefs[0]!.evidenceRefId])
    expect(resolved.marketReaction[0]!.factIds).toEqual([snapshot.facts[1]!.factId])
    expect(resolved.supportingEvidence[0]!.evidenceRefId).toBe(snapshot.evidenceRefs[0]!.evidenceRefId)
    expect(resolved.counterEvidence[0]!.evidenceRefId).toBe(snapshot.evidenceRefs[0]!.evidenceRefId)
    expect(resolved.nextCatalysts[0]!.evidenceRefIds).toEqual([snapshot.evidenceRefs[0]!.evidenceRefId])
    // ` f2 ` is not a handle, so it stays as written and the validator reports it.
    expect(resolved.evidenceRefs).toEqual([snapshot.evidenceRefs[0]!.evidenceRefId, ' f2 '])
  })

  it('puts the real ids back inside the news reading, where every check cites a fact handle', () => {
    // 线上那次：三份原始输出都写了 f1/f92/f27/f20/f52，快照里全都有；解析器没改写 newsImpact，
    // 校验就把句柄当成「快照里没有的事实」拒掉，报成 check-fact-not-in-snapshot。
    const resolved = resolveAnalysisReferences({
      conclusion: {
        direction: 'bearish', summary: 'x', change: 'x', causalChain: 'x',
        newsImpact: {
          verdict: 'evaluated', contradiction: true,
          checks: [{ factId: ' f1 ', effect: 'supports' }, { factId: 'f2', effect: 'contradicts' }],
          invalidation: { kind: 'fact', factId: 'F2', relation: 'above', statement: 'x' }
        }
      }
    }, buildAnalysisReferenceMap(snapshot))

    const impact = resolved.conclusion.newsImpact!
    expect(impact.verdict).toBe('evaluated')
    if (impact.verdict !== 'evaluated') throw new Error('expected evaluated')
    expect(impact.checks.map(check => check.factId)).toEqual([snapshot.facts[0]!.factId, snapshot.facts[1]!.factId])
    expect(impact.invalidation).toMatchObject({ kind: 'fact', factId: snapshot.facts[1]!.factId })
    // 其余结论字段原样带过来：解析只换引用，不改句子。
    expect(resolved.conclusion.summary).toBe('x')
  })

  it('also resolves the fact handles a no-transmission check lists', () => {
    const resolved = resolveAnalysisReferences({
      conclusion: { direction: 'range', summary: 'x', change: 'x', causalChain: 'x',
        newsImpact: { verdict: 'no-transmission', checkedFactIds: ['f1', 'f2'], reason: 'x' } }
    }, buildAnalysisReferenceMap(snapshot))
    const impact = resolved.conclusion.newsImpact!
    if (impact.verdict !== 'no-transmission') throw new Error('expected no-transmission')
    expect(impact.checkedFactIds).toEqual([snapshot.facts[0]!.factId, snapshot.facts[1]!.factId])
  })

  it('leaves an id that is already real, and anything unrecognised, exactly as it is', () => {
    const map = buildAnalysisReferenceMap(snapshot)
    // A stored encoding contains upper case, so resolution must not lower-case a real id.
    expect(resolveAnalysisReferences({ knownFacts: [{ factId: snapshot.facts[0]!.factId, evidenceRefIds: ['e1'] }] }, map)
      .knownFacts[0]!.factId).toBe(snapshot.facts[0]!.factId)
    expect(resolveAnalysisReferences({ knownFacts: [{ factId: 'f999', evidenceRefIds: ['e1'] }] }, map)
      .knownFacts[0]!.factId).toBe('f999')
  })

  it('survives a malformed collection instead of throwing inside validation', () => {
    const map = buildAnalysisReferenceMap(snapshot)
    expect(resolveAnalysisReferences({ knownFacts: 'not-an-array', evidenceRefs: [] }, map)).toEqual({ knownFacts: 'not-an-array', evidenceRefs: [] })
  })
})
