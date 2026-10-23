import { expect, it } from 'vitest'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { analysisImpactDisclosurePolicy, applyReservedFacts, isFactForTriggeredEvent } from './analysisImpactDisclosurePolicy'

function factAt(index: number, eventKey: string | null, domain: AgentFact['domain'] = 'macro'): AgentFact {
  return {
    factId: `mi-fact-${domain}-${index}`, domain, subject: 'consumer-price-index', metric: `metric-${index}`, value: String(index),
    unit: null, sourceId: 'src', sourceLabel: 'src', observedAt: null, asOf: '2026-10-09T12:00:00.000Z', freshness: 'fresh',
    confidence: 1, comparability: 'comparable', evidenceRefId: eventKey ? `macro-calendar:0xrouter-calendar:${eventKey}` : null
  }
}

it('states its version and the reserve it will spend', () => {
  expect(analysisImpactDisclosurePolicy.version).toBe('marketAnalysisImpactDisclosurePolicy.v1')
  expect(analysisImpactDisclosurePolicy.reservedFactsForTriggeredEvents).toBe(24)
  expect(analysisImpactDisclosurePolicy.includeConsensusMetric).toBe(true)
  expect(Object.isFrozen(analysisImpactDisclosurePolicy)).toBe(true)
})

it('recognises a fact only through the event its evidence names', () => {
  const keys = new Set(['US.CPI.RELEASE.2026-M09'])
  expect(isFactForTriggeredEvent(factAt(0, 'US.CPI.RELEASE.2026-M09'), keys)).toBe(true)
  expect(isFactForTriggeredEvent(factAt(1, 'US.PPI.RELEASE.2026-M09'), keys)).toBe(false)
  expect(isFactForTriggeredEvent(factAt(2, null), keys)).toBe(false)
  expect(isFactForTriggeredEvent(factAt(0, 'US.CPI.RELEASE.2026-M09'), new Set())).toBe(false)
})

it('changes nothing at all when no change triggered the run', () => {
  const facts = Array.from({ length: 40 }, (_, index) => factAt(index, null))
  expect(applyReservedFacts(facts, new Set(), 10)).toEqual(facts.slice(0, 10))
})

it('changes nothing when the budget already fits everything', () => {
  const facts = [factAt(0, 'US.CPI.RELEASE.2026-M09'), factAt(1, null)]
  expect(applyReservedFacts(facts, new Set(['US.CPI.RELEASE.2026-M09']), 10)).toEqual(facts)
})

it('keeps the triggering facts that would otherwise be truncated away', () => {
  // 30 unrelated facts come first in the existing order, the triggering one last.
  const facts = [...Array.from({ length: 30 }, (_, index) => factAt(index, null)), factAt(99, 'US.CPI.RELEASE.2026-M09')]
  const kept = applyReservedFacts(facts, new Set(['US.CPI.RELEASE.2026-M09']), 10)
  expect(kept).toHaveLength(10)
  expect(kept.map(fact => fact.factId)).toContain('mi-fact-macro-99')
  // The reserve reorders within the budget: nine of the others still fit.
  expect(kept.filter(fact => fact.factId !== 'mi-fact-macro-99')).toHaveLength(9)
})

it('keeps every domain represented, so one domain\'s volume cannot remove another\'s only evidence', () => {
  // The reported defect: adding ten cross-asset facts to a 160-fact budget pushed funding (5) and
  // sentiment (1) out of the context entirely, and the conclusion then said it lacked the leverage
  // and sentiment evidence it had been told to weigh.
  const many = Array.from({ length: 200 }, (_, index) => factAt(index, null, 'cross-asset'))
  const few = [factAt(1, null, 'funding'), factAt(2, null, 'funding'), factAt(3, null, 'sentiment')]

  const kept = applyReservedFacts([...many, ...few], new Set(), 50, undefined, 3)

  expect(kept).toHaveLength(50)
  expect(kept.filter(fact => fact.domain === 'funding')).toHaveLength(2)
  expect(kept.filter(fact => fact.domain === 'sentiment')).toHaveLength(1)
  expect(kept.filter(fact => fact.domain === 'cross-asset')).toHaveLength(47)
  // Without the floor the tail domains are simply gone — which is what the floor exists to stop.
  expect(applyReservedFacts([...many, ...few], new Set(), 50).filter(fact => fact.domain !== 'cross-asset')).toHaveLength(0)
})

it('never spends more of the budget on the reserve than the policy allows', () => {
  const triggering = Array.from({ length: 50 }, (_, index) => factAt(index, 'US.CPI.RELEASE.2026-M09'))
  const others = Array.from({ length: 50 }, (_, index) => factAt(100 + index, null))
  const kept = applyReservedFacts([...triggering, ...others], new Set(['US.CPI.RELEASE.2026-M09']), 60)
  expect(kept).toHaveLength(60)
  expect(kept.filter(fact => fact.evidenceRefId?.endsWith('US.CPI.RELEASE.2026-M09'))).toHaveLength(analysisImpactDisclosurePolicy.reservedFactsForTriggeredEvents)
  expect(kept.filter(fact => !fact.evidenceRefId?.endsWith('US.CPI.RELEASE.2026-M09'))).toHaveLength(60 - analysisImpactDisclosurePolicy.reservedFactsForTriggeredEvents)
})

it('cannot exceed a budget smaller than the reserve', () => {
  const facts = [factAt(0, 'US.CPI.RELEASE.2026-M09'), factAt(1, null), factAt(2, null)]
  expect(applyReservedFacts(facts, new Set(['US.CPI.RELEASE.2026-M09']), 2)).toHaveLength(2)
  expect(applyReservedFacts(facts, new Set(['US.CPI.RELEASE.2026-M09']), 0)).toEqual([])
})
