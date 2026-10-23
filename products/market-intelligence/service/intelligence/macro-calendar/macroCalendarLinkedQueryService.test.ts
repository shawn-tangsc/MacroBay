import { describe, expect, it } from 'vitest'
import { createMacroCalendarLinkedQueryService } from './macroCalendarLinkedQueryService'
import type { MarketCalendarEvent, MarketCalendarPage, MarketCalendarQuery } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'

const query: MarketCalendarQuery = { month: '2026-09', locale: 'zh', asOf: '2026-09-12T00:00:00.000Z' }
const official: MacroEconomicCalendarEventView = { eventKey: 'US.CPI.RELEASE.2026-M08', releaseGroupKey: 'US.CPI.RELEASE.2026-M08',
  eventFamily: 'consumer-price-index', titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-M08',
  lifecycleState: 'released', coverage: 'available', scheduledDate: '2026-09-11', detectedAt: query.asOf,
  actual: { displayValue: '3%', unit: 'percent' }, previous: { displayValue: '2%', unit: 'percent' },
  consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: [] }
const marketEvent = (index: number): MarketCalendarEvent => ({ eventKey: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: 'Derived CPI', countryCode: 'US', eventType: 'economic-indicator', importance: 'high',
  scheduledAt: '2026-09-11T12:30:00.000Z', source: '0xRouter', sourceObservedAt: query.asOf, coverage: 'observed-unverified',
  consensus: { displayValue: '0' }, providerActual: null, providerPrevious: { displayValue: '2.1' } })
function page(events: MarketCalendarEvent[], nextCursor?: string): MarketCalendarPage {
  return { state: 'available', ...query, events, ...(nextCursor ? { nextCursor } : {}), sources: [
    { eventType: 'economic-indicator', status: 'success', sourceObservedAt: query.asOf },
    { eventType: 'financial-event', status: 'unavailable', sourceObservedAt: null },
    { eventType: 'central-bank-activity', status: 'unavailable', sourceObservedAt: null }
  ] }
}
const derivedLink = (event: MacroEconomicCalendarEventView, market: MarketCalendarEvent) => ({ officialEventKey: event.eventKey,
  officialPeriodKey: event.periodKey, officialScheduledDate: event.scheduledDate, officialScheduledAt: event.scheduledAt ?? null,
  officialDetectedAt: event.detectedAt, timeDisplaySource: 'provider-scheduled' as const, displayScheduledAt: market.scheduledAt })

// Derived contract scenarios only; never admission evidence.
describe('linked calendar query composition', () => {
  it('reads the second page before deciding uniqueness and keeps both ambiguous observations', async () => {
    const cursor = '00000000-0000-4000-8000-000000000099'
    const calls: MarketCalendarQuery[] = []
    const service = createMacroCalendarLinkedQueryService({ official: { queryMonth: () => ({ state: 'available', asOf: query.asOf, events: [official] }) },
      market: { queryMonth: input => { calls.push(input); return input.cursor ? page([marketEvent(2)]) : page([marketEvent(1)], cursor) } }, link: derivedLink })
    const result = await service.queryMonth(query)
    expect(calls).toEqual([query, { ...query, cursor }])
    expect(result).toMatchObject({ state: 'available', events: [marketEvent(1), marketEvent(2)] })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.events.every(event => !event.officialLink)).toBe(true)
  })
  it('rejects a failed or scope-mismatched continuation without serving a premature link', async () => {
    const cursor = '00000000-0000-4000-8000-000000000099'
    for (const bad of [{ state: 'unavailable', failureCode: 'query-unavailable' }, { ...page([marketEvent(2)]), asOf: '2026-09-13T00:00:00.000Z' }]) {
      const service = createMacroCalendarLinkedQueryService({ official: { queryMonth: () => ({ state: 'available', asOf: query.asOf, events: [official] }) },
        market: { queryMonth: input => input.cursor ? bad as MarketCalendarPage : page([marketEvent(1)], cursor) }, link: derivedLink })
      expect(await service.queryMonth(query)).toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
    }
  })
  it('validates the query before accessing dependencies', async () => {
    let calls = 0
    const service = createMacroCalendarLinkedQueryService({ official: { queryMonth: () => { calls++; throw new Error('must not run') } },
      market: { queryMonth: () => { calls++; return page([]) } } })
    expect(await service.queryMonth({ ...query, month: 'invalid' })).toMatchObject({ state: 'unavailable' })
    expect(calls).toBe(0)
  })
  it('binds both queries to one asOf and retains rows with an empty registry', async () => {
    const query = { month: '2026-09', locale: 'zh' as const, asOf: '2026-09-12T00:00:00.000Z' }
    const calls: unknown[] = []
    const event = { eventKey: '00000000-0000-4000-8000-000000000001', title: 'Derived event', countryCode: 'US' as const,
      eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-11T12:30:00.000Z',
      consensus: { displayValue: '0' }, providerPrevious: null, providerActual: null,
      source: '0xRouter' as const, sourceObservedAt: query.asOf, coverage: 'observed-unverified' as const }
    const service = createMacroCalendarLinkedQueryService({
      official: { queryMonth: input => { calls.push(input); return { state: 'available', asOf: query.asOf, events: [] } } },
      market: { queryMonth: input => { calls.push(input); return { state: 'available', ...query, events: [event], sources: [
        { eventType: 'economic-indicator', status: 'success', sourceObservedAt: query.asOf },
        { eventType: 'financial-event', status: 'unavailable', sourceObservedAt: null },
        { eventType: 'central-bank-activity', status: 'unavailable', sourceObservedAt: null }
      ] } } }
    })
    expect(await service.queryMonth(query)).toMatchObject({ state: 'available', events: [event] })
    expect(calls).toContainEqual({ month: query.month, asOf: query.asOf })
    expect(calls).toContainEqual(query)
  })
})
