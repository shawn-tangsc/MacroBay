import { expect, it } from 'vitest'

import type { AgentFact, MarketAnalysisDomainObservation } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_CONTEXT_CAVEATS, MARKET_ANALYSIS_MACRO_CALENDAR_POLICY } from '../../../contracts/marketAnalysisContracts'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { projectMacroCalendar } from './marketAnalysisContextProjection'

/**
 * 预期差作为派生事实（设计 158 §3.2）。
 *
 * 模型能看到「实际 3.4%」与「预期 3.1%」，但系统提示禁止它自己相减；量必须是一条事实，且与同事件的
 * 其它事实共享证据引用，结论才能引用它并通过 `analysisOutputValidator`。
 */
const asOf = '2026-10-15T12:00:00.000Z'

function observation(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'market-observation-us-cpi-2026-m09', releaseGroupKey: 'router-us-cpi',
    eventFamily: 'economic-indicator', titleKey: '9月消费者物价指数(年率)', countryCode: 'US', importance: 'high' as const,
    periodKey: '2026-M09', lifecycleState: 'released' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-15', scheduledAt: '2026-10-15T12:30:00.000Z', publishedAt: '2026-10-15T12:31:00.000Z',
    detectedAt: '2026-10-15T11:31:00.000Z', providerIds: ['macro-calendar-0xrouter-economic-data'],
    caveats: [] as readonly string[], actual: { displayValue: '3.4%' }, consensus: { displayValue: '3.1%' },
    consensusState: 'available' as const, surprise: 'beat' as const,
    ...overrides
  }
}

function project(events: readonly Record<string, unknown>[]): Readonly<{
  facts: readonly AgentFact[]; caveats: ReadonlySet<string>; evidenceRefs: ReadonlyMap<string, unknown>
}> {
  const facts: AgentFact[] = []
  const evidenceRefs = new Map()
  const caveats = new Set<string>()
  const observations: Partial<Record<string, MarketAnalysisDomainObservation>> = {}
  projectMacroCalendar(
    { official: { state: 'available', asOf, events } as unknown as MacroEconomicCalendarMonthResult, provider: undefined },
    asOf, facts, evidenceRefs as never, caveats, observations as never)
  return { facts, caveats, evidenceRefs }
}

const surpriseFacts = (facts: readonly AgentFact[]) => facts.filter(fact => fact.metric === MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.surprise)

it('emits one percentage-point surprise fact that inherits the event evidence reference', () => {
  const { facts } = project([observation()])
  const surprises = surpriseFacts(facts)

  expect(surprises).toHaveLength(1)
  expect(surprises[0]).toMatchObject({
    domain: 'macro', subject: 'economic-indicator', metric: 'surprise', unit: 'pp',
    observedAt: '2026-10-15T12:31:00.000Z', evidenceRefId: 'macro-calendar:macro-calendar-0xrouter-economic-data:market-observation-us-cpi-2026-m09'
  })
  expect(Number(surprises[0]!.value)).toBeCloseTo(0.3, 10)
  // Every fact of this event shares the evidence reference; the surprise is not a second identity.
  expect(new Set(facts.map(fact => fact.evidenceRefId)).size).toBe(1)
})

it('emits a relative-percent surprise for a bare-number expectation', () => {
  const { facts, caveats } = project([observation({ actual: { displayValue: '165' }, consensus: { displayValue: '150' } })])
  const [surprise] = surpriseFacts(facts)

  expect(surprise).toMatchObject({ unit: 'relative-percent' })
  expect(Number(surprise!.value)).toBeCloseTo(10, 10)
  expect(caveats.has(MARKET_ANALYSIS_CONTEXT_CAVEATS.providerSurpriseNotComparable)).toBe(false)
})

it('does not invent a surprise when there is no expectation, and names the existing caveat', () => {
  const { facts, caveats } = project([observation({ consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable' })])

  expect(surpriseFacts(facts)).toHaveLength(0)
  expect(caveats.has(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarConsensusUnavailable)).toBe(true)
  expect(facts.every(fact => !JSON.stringify(fact).includes('"surprise"'))).toBe(true)
})

it('emits no magnitude for an incomparable pair or a zero expectation, and names why', () => {
  for (const overrides of [
    { actual: { displayValue: '250K' }, consensus: { displayValue: '240K' } },
    { actual: { displayValue: '3' }, consensus: { displayValue: '0' } }
  ]) {
    const { facts, caveats } = project([observation(overrides)])
    expect(surpriseFacts(facts)).toHaveLength(0)
    expect(caveats.has(MARKET_ANALYSIS_CONTEXT_CAVEATS.providerSurpriseNotComparable)).toBe(true)
  }
})

it('does not call a scheduled event with an expectation incomparable: it has no actual yet', () => {
  const { caveats } = project([observation({ lifecycleState: 'scheduled', actual: undefined, surprise: 'consensus-unavailable' })])
  expect(caveats.has(MARKET_ANALYSIS_CONTEXT_CAVEATS.providerSurpriseNotComparable)).toBe(false)
})

it('adds exactly one surprise fact per released, comparable event, so the macro budget stays bounded', () => {
  const events = Array.from({ length: 20 }, (_, index) => observation({
    eventKey: `market-observation-cpi-${index}`, detectedAt: '2026-10-15T11:31:00.000Z',
    actual: { displayValue: `${3.2 + index / 100}%` }, consensus: { displayValue: '3.1%' }
  }))
  const { facts } = project(events)

  expect(surpriseFacts(facts)).toHaveLength(events.length)
  expect(facts).toHaveLength(events.length * 7)
})
