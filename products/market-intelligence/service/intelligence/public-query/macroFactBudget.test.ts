import { describe, expect, it } from 'vitest'

import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { applyMacroFactCap } from './macroFactBudget'

function fact(index: number, sourceId = 'macro-calendar-bls-values', domain: AgentFact['domain'] = 'macro'): AgentFact {
  return {
    factId: `fact-${sourceId}-${index}`, domain, subject: 'cpi', metric: 'actual', value: index, unit: '%',
    sourceId, sourceLabel: sourceId, observedAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    asOf: '2026-09-30T00:00:00.000Z', freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: null
  }
}

describe('macro fact budget', () => {
  it('leaves a month under the ceiling untouched', () => {
    const facts = [fact(1), fact(2)]
    const result = applyMacroFactCap(facts, 90)
    expect(result.truncated).toBe(false)
    expect(result.facts).toEqual(facts)
  })

  it('keeps every policy fact even when a busy month is newer', () => {
    const policy = Array.from({ length: 7 }, (_, index) => fact(index, 'policy-path-market'))
    const month = Array.from({ length: 95 }, (_, index) => fact(index + 10))
    const result = applyMacroFactCap([...month, ...policy], 90)

    expect(result.truncated).toBe(true)
    expect(result.facts.filter(item => item.domain === 'macro')).toHaveLength(90)
    expect(result.facts.filter(item => item.sourceId === 'policy-path-market')).toHaveLength(7)
  })

  it('keeps non-macro facts while it trims the macro share', () => {
    const month = Array.from({ length: 95 }, (_, index) => fact(index))
    const capital = fact(1, 'defillama-stablecoins', 'capital')
    const result = applyMacroFactCap([...month, capital], 90)

    expect(result.facts).toContain(capital)
  })
})
