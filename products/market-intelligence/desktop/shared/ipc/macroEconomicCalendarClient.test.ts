import { afterEach, describe, expect, it, vi } from 'vitest'

import { MACRO_ECONOMIC_CALENDAR_IPC_METHODS } from '../../../contracts/macro/economicCalendarQueryContracts'
import { macroEconomicCalendarCaveatPolicy } from '../macroEconomicCalendarCaveatPolicy'
import { macroEconomicCalendarClient } from './macroEconomicCalendarClient'

const asOf = '2026-08-05T00:00:00.000Z'

afterEach(() => vi.unstubAllGlobals())

describe('macroEconomicCalendarClient', () => {
  it('reconstructs only the exact schedule-and-values aggregate and rejects hostile result fields', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' } })
      .mockResolvedValueOnce({ state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' }, eventKey: 'US.CPI.RELEASE.2026-M07' })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.syncBlsEmploymentSchedule({ year: '2026' })).resolves.toEqual({ state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' } })
    await expect(macroEconomicCalendarClient.syncBlsEmploymentSchedule({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule, { year: '2026' })
  })

  it('rejects accessor-backed aggregate fields', async () => {
    const result = { state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' } }
    Object.defineProperty(result, 'schedule', { enumerable: true, get: () => 'updated' })
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => result) } } })
    await expect(macroEconomicCalendarClient.syncBlsEmploymentSchedule({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
  })
  it('calls only the product-owned month and detail IPC methods with the exact safe inputs', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'available', asOf, events: [event()] })
      .mockResolvedValueOnce({ state: 'available', asOf, event: event() })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'available', asOf, events: [event()]
    })
    await expect(macroEconomicCalendarClient.getEventDetail({ eventKey: 'US.CPI.RELEASE.uid-1', asOf })).resolves.toEqual({
      state: 'available', asOf, event: event()
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth, { month: '2026-08', asOf })
    expect(invoke).toHaveBeenNthCalledWith(2, 'market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail, { eventKey: 'US.CPI.RELEASE.uid-1', asOf })
  })

  it('accepts the automatic Python BLS schedule caveat', async () => {
    const automaticEvent = event({
      eventFamily: 'employment-situation', titleKey: 'nonfarm-payrolls', scheduledAt: undefined,
      caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [automaticEvent] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'available', asOf, events: [automaticEvent]
    })
  })

  it('accepts every caveat admitted by the shared renderer policy through the IPC sanitizer', async () => {
    const beaReleased = event({
      eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', titleKey: 'pce',
      periodKey: '2026-07', lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined,
      publishedAt: asOf, actual: { displayValue: '3.7%', numericValue: 3.7, unit: 'percent-yoy' },
      providerIds: ['macro-calendar-bea'], caveats: [...macroEconomicCalendarCaveatPolicy.admittedCaveats]
    })
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [beaReleased] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'available', asOf, events: [beaReleased]
    })
  })

  it('keeps unknown event caveats fail-closed', async () => {
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [event({ caveats: ['unknown-caveat'] })] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('keeps a shape-correct market consensus usable instead of rewriting it to unavailable', async () => {
    const withConsensus = event({
      consensus: { displayValue: '3.1%', numericValue: 3.1, unit: 'percent-yoy' },
      consensusState: 'available', surprise: 'miss',
      actual: { displayValue: '3.0%', numericValue: 3, unit: 'percent-yoy' }
    })
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [withConsensus] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'available', asOf, events: [withConsensus]
    })
  })

  it.each([
    ['unknown consensus state', { consensusState: 'pending' }],
    ['unknown surprise', { surprise: 'unknown' }],
    ['consensus without a display value', { consensus: { numericValue: 3.1 } }],
    ['consensus with an empty display value', { consensus: { displayValue: '' } }],
    ['non-object consensus', { consensus: '3.1' }]
  ])('fails closed for a malformed market consensus: %s', async (_name, overrides) => {
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [event(overrides)] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('preserves a canonical official release date in safe month and detail responses', async () => {
    const released = event({
      lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-12',
      actual: { displayValue: '3.4%', numericValue: 3.4, unit: 'percent' },
      previous: { displayValue: '3.0%', numericValue: 3, unit: 'percent' }, caveats: ['bls-python-schedule']
    })
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'available', asOf, events: [released] })
      .mockResolvedValueOnce({ state: 'available', asOf, event: released })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({ state: 'available', asOf, events: [released] })
    await expect(macroEconomicCalendarClient.getEventDetail({ eventKey: released.eventKey, asOf })).resolves.toEqual({ state: 'available', asOf, event: released })
  })

  it.each([
    ['impossible date', '2026-02-30'],
    ['timestamp instead of date', '2026-08-12T00:00:00.000Z'],
    ['non-string date', 20260812]
  ])('fails closed for an %s official release date', async (_name, officialReleaseDate) => {
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [event({ officialReleaseDate })] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('fails closed for an accessor-backed official release date', async () => {
    const hostile = event()
    Object.defineProperty(hostile, 'officialReleaseDate', { enumerable: true, get: () => '2026-08-12' })
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, events: [hostile] })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('accepts only the safe FOMC target-range DTO fields', async () => {
    const fomc = event({
      eventKey: 'US.FOMC.2026-07-29', releaseGroupKey: 'US.FOMC.2026-07-29', eventFamily: 'fomc', titleKey: 'fomc',
      periodKey: '2026-07-29', lifecycleState: 'released', scheduledDate: '2026-07-29', scheduledAt: undefined,
      publishedAt: '2026-07-29T18:00:00.000Z', providerIds: ['macro-calendar-fed'], caveats: ['official-time-not-published'],
      actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' }
    })
    const invoke = vi.fn().mockResolvedValue({ state: 'available', asOf, event: fomc })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.getEventDetail({ eventKey: fomc.eventKey, asOf })).resolves.toEqual({
      state: 'available', asOf, event: fomc
    })
  })

  it('uses the manual BLS preview and import methods with the selected body and rebuilds safe results', async () => {
    const body = 'BEGIN:VCALENDAR\nEND:VCALENDAR'
    const preview = manualPreview()
    const imported = { ...preview, state: 'imported' as const }
    const invoke = vi.fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(imported)
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.previewManualBlsIcs({ body, truncated: false })).resolves.toEqual(preview)
    await expect(macroEconomicCalendarClient.importManualBlsIcs({ body, truncated: false })).resolves.toEqual(imported)
    expect(invoke).toHaveBeenNthCalledWith(1, 'market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs, { body, truncated: false })
    expect(invoke).toHaveBeenNthCalledWith(2, 'market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs, { body, truncated: false })
  })

  it('calls the sealed confirmed BLS employment refresh route and reconstructs only its coarse result', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'updated' })
      .mockResolvedValueOnce({ state: 'updated', rawBody: 'sensitive' })
      .mockResolvedValueOnce({ state: 'unchanged' })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.refreshBlsEmploymentRelease({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true })).resolves.toEqual({ state: 'updated' })
    await expect(macroEconomicCalendarClient.refreshBlsEmploymentRelease({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    await expect(macroEconomicCalendarClient.refreshBlsEmploymentRelease({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true })).resolves.toEqual({ state: 'unchanged' })
    await expect(macroEconomicCalendarClient.refreshBlsEmploymentRelease({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: false } as never)).resolves.toEqual({ state: 'unavailable' })
    await expect(macroEconomicCalendarClient.refreshBlsEmploymentRelease({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true, extra: 'hostile' } as never)).resolves.toEqual({ state: 'unavailable' })
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.macro.economicCalendar.refreshBlsEmploymentRelease', {
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', confirmed: true
    })
  })

  it('calls the sealed confirmed FOMC refresh route and reconstructs only its coarse result', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'updated' })
      .mockResolvedValueOnce({ state: 'unchanged' })
      .mockResolvedValueOnce({ state: 'updated', sourceUrl: 'https://secret.example.test', body: 'raw' })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.refreshFedFomcDecision({ eventKey: 'US.FOMC.2026-07-29', confirmed: true })).resolves.toEqual({ state: 'updated' })
    await expect(macroEconomicCalendarClient.refreshFedFomcDecision({ eventKey: 'US.FOMC.2026-07-29', confirmed: true })).resolves.toEqual({ state: 'unchanged' })
    await expect(macroEconomicCalendarClient.refreshFedFomcDecision({ eventKey: 'US.FOMC.2026-07-29', confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    await expect(macroEconomicCalendarClient.refreshFedFomcDecision({ eventKey: 'US.FOMC.2026-07-29', confirmed: false } as never)).resolves.toEqual({ state: 'unavailable' })
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision, {
      eventKey: 'US.FOMC.2026-07-29', confirmed: true
    })
  })

  it('fails closed when manual BLS IPC results include sensitive fields or malformed counts', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ...manualPreview(), sourceUrl: 'https://secret.example.test/bls.ics', rawRecordId: 'raw-id', body: 'raw' })
      .mockResolvedValueOnce({ ...manualPreview(), state: 'imported', insertedCount: 0.5 })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.previewManualBlsIcs({ body: 'raw', truncated: false })).resolves.toEqual({
      state: 'failed', failureCode: 'persistence-failed'
    })
    await expect(macroEconomicCalendarClient.importManualBlsIcs({ body: 'raw', truncated: false })).resolves.toEqual({
      state: 'failed', failureCode: 'persistence-failed'
    })
  })

  it('fails closed when an IPC response contains sensitive fields or a malformed public event', async () => {
    const invoke = vi.fn().mockResolvedValue({
      state: 'available', asOf, events: [{ ...event(), sourceUrl: 'https://secret.example.test/bls.ics', rawRecordId: 'raw-id', evidenceHash: 'hash' }]
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('maps a missing product IPC bridge to a safe unavailable result', async () => {
    vi.stubGlobal('window', {})

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('fails closed when a response does not match the requested as-of instant or event identity', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'available', asOf: '2026-08-05T00:00:00.001Z', events: [event()] })
      .mockResolvedValueOnce({ state: 'available', asOf, event: event() })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
    await expect(macroEconomicCalendarClient.getEventDetail({ eventKey: 'US.FOMC.2026-08-12', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })

  it('fails closed when a month or detail event was detected after the requested as-of instant', async () => {
    const futureDetectedEvent = event({ detectedAt: '2026-08-05T00:00:00.001Z' })
    const invoke = vi.fn()
      .mockResolvedValueOnce({ state: 'available', asOf, events: [futureDetectedEvent] })
      .mockResolvedValueOnce({ state: 'available', asOf, event: futureDetectedEvent })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(macroEconomicCalendarClient.queryMonth({ month: '2026-08', asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
    await expect(macroEconomicCalendarClient.getEventDetail({ eventKey: futureDetectedEvent.eventKey, asOf })).resolves.toEqual({
      state: 'unavailable', failureCode: 'calendar-query-unavailable'
    })
  })
})

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US' as const, importance: 'high' as const, periodKey: 'release-2026-08-12', lifecycleState: 'scheduled' as const,
    coverage: 'available' as const, scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z',
    releaseTimeSource: 'official' as const, detectedAt: asOf,
    consensus: null, consensusState: 'unavailable' as const, surprise: 'consensus-unavailable' as const,
    providerIds: ['macro-calendar-bls'], caveats: ['official-period-not-published-in-ics', 'manual-ics-import'], ...overrides
  }
}

function manualPreview() {
  return {
    state: 'ready' as const,
    totalEvents: 313,
    supportedReleaseGroups: 46,
    generatedEvents: 115,
    unsupportedEvents: 198,
    insertedCount: 100,
    rescheduledCount: 10,
    unchangedCount: 5
  }
}
