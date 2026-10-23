import { expect, it, vi } from 'vitest'
import { createAnalysisSignificanceGate } from './analysisSignificanceGate'
import type { MacroRoute } from '../public-query/macroRouteQuery'

const asOf = '2026-10-09T12:00:00.000Z'
const previousAsOf = '2026-10-09T00:00:00.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M09', releaseGroupKey: 'g', eventFamily: 'consumer-price-index', titleKey: 'cpi',
    countryCode: 'US', importance: 'high' as const, periodKey: 'p', lifecycleState: 'released' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-13', detectedAt: '2026-10-09T06:00:00.000Z', providerIds: ['us-bls-official-calendar'],
    caveats: [], actual: { displayValue: '3.2%' }, ...overrides
  }
}

function route(official: readonly unknown[]): MacroRoute {
  return { official, provider: [], months: ['2026-10', '2026-09'], asOf } as unknown as MacroRoute
}

function snapshot(value: string) {
  return {
    asOf: previousAsOf,
    facts: [{
      factId: 'mi-fact-macro-consumer-price-index-actual', domain: 'macro' as const, subject: 'consumer-price-index', metric: 'actual',
      value, unit: null, sourceId: 'src', sourceLabel: 'src', observedAt: previousAsOf, asOf: previousAsOf, freshness: 'fresh' as const,
      confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'macro-calendar:us-bls-official-calendar:US.CPI.RELEASE.2026-M09'
    }]
  }
}

function gate(overrides: Record<string, unknown> = {}, routeOfficial: readonly unknown[] = [event()]) {
  const recordDecision = vi.fn()
  const queryMacroRoute = vi.fn(async () => route(routeOfficial))
  const instance = createAnalysisSignificanceGate({
    now: () => asOf, queryMacroRoute, recordDecision,
    countRuns: () => ({ hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0 }),
    lastAutoRunAt: () => null, ...overrides
  } as never)
  return { instance, recordDecision, queryMacroRoute }
}

it('decides and records a real change, and names the events that triggered it', async () => {
  const { instance, recordDecision } = gate()
  const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: snapshot('3.1%') })
  expect(outcome).toMatchObject({ decision: 'queued', reasonCode: 'significance-confirmed' })
  expect([...outcome.triggeredEventKeys]).toEqual(['US.CPI.RELEASE.2026-M09'])
  expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ decision: 'queued', reasonCode: 'significance-confirmed', triggerKey: 'calendar.refresh' }))
})

it('records a skip for a same-value refresh and builds no context', async () => {
  const { instance, recordDecision } = gate()
  const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: snapshot('3.2%') })
  expect(outcome).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', triggeredEventKeys: new Set() })
  expect(recordDecision).toHaveBeenCalledTimes(1)
})

it('lets the item and manual keys through untouched, recording nothing', async () => {
  for (const triggerKey of ['macro.actual.first-confirmed', 'market-reaction.15m', 'manual.refresh', 'unknown.key']) {
    const { instance, recordDecision, queryMacroRoute } = gate()
    const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey, asOf, previousSnapshot: snapshot('3.1%') })
    expect(outcome).toMatchObject({ decision: 'queued', reasonCode: null, route: null })
    expect(recordDecision).not.toHaveBeenCalled()
    // A key it does not judge costs nothing at all, not even a route read.
    expect(queryMacroRoute).not.toHaveBeenCalled()
  }
})

it('reports the limits instead of the data when the budget is spent', async () => {
  const { instance } = gate({ countRuns: () => ({ hourRuns: 3, dayRuns: 3, eventRunsToday: 3, scheduledRunsToday: 0 }) })
  expect(await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: snapshot('3.1%') }))
    .toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
})

it('runs a session slot even when nothing moved', async () => {
  const { instance } = gate()
  expect(await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'schedule.asia.open', asOf, previousSnapshot: snapshot('3.2%') }))
    .toMatchObject({ decision: 'queued', reasonCode: 'session-slot-asia', route: expect.anything() })
})

