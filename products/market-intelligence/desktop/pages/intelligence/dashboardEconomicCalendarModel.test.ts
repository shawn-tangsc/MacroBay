import { describe, expect, it } from 'vitest'

import { selectDashboardMacroReleaseDynamicsMonth } from './dashboardEconomicCalendarModel'
import { macroEconomicCalendarCaveatPolicy } from '../../shared/macroEconomicCalendarCaveatPolicy'

const asOf = '2026-08-05T00:00:00.000Z'

describe('dashboard macro release dynamics month projection', () => {
  it('groups every same-date upcoming event in deterministic timed/date-only/event-key order', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ eventKey: 'US.GDP.Z', eventFamily: 'gdp', titleKey: 'gdp', scheduledDate: '2026-08-12', scheduledAt: undefined }),
      event({ eventKey: 'US.CPI.B', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T13:30:00.000Z' }),
      event({ eventKey: 'US.CORE_PCE.A', eventFamily: 'core-pce', titleKey: 'core-pce', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' }),
      event({ eventKey: 'US.PCE.A', eventFamily: 'pce', titleKey: 'pce', scheduledDate: '2026-08-12', scheduledAt: undefined }),
      event({ eventKey: 'US.CPI.LATER', scheduledDate: '2026-08-13', scheduledAt: '2026-08-13T12:30:00.000Z' })
    ]), query())

    expect(result).toEqual({
      state: 'available',
      upcoming: {
        scheduledDate: '2026-08-12',
        countdown: { state: 'timed', days: 7, hours: 12 },
        events: [
          { labelKey: 'core-pce', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' },
          { labelKey: 'cpi', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T13:30:00.000Z' },
          { labelKey: 'gdp', scheduledDate: '2026-08-12' },
          { labelKey: 'pce', scheduledDate: '2026-08-12' }
        ],
        overflowCount: 0
      }
    })
  })

  it('limits a same-day group to five entries and projects only its overflow count', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((suffix) => event({
        eventKey: `US.CPI.${suffix}`, scheduledDate: '2026-08-12', scheduledAt: undefined
      }))
    ]), query())

    expect(result).toMatchObject({
      state: 'available',
      upcoming: {
        events: [
          { labelKey: 'cpi', scheduledDate: '2026-08-12' },
          { labelKey: 'cpi', scheduledDate: '2026-08-12' },
          { labelKey: 'cpi', scheduledDate: '2026-08-12' },
          { labelKey: 'cpi', scheduledDate: '2026-08-12' },
          { labelKey: 'cpi', scheduledDate: '2026-08-12' }
        ],
        overflowCount: 1
      }
    })
    expect(JSON.stringify(result)).not.toMatch(/eventKey|provider|consensus|https?:|sourceUrl|evidenceHash|rawRecordId|credential/i)
  })

  it('groups released values by the greatest official release date with optional prior values', () => {
    const releasedAsOf = '2026-08-06T00:00:00.000Z'
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({
        eventKey: 'US.CPI.RELEASE.A', lifecycleState: 'released', scheduledDate: '2026-08-04', scheduledAt: undefined,
        officialReleaseDate: '2026-08-05', publishedAt: undefined, actual: { displayValue: '3.2%' }, previous: { displayValue: '3.0%' }
      }),
      event({
        eventKey: 'US.CORE_CPI.RELEASE.A', eventFamily: 'cpi', lifecycleState: 'released', scheduledDate: '2026-08-04', scheduledAt: undefined,
        officialReleaseDate: '2026-08-05', publishedAt: '2026-08-05T13:30:00.000Z', actual: { displayValue: '3.1%' }
      }),
      event({
        eventKey: 'US.CPI.RELEASE.OLD', lifecycleState: 'released', scheduledDate: '2026-08-03', scheduledAt: undefined,
        officialReleaseDate: '2026-08-04', publishedAt: '2026-08-04T12:30:00.000Z', actual: { displayValue: '3.0%' }
      })
    ], releasedAsOf), query(releasedAsOf))

    expect(result).toMatchObject({
      state: 'available',
      released: {
        officialReleaseDate: '2026-08-05',
        events: [
          { labelKey: 'cpi', actual: '3.1%' },
          { labelKey: 'cpi', actual: '3.2%', previous: '3.0%' }
        ],
        overflowCount: 0
      }
    })
  })

  it('excludes released events without an official actual or official release date', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ lifecycleState: 'released', scheduledDate: '2026-08-04', scheduledAt: undefined, officialReleaseDate: undefined, actual: { displayValue: '3.2%' } }),
      event({ lifecycleState: 'released', scheduledDate: '2026-08-04', scheduledAt: undefined, officialReleaseDate: '2026-08-04', publishedAt: '2026-08-05T12:30:00.000Z', actual: undefined }),
      event({ lifecycleState: 'released', scheduledDate: '2026-08-04', scheduledAt: undefined, officialReleaseDate: '2026-08-06', actual: { displayValue: '3.4%' } })
    ]), query())

    expect(result).toEqual({ state: 'available' })
  })

  it('projects released BEA PCE and GDP values admitted by the shared caveat policy', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({
        eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', titleKey: 'pce', periodKey: '2026-07',
        lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined, officialReleaseDate: '2026-08-26',
        publishedAt: '2026-08-26T12:30:00.000Z', actual: { displayValue: '3.7%', numericValue: 3.7, unit: 'percent-yoy' },
        providerIds: ['macro-calendar-bea'], caveats: [...macroEconomicCalendarCaveatPolicy.admittedCaveats]
      }),
      event({
        eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', eventFamily: 'gdp', titleKey: 'gdp', periodKey: '2026-Q2',
        lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined, officialReleaseDate: '2026-08-26',
        publishedAt: '2026-08-26T12:30:00.000Z', actual: { displayValue: '1.5%', numericValue: 1.5, unit: 'percent-saar' },
        providerIds: ['macro-calendar-bea'], caveats: [...macroEconomicCalendarCaveatPolicy.admittedCaveats]
      })
    ], '2026-08-27T00:00:00.000Z'), { month: '2026-08', asOf: '2026-08-27T00:00:00.000Z' })

    expect(result).toMatchObject({
      state: 'available',
      released: {
        officialReleaseDate: '2026-08-26',
        events: [{ labelKey: 'gdp', actual: '1.5%' }, { labelKey: 'pce', actual: '3.7%' }]
      }
    })
  })

  it('fails closed for a caveat outside the shared admitted policy', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined, officialReleaseDate: '2026-08-26', actual: { displayValue: '3.7%' }, caveats: ['unknown-caveat'] })
    ], '2026-08-27T00:00:00.000Z'), { month: '2026-08', asOf: '2026-08-27T00:00:00.000Z' })

    expect(result).toEqual({ state: 'unavailable' })
  })

  it('orders a proven same-date instant before date-only releases and uses event keys as the final tie-breaker', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ eventKey: 'US.CPI.B', lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-04', actual: { displayValue: '3.2%' } }),
      event({ eventKey: 'US.FOMC.Z', eventFamily: 'fomc', titleKey: 'fomc', lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-04', publishedAt: '2026-08-04T18:00:00.000Z', actual: { displayValue: '3.50%–3.75%' } }),
      event({ eventKey: 'US.CPI.A', lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-04', actual: { displayValue: '3.1%' } })
    ]), query())

    expect(result.released?.events).toEqual([
      { labelKey: 'fomc', actual: '3.50%–3.75%' },
      { labelKey: 'cpi', actual: '3.1%' },
      { labelKey: 'cpi', actual: '3.2%' }
    ])
  })

  it('floors timed countdowns and gives under-one-hour a dedicated projection', () => {
    expect(selectDashboardMacroReleaseDynamicsMonth(available([
      event({ scheduledDate: '2026-08-05', scheduledAt: '2026-08-05T23:59:00.000Z' })
    ]), query()).upcoming?.countdown).toEqual({ state: 'timed', days: 0, hours: 23 })

    expect(selectDashboardMacroReleaseDynamicsMonth(available([
      event({ scheduledDate: '2026-08-05', scheduledAt: '2026-08-05T00:59:00.000Z' })
    ]), query()).upcoming?.countdown).toEqual({ state: 'less-than-one-hour' })
  })

  it('uses UTC calendar days for date-only groups without inferring a release instant', () => {
    const today = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ scheduledDate: '2026-08-05', scheduledAt: undefined })
    ]), query())
    const future = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ scheduledDate: '2026-08-08', scheduledAt: undefined })
    ]), query())

    expect(today.upcoming).toEqual({
      scheduledDate: '2026-08-05', countdown: { state: 'today' },
      events: [{ labelKey: 'cpi', scheduledDate: '2026-08-05' }], overflowCount: 0
    })
    expect(future.upcoming?.countdown).toEqual({ state: 'date-only', days: 3 })
  })

  it('accepts a shape-correct market consensus instead of treating the event as malformed', () => {
    const result = selectDashboardMacroReleaseDynamicsMonth(available([
      event({ consensus: { displayValue: '3.1%', numericValue: 3.1, unit: 'percent-yoy' }, consensusState: 'available', surprise: 'miss' })
    ]), query())

    expect(result).toMatchObject({ state: 'available', upcoming: { events: [{ labelKey: 'cpi', scheduledDate: '2026-08-12' }] } })
    expect(JSON.stringify(result)).not.toMatch(/consensus|3\.1%/)
  })

  it.each([
    ['unknown consensus state', { consensusState: 'pending' }],
    ['unknown surprise', { surprise: 'unknown' }],
    ['consensus without a display value', { consensus: { numericValue: 3.1 } }],
    ['consensus with an empty display value', { consensus: { displayValue: '' } }],
    ['non-object consensus', { consensus: '3.1' }]
  ])('fails closed for a malformed market consensus: %s', (_name, overrides) => {
    expect(selectDashboardMacroReleaseDynamicsMonth(available([event(overrides)]), query())).toEqual({ state: 'unavailable' })
  })

  it.each([
    ['extension-bearing event', available([{ ...event(), sourceUrl: 'https://secret.example.test/?credential=hidden' }])],
    ['invalid scheduled instant', available([event({ scheduledAt: '2026-08-10T12:30:00Z' })])],
    ['off-month event', available([event({ scheduledDate: '2026-09-01', scheduledAt: '2026-09-01T12:30:00.000Z' })])],
    ['wrong as-of echo', { state: 'available', asOf: '2026-08-05T00:00:00.001Z', events: [] }]
  ])('fails closed for %s without retaining unsafe response fields', (_name, input) => {
    const result = selectDashboardMacroReleaseDynamicsMonth(input, query())

    expect(result).toEqual({ state: 'unavailable' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret|credential|sourceUrl|eventKey|publishedAt|actual/i)
  })
})

function available(events: unknown[], responseAsOf = asOf) {
  return { state: 'available', asOf: responseAsOf, events }
}

function query(queryAsOf = asOf) {
  return { month: '2026-08', asOf: queryAsOf }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: [],
    ...overrides
  }
}
