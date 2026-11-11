import { describe, expect, it } from 'vitest'

import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { selectDashboardEconomicCalendarMonth } from './dashboardEconomicCalendarModel'

const asOf = '2026-08-05T00:00:00.000Z'
const query = { month: '2026-08', asOf }

describe('dashboard economic calendar month readability', () => {
  it('reports a readable month with events as available', () => {
    expect(selectDashboardEconomicCalendarMonth(available([event()]), query)).toEqual({ state: 'available' })
  })

  it('reports a readable month with no events as empty, not unavailable', () => {
    expect(selectDashboardEconomicCalendarMonth(available([]), query)).toEqual({ state: 'empty' })
  })

  it('reports an unavailable reply as 读不到, with the query cause', () => {
    // 「读不到」是一档，但内部要分清来路：这一种是「这一格没读成」，不是我们的参数坏了。
    expect(selectDashboardEconomicCalendarMonth({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }, query))
      .toEqual({ state: 'unavailable', cause: 'query-unavailable' })
  })

  it.each([
    ['wrong as-of echo', { state: 'available', asOf: '2026-08-05T00:00:00.001Z', events: [] }],
    ['missing events', { state: 'available', asOf }],
    ['non-array events', { state: 'available', asOf, events: {} }],
    ['unknown state', { state: 'loading', asOf, events: [] }],
    ['non-object reply', 'available'],
    ['null reply', null]
  ])('fails closed for %s', (_name, input) => {
    // 形状不符是「这一格没读成」；不是我们拼错了参数，所以不记日志、仍是读不到。
    expect(selectDashboardEconomicCalendarMonth(input, query)).toEqual({ state: 'unavailable', cause: 'query-unavailable' })
  })

  it('treats an invalid month or a non-canonical clock as our own fault, and still says 读不到', () => {
    // 参数与时钟都是我们拼的：读者看到的词不变（读不到），但来路是 `input-invalid`，调用方据此记日志。
    expect(selectDashboardEconomicCalendarMonth(available([event()]), { month: '2026-13', asOf }))
      .toEqual({ state: 'unavailable', cause: 'input-invalid' })
    expect(selectDashboardEconomicCalendarMonth(available([event()]), { month: '2026-08', asOf: '2026-08-05T00:00:00Z' }))
      .toEqual({ state: 'unavailable', cause: 'input-invalid' })
  })

  it('keeps no event field: only the readability verdict leaves this function', () => {
    const result = selectDashboardEconomicCalendarMonth(
      available([{ ...event(), sourceUrl: 'https://secret.example.test/?credential=hidden' }]), query)

    expect(result).toEqual({ state: 'available' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret|credential|eventKey|sourceUrl/i)
  })
})

function available(events: unknown[]): unknown {
  return { state: 'available', asOf, events }
}

function event(): MacroEconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', releaseTimeSource: 'official', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: []
  }
}
