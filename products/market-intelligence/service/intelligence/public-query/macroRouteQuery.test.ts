import { expect, it, vi } from 'vitest'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { macroRouteQueryPolicy, normalizeMacroRouteMonths, queryMacroRoute } from './macroRouteQuery'

const asOf = '2026-10-09T12:00:00.000Z'

function officialEvent(eventKey: string, detectedAt = '2026-10-09T06:00:00.000Z'): MacroEconomicCalendarEventView {
  return {
    eventKey, releaseGroupKey: 'US.BLS.RELEASE.1', eventFamily: 'consumer-price-index', titleKey: 'cpi', countryCode: 'US',
    importance: 'high', periodKey: 'release-2026-10-13', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-10-13', releaseTimeSource: 'official', detectedAt, providerIds: [],
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', caveats: []
  }
}

it('states its version and the month bound it will read', () => {
  expect(macroRouteQueryPolicy.version).toBe('marketAnalysisMacroRouteQueryPolicy.v1')
  expect(macroRouteQueryPolicy.maximumMonths).toBe(2)
  expect(Object.isFrozen(macroRouteQueryPolicy)).toBe(true)
})

it('reads the current month and the previous snapshot month, deduplicated', () => {
  expect(normalizeMacroRouteMonths(asOf, '2026-09-30T23:55:00.000Z')).toEqual(['2026-10', '2026-09'])
  expect(normalizeMacroRouteMonths(asOf, '2026-10-01T00:10:00.000Z')).toEqual(['2026-10'])
  expect(normalizeMacroRouteMonths(asOf, null)).toEqual(['2026-10'])
})

it('merges both routes across the requested months', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string; asOf: string }) => month === '2026-10'
    ? { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M09')] }
    : { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M08')] })
  const queryMarketCalendarMonth = vi.fn(() => ({ state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf, events: [], sources: [] }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth, queryMarketCalendarMonth }, { asOf, months: ['2026-10', '2026-09'] })
  expect(route.official.facts.map(event => event.eventKey)).toEqual(['US.CPI.RELEASE.2026-M09', 'US.CPI.RELEASE.2026-M08'])
  expect(route.months).toEqual(['2026-10', '2026-09'])
  expect(route.asOf).toBe(asOf)
  expect(queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(2)
})

it('keeps a partially readable range comparable instead of throwing', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string; asOf: string }) => {
    if (month === '2026-09') throw new Error('query-unavailable')
    return { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M09')] }
  })
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10', '2026-09'] })
  expect(route.official.facts).toHaveLength(1)
  expect(route.official.state).toBe('available')
  expect(route.months).toEqual(['2026-10', '2026-09'])
})

it('reports an unreadable month as unavailable, not as "there were no events"', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' as const }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10'] })
  expect(route.official).toEqual({ state: 'unavailable', reasonCode: 'query-failed', facts: [] })
})

it('distinguishes "read fine, no events" from "could not read"', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month, asOf: at }: { month: string; asOf: string }) => ({ state: 'available' as const, month, asOf: at, events: [] }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10'] })
  expect(route.official).toEqual({ state: 'available', facts: [] })
})

it('never reads more months than the policy allows', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string; asOf: string }) => ({ state: 'available' as const, month, asOf, events: [officialEvent(`event-${month}`)] }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10', '2026-09', '2026-08'] })
  expect(queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(2)
  expect(route.official.facts).toHaveLength(2)
})

it('reports an unwired route as unavailable, not as an empty calendar', async () => {
  const route = await queryMacroRoute({}, { asOf, months: ['2026-10'] })
  expect(route.official).toEqual({ state: 'unavailable', reasonCode: 'not-wired', facts: [] })
  expect(route.provider).toEqual({ state: 'unavailable', reasonCode: 'not-wired', facts: [] })
  expect(route.months).toEqual(['2026-10'])
  expect(route.asOf).toBe(asOf)
})
