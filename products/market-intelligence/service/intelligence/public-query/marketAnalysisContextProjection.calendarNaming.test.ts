import { expect, it } from 'vitest'
import type { AgentFact, MarketAnalysisDomainObservation } from '../../../contracts/marketAnalysisContracts'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { fact, projectMacroCalendar } from './marketAnalysisContextProjection'

/**
 * 日历事实的"叫什么"（设计 141）。
 *
 * 0xRouter 观测的 `eventFamily` 是**事件类型**（`economic-indicator` 等），所以它的 7 条 fact 主体全是类型；
 * 渲染层对"主体只是类型"的行做止损（说不清就不渲染），于是 provider 的发布在「本次变化」里整类消失。
 * 事实自己的名字（`subjectLabel`）由投影给出：**观测自己的标题**；若标题其实是个注册过的 key，用注册名。
 * 官方事件的 subject 是事件族，本来就说得清，保持不带标签。
 */
const asOf = '2026-10-15T12:00:00.000Z'

/** 一条 0xRouter 观测：族 = 类型，标题 = 提供方给的读者语言。 */
function providerObservation(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'market-observation-us-retail-sales-2026-m09', releaseGroupKey: 'router-us-retail-sales',
    eventFamily: 'economic-indicator', titleKey: '9月零售销售(月率)', countryCode: 'US', importance: 'high' as const,
    periodKey: '2026-09', lifecycleState: 'released' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-15', scheduledAt: '2026-10-15T12:30:00.000Z', detectedAt: '2026-10-15T11:31:00.000Z',
    providerIds: ['macro-calendar-0xrouter-economic-data'], caveats: [] as readonly string[], actual: { displayValue: '0.8%' },
    ...overrides
  }
}

function project(events: readonly Record<string, unknown>[]): readonly AgentFact[] {
  const facts: AgentFact[] = []
  const evidenceRefs = new Map()
  const caveats = new Set<string>()
  const observations: Partial<Record<string, MarketAnalysisDomainObservation>> = {}
  projectMacroCalendar(
    { official: { state: 'available', asOf, events } as unknown as MacroEconomicCalendarMonthResult, provider: undefined },
    asOf, facts, evidenceRefs as never, caveats, observations as never)
  return facts
}

it('names every fact of a provider observation with the observation\'s own title', () => {
  const facts = project([providerObservation()])
  expect(facts.length).toBeGreaterThan(0)
  // The subject stays the kind — identity, the significance matcher and the diff all read it.
  expect(facts.every(value => value.subject === 'economic-indicator')).toBe(true)
  expect(facts.every(value => value.subjectLabel === '9月零售销售(月率)')).toBe(true)
})

it('leaves an official event alone: its subject is the family, which already names it', () => {
  const official = providerObservation({ eventFamily: 'consumer-price-index', titleKey: 'cpi', providerIds: ['macro-calendar-bls'] })
  expect(project([official]).every(value => value.subjectLabel === undefined)).toBe(true)
})

it('does not invent a name when the observation has none', () => {
  expect(project([providerObservation({ titleKey: '' })]).every(value => value.subjectLabel === undefined)).toBe(true)
  expect(project([providerObservation({ titleKey: '   ' })]).every(value => value.subjectLabel === undefined)).toBe(true)
})

it('uses the registered name when the title is a key rather than a name', () => {
  // A kind subject carrying a key is not today's provider route, but printing `cpi` as a name would be
  // showing an identifier to the reader — the vocabulary already knows what that key is called.
  const keyShaped = providerObservation({ titleKey: 'cpi' })
  expect(project([keyShaped]).every(value => value.subjectLabel === '消费者物价指数（CPI）')).toBe(true)
})

it('keeps the label out of a fact\'s identity', () => {
  const bare = fact('macro', 'economic-indicator', 'lifecycle-state', 'released', null, 'src', asOf, asOf, 'comparable', 'suffix')
  const named = fact('macro', 'economic-indicator', 'lifecycle-state', 'released', null, 'src', asOf, asOf, 'comparable', 'suffix', { subjectLabel: '9月零售销售(月率)' })
  expect(named.factId).toBe(bare.factId)
  expect(named.subjectLabel).toBe('9月零售销售(月率)')
  expect(bare.subjectLabel).toBeUndefined()
})
