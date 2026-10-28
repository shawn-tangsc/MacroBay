import { describe, expect, it } from 'vitest'

import { selectDashboardEconomicCalendarMonth } from './dashboardEconomicCalendarModel'

const asOf = '2026-08-05T00:00:00.000Z'
const query = { month: '2026-08', asOf }

describe('dashboard economic calendar month readability', () => {
  it('reports a readable month with events as available', () => {
    expect(selectDashboardEconomicCalendarMonth(available([event()]), query)).toBe('available')
  })

  it('reports a readable month with no events as empty, not unavailable', () => {
    expect(selectDashboardEconomicCalendarMonth(available([]), query)).toBe('empty')
  })

  it('reports an unavailable reply as unavailable', () => {
    expect(selectDashboardEconomicCalendarMonth({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }, query))
      .toBe('unavailable')
  })

  it.each([
    ['wrong as-of echo', { state: 'available', asOf: '2026-08-05T00:00:00.001Z', events: [] }],
    ['missing events', { state: 'available', asOf }],
    ['non-array events', { state: 'available', asOf, events: {} }],
    ['unknown state', { state: 'loading', asOf, events: [] }],
    ['non-object reply', 'available'],
    ['null reply', null]
  ])('fails closed for %s', (_name, input) => {
    expect(selectDashboardEconomicCalendarMonth(input, query)).toBe('unavailable')
  })

  it('fails closed for an invalid month or a non-canonical clock before reading the reply', () => {
    expect(selectDashboardEconomicCalendarMonth(available([event()]), { month: '2026-13', asOf })).toBe('unavailable')
    expect(selectDashboardEconomicCalendarMonth(available([event()]), { month: '2026-08', asOf: '2026-08-05T00:00:00Z' }))
      .toBe('unavailable')
  })

  it('keeps no event field: only the readability verdict leaves this function', () => {
    const result = selectDashboardEconomicCalendarMonth(
      available([{ ...event(), sourceUrl: 'https://secret.example.test/?credential=hidden' }]), query)

    expect(result).toBe('available')
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret|credential|eventKey|sourceUrl/i)
  })
})

function available(events: unknown[]): unknown {
  return { state: 'available', asOf, events }
}

function event(): unknown {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: []
  }
}
