import { describe, expect, it } from 'vitest'

import {
  createEconomicCalendarMonthQuery,
  createEconomicCalendarProjection,
  economicCalendarCurrentMonth,
  economicCalendarGridMonths,
  economicCalendarCaveats,
  economicCalendarEventCategory,
  economicCalendarEventLabelKey,
  economicCalendarPresentationPolicy,
  economicCalendarCompactPrimaryValue,
  formatEconomicCalendarTime,
  shiftEconomicCalendarMonth,
  selectEconomicCalendarMonth,
  type EconomicCalendarPublicEvent
} from './economicCalendarModel'
import { macroEconomicCalendarCaveatPolicy } from '../../../shared/macroEconomicCalendarCaveatPolicy'

describe('macro economic calendar query projection', () => {
  it('derives labels and categories from safe event family and title keys rather than static event keys', () => {
    expect(economicCalendarEventCategory('cpi')).toBe('inflation')
    expect(economicCalendarEventCategory('consumer-price-index')).toBe('inflation')
    expect(economicCalendarEventCategory('employment-situation')).toBe('employment')
    expect(economicCalendarEventLabelKey(event({ eventFamily: 'employment-situation', titleKey: 'nonfarm-payrolls' }))).toBe('nonfarm-payrolls')
    expect(economicCalendarEventLabelKey(event({ eventKey: 'US.CPI.RELEASE.new-uid', titleKey: 'cpi' }))).toBe('cpi')
    expect(economicCalendarPresentationPolicy.dayEventLimit).toBe(6)
  })

  it('uses the official schedule date for month placement while preserving an optional official release instant', () => {
    const projection = createEconomicCalendarProjection({
      month: '2026-08', asOf: '2026-08-05T00:00:00.000Z', events: [
        event({ scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' }),
        event({ eventKey: 'US.FOMC.2026-08-12', eventFamily: 'fomc', titleKey: 'fomc', scheduledDate: '2026-08-12', scheduledAt: undefined, caveats: ['official-time-not-published'] })
      ]
    })
    const date = projection.days.find((day) => day.dateKey === '2026-08-12')

    expect(date?.events).toHaveLength(2)
    expect(date?.events[0]).toMatchObject({ scheduledAt: '2026-08-12T12:30:00.000Z', category: 'inflation' })
    expect(date?.events[1]).toMatchObject({ category: 'monetary-policy', caveats: ['official-time-not-published'] })
    expect(date?.events[1]).not.toHaveProperty('scheduledAt')
    expect(formatEconomicCalendarTime('2026-08-12T12:30:00.000Z', 'Asia/Shanghai', 'BJT')).toBe('20:30 BJT')
  })

  it.each([
    ['actual before date-only copy', { actual: { displayValue: '3.4%' }, scheduledAt: undefined }, '3.4%'],
    ['actual before scheduled time', { actual: { displayValue: '3.4%' }, scheduledAt: '2026-08-12T12:30:00.000Z' }, '3.4%'],
    ['scheduled time without actual', { scheduledAt: '2026-08-12T12:30:00.000Z' }, '20:30 BJT'],
    ['date-only copy without actual or time', { scheduledAt: undefined }, 'official-time-not-published']
  ] as const)('uses compact primary value priority for %s', (_name, value, expected) => {
    expect(economicCalendarCompactPrimaryValue(value, {
      timezone: 'Asia/Shanghai', timezoneLabel: 'BJT', dateOnly: 'official-time-not-published'
    })).toBe(expected)
  })

  it('does not retain source, evidence, raw-id, or URL fields in the projection', () => {
    const rawEvent = {
      ...event(), sourceUrl: 'https://official.example.test', descriptorId: 'descriptor-secret', rawRecordId: 'raw-secret',
      evidenceHash: 'evidence-secret', profile: 'profile-secret', credentialRef: 'credential-secret', userId: 'user-secret', exception: 'exception-secret'
    } as EconomicCalendarPublicEvent
    const projection = createEconomicCalendarProjection({ month: '2026-08', asOf: '2026-08-05T00:00:00.000Z', events: [rawEvent] })
    const projectedEvent = projection.events[0]

    expect(projectedEvent).toMatchObject({ sources: ['blsManualIcs'] })
    expect(projectedEvent).not.toHaveProperty('providerIds')
    expect(JSON.stringify(projection)).not.toMatch(/macro-calendar-bls|sourceUrl|descriptor-secret|raw-secret|evidence-secret|profile-secret|credential-secret|user-secret|exception-secret|https?:/i)
  })

  it('maps every supported provider through the named policy in deterministic source order', () => {
    const projection = createEconomicCalendarProjection({
      month: '2026-08', asOf: '2026-08-05T00:00:00.000Z',
      events: [event({ providerIds: ['macro-calendar-bls', 'macro-calendar-bea', 'macro-calendar-fed'] })]
    })

    expect(projection.events[0]).toMatchObject({ sources: ['federalReserve', 'bea', 'blsManualIcs'] })
  })

  it('uses the shared renderer caveat policy for safe presentation filtering', () => {
    const admitted = macroEconomicCalendarCaveatPolicy.admittedCaveats
    const eventWithEveryAdmittedCaveat = { caveats: [...admitted] }

    expect(admitted).toContain('bea-official-rss-release-page')
    expect(economicCalendarCaveats(eventWithEveryAdmittedCaveat)).toEqual(macroEconomicCalendarCaveatPolicy.visibleCaveats)
    expect(economicCalendarCaveats(eventWithEveryAdmittedCaveat)).not.toContain('bea-official-rss-release-page')
    expect(economicCalendarCaveats({ caveats: ['unknown-caveat'] })).toEqual([])
  })

  it.each([
    ['macro-calendar-fed', 'federalReserve'],
    ['macro-calendar-bea', 'bea'],
    ['macro-calendar-bls', 'blsManualIcs']
  ] as const)('maps %s only to %s', (providerId, source) => {
    const projection = createEconomicCalendarProjection({
      month: '2026-08', asOf: '2026-08-05T00:00:00.000Z', events: [event({ providerIds: [providerId] })]
    })

    expect(projection.events[0]).toMatchObject({ sources: [source] })
  })

  it.each([
    ['empty', []],
    ['duplicate', ['macro-calendar-fed', 'macro-calendar-fed']],
    ['unsupported', ['macro-calendar-fred']],
    ['malformed', ['macro-calendar-fed', 1]],
    ['accessor', accessorProviderIds()],
    ['symbol-bearing', symbolProviderIds()],
    ['extension-bearing', extensionProviderIds()],
    ['cyclic', cyclicProviderIds()],
    ['throwing proxy', new Proxy([], { getPrototypeOf: () => { throw new Error('trap') } })]
  ] as const)('fails closed for a %s provider list', (_name, providerIds) => {
    const projection = createEconomicCalendarProjection({
      month: '2026-08', asOf: '2026-08-05T00:00:00.000Z', events: [event({ providerIds: providerIds as never })]
    })

    expect(projection.events).toEqual([])
  })

  it('moves months across UTC year boundaries without changing the historical as-of instant', () => {
    expect(shiftEconomicCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftEconomicCalendarMonth('2025-12', 1)).toBe('2026-01')
    expect(createEconomicCalendarMonthQuery('2025-12', '2026-08-05T00:00:00.000Z')).toEqual({
      month: '2025-12', asOf: '2026-08-05T00:00:00.000Z'
    })
  })

  it('accepts only canonical picker months and retains the selected month for invalid values', () => {
    expect(selectEconomicCalendarMonth('2026-02', '2026-08')).toBe('2026-02')
    expect(selectEconomicCalendarMonth('2026-2', '2026-08')).toBe('2026-08')
    expect(selectEconomicCalendarMonth('2026-13', '2026-08')).toBe('2026-08')
  })
})

function event(overrides: Partial<EconomicCalendarPublicEvent> = {}): EconomicCalendarPublicEvent {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: '2026-08-05T00:00:00.000Z',
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'],
    caveats: ['official-period-not-published-in-ics', 'manual-ics-import'], ...overrides
  }
}

function accessorProviderIds(): readonly string[] {
  const providerIds: string[] = []
  Object.defineProperty(providerIds, '0', { enumerable: true, get: () => 'macro-calendar-fed' })
  return providerIds
}

function symbolProviderIds(): readonly string[] {
  const providerIds = ['macro-calendar-fed']
  Object.defineProperty(providerIds, Symbol('source'), { enumerable: true, value: 'macro-calendar-bea' })
  return providerIds
}

function extensionProviderIds(): readonly string[] {
  const providerIds = ['macro-calendar-fed'] as string[] & { extension?: string }
  providerIds.extension = 'unexpected'
  return providerIds
}

function cyclicProviderIds(): readonly unknown[] {
  const providerIds: unknown[] = []
  providerIds.push(providerIds)
  return providerIds
}

describe('economicCalendarCurrentMonth', () => {
  it('reads the month from the canonical instant, so the page and its queries move together', () => {
    expect(economicCalendarCurrentMonth('2026-08-31T23:59:59.999Z')).toBe('2026-08')
    expect(economicCalendarCurrentMonth('2026-09-01T00:00:00.000Z')).toBe('2026-09')
    expect(economicCalendarCurrentMonth('2027-01-01T00:00:00.000Z')).toBe('2027-01')
  })
})

describe('economicCalendarGridMonths', () => {
  it('reads the months the six-week grid draws, not just the month it is named after', () => {
    // 2026-10 starts on a Thursday: the grid opens on 2026-09-27 and closes on 2026-11-07.
    expect(economicCalendarGridMonths('2026-10')).toEqual(['2026-09', '2026-10', '2026-11'])
    // 2026-02 starts on a Sunday and still leaves a trailing week of March.
    expect(economicCalendarGridMonths('2026-02')).toEqual(['2026-02', '2026-03'])
    expect(economicCalendarGridMonths('2026-12')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(economicCalendarGridMonths('not-a-month')).toEqual([])
  })
})
