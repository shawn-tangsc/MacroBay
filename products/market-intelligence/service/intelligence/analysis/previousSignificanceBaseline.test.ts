import { expect, it } from 'vitest'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { projectPreviousBaseline } from './previousSignificanceBaseline'

const asOf = '2026-10-09T00:00:00.000Z'

function fact(overrides: Partial<AgentFact> = {}): AgentFact {
  return {
    factId: 'mi-fact-macro-consumer-price-index-actual', domain: 'macro', subject: 'consumer-price-index', metric: 'actual',
    value: '3.1%', unit: null, sourceId: 'us-bls-official-calendar', sourceLabel: 'us-bls-official-calendar', observedAt: asOf, asOf,
    freshness: 'fresh', confidence: 1, comparability: 'comparable',
    evidenceRefId: 'macro-calendar:us-bls-official-calendar:US.CPI.RELEASE.2026-M09', ...overrides
  }
}

it('keys facts by the raw event key so dotted official keys survive', () => {
  const baseline = projectPreviousBaseline({ facts: [fact()], asOf })
  expect(baseline?.values.get('macro|consumer-price-index|actual|US.CPI.RELEASE.2026-M09')).toBe('3.1%')
  expect(baseline?.asOf).toBe(asOf)
})

it('normalises non-string values so comparison stays value-based', () => {
  const baseline = projectPreviousBaseline({ facts: [fact({ value: 3.2 }), fact({ metric: 'previous', value: null, factId: 'f2' })], asOf })
  expect(baseline?.values.get('macro|consumer-price-index|actual|US.CPI.RELEASE.2026-M09')).toBe('3.2')
  expect(baseline?.values.get('macro|consumer-price-index|previous|US.CPI.RELEASE.2026-M09')).toBeNull()
})

it('ignores other domains and facts without a provable event identity', () => {
  const baseline = projectPreviousBaseline({ facts: [
    fact({ domain: 'capital', subject: 'stablecoins' }),
    fact({ evidenceRefId: null }),
    fact({ evidenceRefId: 'unrelated' })
  ], asOf })
  expect(baseline?.values.size).toBe(0)
})

it('reports no baseline at all when there is no predecessor', () => {
  expect(projectPreviousBaseline(undefined)).toBeNull()
  expect(projectPreviousBaseline(null)).toBeNull()
})

it('keeps one entry per fact, later facts winning', () => {
  const baseline = projectPreviousBaseline({ facts: [fact(), fact({ value: '3.4%', factId: 'later' })], asOf })
  expect(baseline?.values.size).toBe(1)
  expect(baseline?.values.get('macro|consumer-price-index|actual|US.CPI.RELEASE.2026-M09')).toBe('3.4%')
})
