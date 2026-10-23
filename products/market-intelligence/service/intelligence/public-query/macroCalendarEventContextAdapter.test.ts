import { expect, it, vi } from 'vitest'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { macroCalendarEventContextFromReads } from './macroCalendarEventContextAdapter'

const query = { eventKey: 'US.CPI', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z' }
const factOf = (overrides: Partial<AgentFact> = {}): AgentFact => ({
  factId: 'market-observation-1', domain: 'macro', subject: 'US.CPI', metric: 'actual', value: '0.3%',
  unit: null, sourceId: 'US.CPI', observedAt: '2026-10-11T06:00:00.000Z', asOf: query.asOf, comparability: 'comparable', ...overrides
} as AgentFact)

const reads = (facts: readonly AgentFact[], refs: readonly string[] = []) => ({
  readFacts: vi.fn(async () => facts),
  readEvidenceRefs: vi.fn(async () => refs),
  isVisible: (visibleAt: string | undefined, asOf: string) => visibleAt === undefined || Date.parse(visibleAt) <= Date.parse(asOf)
})

it('keeps only the selected event, and only what was visible at that instant', async () => {
  const other = factOf({ factId: 'market-observation-2', subject: 'US.NFP', sourceId: 'US.NFP' })
  const later = factOf({ factId: 'market-observation-3', observedAt: '2026-10-12T00:00:00.000Z' })
  const result = await macroCalendarEventContextFromReads(reads([factOf(), other, later, factOf({ metric: 'consensus', value: '0.2%' }), factOf({ metric: 'previous', value: '0.1%' })]), query)
  expect(result.facts.map(fact => fact.metric)).toEqual(['actual', 'consensus', 'previous'])
  expect(result.coverage).toBe('available')
})

it('reports partial when the event has facts but no published value', async () => {
  const result = await macroCalendarEventContextFromReads(reads([factOf({ metric: 'consensus' }), factOf({ metric: 'previous' }), factOf({ metric: 'importance' })]), query)
  expect(result.coverage).toBe('partial')
  expect(result.caveats).toContain('event-values-missing')
})

it('reports unavailable when the event has nothing at all', async () => {
  const result = await macroCalendarEventContextFromReads(reads([factOf({ subject: 'US.NFP', sourceId: 'US.NFP' })]), query)
  expect(result).toMatchObject({ coverage: 'unavailable', caveats: ['no-facts-held'], facts: [] })
})

it('keeps only the evidence refs that belong to the selected event', async () => {
  // The product's own ref shape: `macro-calendar:<sourceId>:<eventKey>`.
  const result = await macroCalendarEventContextFromReads(reads([factOf()], ['macro-calendar:official:US.CPI', 'macro-calendar:official:US.NFP']), query)
  expect(result.evidenceRefs).toEqual(['macro-calendar:official:US.CPI'])
})
