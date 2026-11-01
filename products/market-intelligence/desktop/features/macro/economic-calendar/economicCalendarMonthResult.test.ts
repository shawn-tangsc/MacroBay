import { describe, expect, it } from 'vitest'

import { economicCalendarMonthLoadingPolicy, toDetailEvent, toMonthState } from './economicCalendarMonthResult'

const asOf = '2026-08-05T00:00:00.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.AUGUST', releaseGroupKey: 'US.BLS.RELEASE.AUGUST', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled',
    coverage: 'available', scheduledDate: '2026-08-12', releaseTimeSource: 'official',
    detectedAt: asOf, consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable',
    providerIds: ['macro-calendar-bls'], caveats: [], ...overrides
  }
}

const query = { month: '2026-08', asOf }
const unavailable = { state: 'unavailable' as const, failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode }

describe('toMonthState', () => {
  it('projects a page whose shape and as-of both match the query', () => {
    const read = toMonthState({ state: 'available', asOf, events: [event()] }, query)
    expect(read.state).toBe('available')
    if (read.state !== 'available') throw new Error('expected an available read')
    expect(read.projection.month).toBe('2026-08')
    expect(read.projection.events.map(item => item.eventKey)).toEqual(['US.CPI.RELEASE.AUGUST'])
  })

  it('refuses a page read as of another instant, or with fields the contract does not name', () => {
    expect(toMonthState({ state: 'available', asOf: '2026-08-06T00:00:00.000Z', events: [] }, query)).toEqual(unavailable)
    expect(toMonthState({ state: 'available', asOf, events: [], extra: true }, query)).toEqual(unavailable)
    expect(toMonthState({ state: 'available', asOf, events: [{ ...event(), extra: true }] }, query)).toEqual(unavailable)
  })

  it('keeps a failure the wire is allowed to name and folds anything else into the page verdict', () => {
    expect(toMonthState({ state: 'unavailable', failureCode: 'query-input-invalid' }, query))
      .toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
    expect(toMonthState({ state: 'unavailable', failureCode: 'provider-error' }, query)).toEqual(unavailable)
    expect(toMonthState(undefined, query)).toEqual(unavailable)
  })
})

describe('toDetailEvent', () => {
  it('projects the detail in the event own month, not in the month the page is named after', () => {
    // A September event opened while the page reads August's grid must still be a September reading.
    const september = event({ eventKey: 'US.CPI.SEPTEMBER', scheduledDate: '2026-09-12' })
    expect(toDetailEvent({ state: 'available', asOf, event: september }, september.eventKey, asOf)?.eventKey)
      .toBe('US.CPI.SEPTEMBER')
    expect(toDetailEvent({ state: 'available', asOf, event: september }, 'US.CPI.OTHER', asOf)).toBeUndefined()
  })

  it('refuses a detail whose as-of or event shape does not match the read', () => {
    const detail = event()
    expect(toDetailEvent({ state: 'available', asOf: '2026-08-06T00:00:00.000Z', event: detail }, detail.eventKey, asOf)).toBeUndefined()
    expect(toDetailEvent({ state: 'unavailable', failureCode: 'event-not-found' }, detail.eventKey, asOf)).toBeUndefined()
    expect(toDetailEvent({ state: 'available', asOf, event: { ...detail, countryCode: 'DE' } }, detail.eventKey, asOf)).toBeUndefined()
  })
})
