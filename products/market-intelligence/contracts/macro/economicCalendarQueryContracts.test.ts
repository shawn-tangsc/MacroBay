import { describe, expect, it } from 'vitest'

import {
  MACRO_ECONOMIC_CALENDAR_IPC_METHODS,
  macroEconomicCalendarPublicEventFields,
  type MacroEconomicCalendarEventView,
  type MacroCalendarProviderActionResult,
  type ManualBlsIcsImportResult,
  type ManualBlsIcsPreview,
  type SyncBlsScheduleAndValuesResult
} from './economicCalendarQueryContracts'

describe('macro economic calendar public query contracts', () => {
  it('exposes one optional official date without weakening the exact publication instant', () => {
    expect(macroEconomicCalendarPublicEventFields).toContain('officialReleaseDate')
    const released: MacroEconomicCalendarEventView = {
      eventKey: 'US.CPI.RELEASE.2026-M07', releaseGroupKey: 'US.CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', titleKey: 'cpi',
      countryCode: 'US', importance: 'high', periodKey: '2026-M07', lifecycleState: 'released', coverage: 'available',
      scheduledDate: '2026-08-12', officialReleaseDate: '2026-08-12', detectedAt: '2026-08-12T13:00:00.000Z',
      actual: { displayValue: '3.4%', numericValue: 3.4, unit: 'percent' }, consensus: null,
      consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: ['bls-python-schedule']
    }

    expect(released.officialReleaseDate).toBe('2026-08-12')
    expect(released.publishedAt).toBeUndefined()
    expect(JSON.stringify(released)).not.toMatch(/T00:00|sourceUrl|evidenceHash|rawRecordId/)
  })

  it('excludes internal evidence and storage identifiers from every public event shape', () => {
    expect(macroEconomicCalendarPublicEventFields).not.toEqual(expect.arrayContaining([
      'evidenceRefs', 'sourceUrl', 'evidenceHash', 'rawRecordId'
    ]))
    const response: MacroEconomicCalendarEventView = {
      eventKey: 'US.FOMC.2026-12-09', releaseGroupKey: 'US.FOMC.2026-12-09', eventFamily: 'fomc', titleKey: 'fomc',
      countryCode: 'US', importance: 'high', periodKey: '2026-12-09', lifecycleState: 'scheduled', coverage: 'available',
      scheduledDate: '2026-12-09', detectedAt: '2026-08-04T00:00:00.000Z', consensus: null,
      consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-fed'], caveats: []
    }
    expect(JSON.stringify(response)).not.toMatch(/evidenceRefs|sourceUrl|evidenceHash|rawRecordId/)
  })

  it('owns two manual BLS ICS methods whose result contracts expose counts and safe states only', () => {
    expect(MACRO_ECONOMIC_CALENDAR_IPC_METHODS).toMatchObject({
      previewManualBlsIcs: 'intelligence.macro.economicCalendar.previewManualBlsIcs',
      importManualBlsIcs: 'intelligence.macro.economicCalendar.importManualBlsIcs'
    })
    const preview: ManualBlsIcsPreview = {
      state: 'ready', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
      unsupportedEvents: 267, insertedCount: 115, rescheduledCount: 0, unchangedCount: 0
    }
    const imported: ManualBlsIcsImportResult = { state: 'unchanged', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 267, unchangedCount: 115 }
    expect(JSON.stringify({ preview, imported })).not.toMatch(/body|path|url|hash|rawRecordId|evidence|exception/i)
  })

  it('keeps the BLS refresh method and result limited to its confirmed event input and three coarse states', () => {
    const input: import('./economicCalendarQueryContracts').RefreshBlsEmploymentReleaseInput = {
      eventKey: 'US.CPI.RELEASE.2026-M07', confirmed: true
    }
    const results: import('./economicCalendarQueryContracts').RefreshBlsEmploymentReleaseResult[] = [
      { state: 'updated' }, { state: 'unchanged' }, { state: 'unavailable' }
    ]

    expect(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease).toBe('intelligence.macro.economicCalendar.refreshBlsEmploymentRelease')
    expect(Object.keys(input)).toEqual(['eventKey', 'confirmed'])
    expect(results.map((result) => Object.keys(result))).toEqual([['state'], ['state'], ['state']])
    expect(JSON.stringify({ input, results })).not.toMatch(/url|series|period|proxy|header|body|error|identity/i)
  })

  it('exposes an exact schedule-and-latest-values aggregate without counts or diagnostics', () => {
    const completed: SyncBlsScheduleAndValuesResult = {
      state: 'completed',
      schedule: 'updated',
      values: { cpi: 'updated', employment: 'current' }
    }
    const unavailable: SyncBlsScheduleAndValuesResult = { state: 'unavailable' }
    expect(Object.keys(completed)).toEqual(['state', 'schedule', 'values'])
    expect(Object.keys(completed.values)).toEqual(['cpi', 'employment'])
    expect(JSON.stringify({ completed, unavailable })).not.toMatch(/count|eventKey|period|series|url|evidence|raw|parser|proxy|error|exception/i)
    expect(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule).toBe('intelligence.macro.economicCalendar.syncBlsEmploymentSchedule')
  })

  it('owns fixed Fed and BEA settings DTOs without internal operational fields', () => {
    const page = {
      state: 'available' as const,
      providers: [
        { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
        { providerId: 'macro-calendar-bea', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 }
      ]
    }
    expect(JSON.stringify(page)).not.toMatch(/descriptor|https?:|evidence|raw|parser|job|credential|exception/i)
  })

  it('declares compact completed run outcomes without operational fields', () => {
    const succeeded: MacroCalendarProviderActionResult = {
      state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded'
    }
    const failed: MacroCalendarProviderActionResult = {
      state: 'completed', providerId: 'macro-calendar-bea', outcome: 'failed'
    }
    expect(JSON.stringify({ succeeded, failed })).toBe(JSON.stringify({
      succeeded: { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' },
      failed: { state: 'completed', providerId: 'macro-calendar-bea', outcome: 'failed' }
    }))
    expect(JSON.stringify({ succeeded, failed })).not.toMatch(/run|job|definition|timestamp|count|detail|exception/i)
  })

  it('retires the Calendar BEA UserID commands while retaining a provider-scoped public connection contract', () => {
    expect(Object.keys(MACRO_ECONOMIC_CALENDAR_IPC_METHODS)).not.toEqual(expect.arrayContaining([
      'getBeaUserIdPageState', 'saveBeaUserId', 'removeBeaUserId', 'testProviderCredential'
    ]))
  })

  it('declares the provider-scoped safe connection IPC without diagnostic fields', () => {
    expect(MACRO_ECONOMIC_CALENDAR_IPC_METHODS).toMatchObject({
      testProviderConnection: 'intelligence.macro.economicCalendar.testProviderConnection'
    })
  })

  it('owns the immutable Dashboard connection result as exactly two redacted variants', () => {
    const succeeded: import('./economicCalendarQueryContracts').DashboardSourceConnectionResult = { state: 'succeeded' }
    const failed: import('./economicCalendarQueryContracts').DashboardSourceConnectionResult = {
      state: 'failed', failureCode: 'request-timeout'
    }

    expect(JSON.stringify({ succeeded, failed })).toBe(JSON.stringify({
      succeeded: { state: 'succeeded' },
      failed: { state: 'failed', failureCode: 'request-timeout' }
    }))
    expect(JSON.stringify({ succeeded, failed })).not.toMatch(/url|query|header|status|body|exception|timestamp|raw|evidence|profile|credential|user.?id/i)
  })
})
