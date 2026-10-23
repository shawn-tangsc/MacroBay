import { expect, it } from 'vitest'
import type { AgentFact, MarketAnalysisDomainObservation } from '../../../contracts/marketAnalysisContracts'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { fact, projectMacroCalendar } from './marketAnalysisContextProjection'

const asOf = '2026-10-09T12:00:00.000Z'

/** A provider-shaped observation: no `publishedAt`, so its observation time is the batch time. */
function observation(detectedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'market-observation-us-cpi-2026-m09', releaseGroupKey: 'router-us-cpi', eventFamily: 'consumer-price-index',
    titleKey: 'cpi', countryCode: 'US', importance: 'high' as const, periodKey: '2026-09', lifecycleState: 'released' as const,
    coverage: 'available' as const, scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z',
    detectedAt, providerIds: ['0xrouter-calendar'], caveats: [] as readonly string[], actual: { displayValue: '3.2%' },
    ...overrides
  }
}

function project(detectedAt: string): readonly AgentFact[] {
  const facts: AgentFact[] = []
  const evidenceRefs = new Map()
  const caveats = new Set<string>()
  const observations: Partial<Record<string, MarketAnalysisDomainObservation>> = {}
  projectMacroCalendar({ official: { state: 'available', asOf, events: [observation(detectedAt)] } as unknown as MacroEconomicCalendarMonthResult, provider: undefined },
    asOf, facts, evidenceRefs as never, caveats, observations as never)
  return facts
}

it('keeps a macro fact id stable when only the collection instant changed', () => {
  const first = project('2026-10-09T06:00:00.000Z')
  const second = project('2026-10-09T11:30:00.000Z')
  expect(first.length).toBeGreaterThan(0)
  expect(second.map(value => value.factId)).toEqual(first.map(value => value.factId))
  // The collection instant is still carried for display and as-of filtering.
  expect(first[0]!.observedAt).toBe('2026-10-09T06:00:00.000Z')
  expect(second[0]!.observedAt).toBe('2026-10-09T11:30:00.000Z')
})

it('reports a changed value as a change of the same fact, not as a new fact', () => {
  const before = project('2026-10-09T06:00:00.000Z')
  const after = project('2026-10-09T11:30:00.000Z').map(value => value.metric === 'actual' ? { ...value, value: '3.3%' } : value)
  const actualBefore = before.find(value => value.metric === 'actual')!
  const actualAfter = after.find(value => value.metric === 'actual')!
  expect(actualAfter.factId).toBe(actualBefore.factId)
  expect(actualAfter.value).toBe('3.3%')
  expect(actualBefore.value).toBe('3.2%')
})

it('still lets the collection instant discriminate facts that have no stable identity', () => {
  const points = ['2026-10-09T00:00:00.000Z', '2026-10-09T08:00:00.000Z'].map(observedAt =>
    fact('funding', 'BTCUSDT', 'funding-rate', '0.01', 'percent', 'binance-funding', observedAt, asOf, 'comparable', 'point-0'))
  expect(points[0]!.factId).not.toBe(points[1]!.factId)
})

it('falls back to the instant when a caller opts in without an identity suffix', () => {
  const first = fact('macro', 'consumer-price-index', 'actual', '3.2%', null, 'src', '2026-10-09T06:00:00.000Z', asOf, 'comparable', '', { identityFromEventOnly: true })
  const second = fact('macro', 'consumer-price-index', 'actual', '3.2%', null, 'src', '2026-10-09T11:30:00.000Z', asOf, 'comparable', '', { identityFromEventOnly: true })
  expect(second.factId).not.toBe(first.factId)
})