it('compares across the previous snapshot month so a rollover is not a false change', async () => {
  const { instance, queryMacroRoute } = gate({}, [event({ eventKey: 'US.CPI.RELEASE.2026-M09', detectedAt: '2026-10-09T06:00:00.000Z' })])
  await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: { asOf: '2026-09-30T23:55:00.000Z', facts: [] } })
  expect(queryMacroRoute).toHaveBeenCalledWith({ asOf, months: ['2026-10', '2026-09'] })
})

it('decides without a predecessor instead of claiming everything is new', async () => {
  const { instance } = gate()
  const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: null })
  expect(outcome).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', usedPreviousAsOf: null })
})

/**
 * provider 发布的意外（设计 145 §8 A）：账本上的原因码是它自己那一个，而不是笼统的"数据变化显著"。
 * 读者问"这次为什么分析了"时，答案必须是那条发布。
 */
it('records a provider surprise under its own reason code, and names the release', async () => {
  const release = {
    eventKey: 'market-observation-1', releaseGroupKey: 'market-observation-1', eventFamily: 'economic-indicator',
    titleKey: '9月核心生产者物价指数(年率)', countryCode: 'US', importance: 'high', periodKey: '2026-M09',
    lifecycleState: 'released', coverage: 'partial', scheduledDate: '2026-10-09', scheduledAt: '2026-10-09T11:30:00.000Z',
    releaseTimeSource: 'date-only', detectedAt: '2026-10-09T11:35:00.000Z', actual: { displayValue: '5.0%' },
    consensus: { displayValue: '4.4%' }, consensusState: 'available', surprise: 'beat',
    providerIds: ['macro-calendar-0xrouter-economic-data'], caveats: ['observed-unverified', 'provider-title-is-display-name']
  }
  const providerRoute = { official: [], provider: [release], months: ['2026-10'], asOf } as unknown as MacroRoute
  const recordDecision = vi.fn()
  const instance = createAnalysisSignificanceGate({
    now: () => asOf, queryMacroRoute: vi.fn(async () => providerRoute), recordDecision,
    countRuns: () => ({ hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0 }),
    lastAutoRunAt: () => null
  } as never)
  const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: null })
  expect(outcome).toMatchObject({ decision: 'queued', reasonCode: 'provider-surprise-confirmed' })
  expect([...outcome.triggeredEventKeys]).toEqual(['market-observation-1'])
  expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
    eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', decision: 'queued', reasonCode: 'provider-surprise-confirmed'
  }))
})

/** 同一条发布的例行版本（没偏离预期）连信号都不该产生：它的"变化"不能单独触发一次分析。 */
it('stays quiet for a routine provider release even though its actual is new to us', async () => {
  const routine = {
    eventKey: 'market-observation-2', releaseGroupKey: 'market-observation-2', eventFamily: 'economic-indicator',
    titleKey: '9月零售销售(月率)', countryCode: 'US', importance: 'high', periodKey: '2026-M09',
    lifecycleState: 'released', coverage: 'partial', scheduledDate: '2026-10-09', scheduledAt: '2026-10-09T11:30:00.000Z',
    releaseTimeSource: 'date-only', detectedAt: '2026-10-09T11:35:00.000Z', actual: { displayValue: '0.8%' },
    consensus: { displayValue: '0.7%' }, consensusState: 'available', surprise: 'beat',
    providerIds: ['macro-calendar-0xrouter-economic-data'], caveats: ['observed-unverified', 'provider-title-is-display-name']
  }
  const providerRoute = { official: [], provider: [routine], months: ['2026-10'], asOf } as unknown as MacroRoute
  const recordDecision = vi.fn()
  const instance = createAnalysisSignificanceGate({
    now: () => asOf, queryMacroRoute: vi.fn(async () => providerRoute), recordDecision,
    countRuns: () => ({ hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0 }),
    lastAutoRunAt: () => null
  } as never)
  const outcome = await instance.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot: null })
  expect(outcome).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', triggeredEventKeys: new Set() })
  expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ decision: 'skipped', reasonCode: 'significance-below-threshold' }))
})
