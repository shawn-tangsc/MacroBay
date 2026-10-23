import { expect, it, vi } from 'vitest'
import { macroRouteQueryPolicy, normalizeMacroRouteMonths, queryMacroRoute } from './macroRouteQuery'

const asOf = '2026-10-09T12:00:00.000Z'

function officialEvent(eventKey: string, detectedAt = '2026-10-09T06:00:00.000Z') {
  return {
    eventKey, releaseGroupKey: 'US.BLS.RELEASE.1', eventFamily: 'consumer-price-index', titleKey: 'cpi', countryCode: 'US' as const,
    importance: 'high' as const, periodKey: 'release-2026-10-13', lifecycleState: 'scheduled' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-13', detectedAt
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
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string }) => month === '2026-10'
    ? { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M09')] }
    : { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M08')] })
  const queryMarketCalendarMonth = vi.fn(() => ({ state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf, events: [], sources: [], nextCursor: null }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth, queryMarketCalendarMonth }, { asOf, months: ['2026-10', '2026-09'] })
  expect(route.official.map(event => event.eventKey)).toEqual(['US.CPI.RELEASE.2026-M09', 'US.CPI.RELEASE.2026-M08'])
  expect(route.months).toEqual(['2026-10', '2026-09'])
  expect(route.asOf).toBe(asOf)
  expect(queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(2)
})

it('keeps a partially readable range comparable instead of throwing', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string }) => {
    if (month === '2026-09') throw new Error('query-unavailable')
    return { state: 'available' as const, month, asOf, events: [officialEvent('US.CPI.RELEASE.2026-M09')] }
  })
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10', '2026-09'] })
  expect(route.official).toHaveLength(1)
  expect(route.months).toEqual(['2026-10', '2026-09'])
})

it('reports an unavailable month as an empty route rather than as an error', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async () => ({ state: 'unavailable' as const, reason: 'no-query' }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth: queryMacroEconomicCalendarMonth as never }, { asOf, months: ['2026-10'] })
  expect(route.official).toEqual([])
})

it('never reads more months than the policy allows', async () => {
  const queryMacroEconomicCalendarMonth = vi.fn(async ({ month }: { month: string }) => ({ state: 'available' as const, month, asOf, events: [officialEvent(`event-${month}`)] }))
  const route = await queryMacroRoute({ queryMacroEconomicCalendarMonth }, { asOf, months: ['2026-10', '2026-09', '2026-08'] })
  expect(queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(2)
  expect(route.official).toHaveLength(2)
})

it('works when only one of the two routes is wired', async () => {
  const route = await queryMacroRoute({}, { asOf, months: ['2026-10'] })
  expect(route).toEqual({ official: [], provider: [], months: ['2026-10'], asOf })
})
