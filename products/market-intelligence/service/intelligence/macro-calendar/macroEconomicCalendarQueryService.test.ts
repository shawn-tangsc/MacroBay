import { describe, expect, it } from 'vitest'

import { macroEconomicCalendarQueryPolicy, createMacroEconomicCalendarQueryService } from './macroEconomicCalendarQueryService'
import type { MacroCalendarRepository } from './macroCalendarRepository'

const asOf = '2026-08-04T00:00:00.000Z'

describe('macroEconomicCalendarQueryService', () => {
  it('projects only a complete, exact BEA PCE/Core official release pair', () => {
    const pce = revision({ eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', eventNameKey: 'pce', periodKey: '2026-07', scheduledDate: '2026-08-26', lifecycleState: 'released', revisionKind: 'official-release', providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-release-rss', publishedAt: '2026-08-26T12:30:00.000Z', actual: { displayValue: '3.7%', numericValue: 3.7, unit: 'percent-yoy' } })
    const core = revision({ ...pce, revisionId: 'core', eventKey: 'US.CORE_PCE.2026-07', eventFamily: 'core-pce', eventNameKey: 'core-pce', actual: { displayValue: '3.3%', numericValue: 3.3, unit: 'percent-yoy' } })
    const repository = createRepository({ month: [pce, core] })
    const service = createMacroEconomicCalendarQueryService({ repository })

    expect(service.queryMonth({ month: '2026-08', asOf: '2026-08-26T13:00:00.000Z' })).toMatchObject({ state: 'available', events: expect.arrayContaining([expect.objectContaining({ eventKey: pce.eventKey, actual: pce.actual, officialReleaseDate: '2026-08-26' }), expect.objectContaining({ eventKey: core.eventKey, actual: core.actual, officialReleaseDate: '2026-08-26' })]) })
    expect(createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [pce] }) }).queryMonth({ month: '2026-08', asOf: '2026-08-26T13:00:00.000Z' })).toMatchObject({ state: 'available', events: [] })
  })
  it('answers the next FOMC meeting at or after asOf and ignores past ones', () => {
    const past = revision({ eventKey: 'US.FOMC.2026-07-29', eventFamily: 'fomc', eventNameKey: 'fomc', scheduledDate: '2026-07-29', providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule' })
    const nearer = revision({ eventKey: 'US.FOMC.2026-10-28', eventFamily: 'fomc', eventNameKey: 'fomc', scheduledDate: '2026-10-28', providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule' })
    const later = revision({ eventKey: 'US.FOMC.2026-12-09', eventFamily: 'fomc', eventNameKey: 'fomc', scheduledDate: '2026-12-09', providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule' })
    const service = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [later, past, nearer] }) })

    expect(service.nextFomcMeeting({ asOf: '2026-08-04T00:00:00.000Z' })).toEqual({
      state: 'available',
      meeting: { eventKey: 'US.FOMC.2026-10-28', scheduledDate: '2026-10-28' }
    })
    expect(service.nextFomcMeeting({ asOf: '2026-12-10T00:00:00.000Z' })).toEqual({ state: 'unavailable', failureCode: 'meeting-not-found' })
    expect(service.nextFomcMeeting({ asOf: '2026-08-04T00:00:00Z' })).toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
  })

  it('rejects missing or noncanonical asOf without reading the repository', () => {
    const repository = createRepository()
    const service = createMacroEconomicCalendarQueryService({ repository })

    expect(service.queryMonth({ month: '2026-08' })).toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
    expect(service.getEventDetail({ eventKey: 'US.FOMC.2026-12-09', asOf: '2026-08-04T00:00:00Z' })).toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
    expect(repository.monthCalls).toEqual([])
    expect(repository.detailCalls).toEqual([])
  })

  it.each([0, 0.5, -1, Number.MAX_SAFE_INTEGER + 1, '200'])('rejects an invalid caller result bound without reading the repository', (maxEvents) => {
    const repository = createRepository()
    const result = createMacroEconomicCalendarQueryService({ repository }).queryMonth({ month: '2026-08', asOf, maxEvents })

    expect(result).toEqual({ state: 'unavailable', failureCode: 'query-input-invalid' })
    expect(repository.monthCalls).toEqual([])
  })

  it('returns a product-bounded, redacted Fed/BEA month projection and excludes future-detected revisions', () => {
    const repository = createRepository({
      month: [
        revision({ eventKey: 'US.CPI.2026-08', providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-schedule' }),
        revision({
          eventKey: 'US.CPI.RELEASE.11111111-1111-4111-8111-111111111111',
          providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.manualIcsDescriptorId,
          eventFamily: 'consumer-price-index', eventNameKey: 'cpi', scheduledAt: '2026-08-15T12:30:00.000Z'
        }),
        revision({ eventKey: 'US.GDP.2026-Q3.ADVANCE', providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule', detectedAt: '2026-08-05T00:00:00.000Z' }),
        revision({ eventKey: 'US.FOMC.2026-08-15.DECISION', revisionKind: 'official-release' }),
        ...Array.from({ length: macroEconomicCalendarQueryPolicy.monthResultLimit - 1 }, (_, index) => revision({ eventKey: `US.FOMC.2026-08-${index}`, revisionId: `fed-${index}` })),
      ]
    })
    const result = createMacroEconomicCalendarQueryService({ repository }).queryMonth({ month: '2026-08', asOf })

    expect(result).toMatchObject({ state: 'available', asOf })
    expect(result.state === 'available' && result.events).toHaveLength(macroEconomicCalendarQueryPolicy.monthResultLimit)
    expect(result.state === 'available' && result.events.map((event) => event.eventKey)).not.toEqual(expect.arrayContaining([
      'US.CPI.2026-08', 'US.GDP.2026-Q3.ADVANCE', 'US.FOMC.2026-08-15.DECISION'
    ]))
    expect(result.state === 'available' && result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventKey: 'US.CPI.RELEASE.11111111-1111-4111-8111-111111111111',
        providerIds: ['macro-calendar-bls']
      })
    ]))
    expect(repository.monthCalls).toEqual([{ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf, limit: macroEconomicCalendarQueryPolicy.monthResultLimit }])
    expect(JSON.stringify(result)).not.toMatch(/evidenceRefs|sourceUrl|evidenceHash|rawRecordId|secret|sqlite/i)
  })

  it('passes a valid caller month limit to the repository and returns no more events than requested', () => {
    const repository = createRepository({ month: [revision(), revision({ revisionId: 'revision-2' })] })
    const result = createMacroEconomicCalendarQueryService({ repository }).queryMonth({ month: '2026-08', asOf, maxEvents: 1 })

    expect(repository.monthCalls).toEqual([{ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf, limit: 1 }])
    expect(result).toMatchObject({ state: 'available', events: [expect.objectContaining({ eventKey: 'US.FOMC.2026-12-09' })] })
    expect(result.state === 'available' && result.events).toHaveLength(1)
  })

  it('returns one safe effective Fed/BEA event detail and hides future or non-schedule providers', () => {
    const repository = createRepository({ detail: revision({ eventKey: 'US.GDP.2026-Q3.ADVANCE', providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule' }) })
    const service = createMacroEconomicCalendarQueryService({ repository })

    expect(service.getEventDetail({ eventKey: 'US.GDP.2026-Q3.ADVANCE', asOf })).toEqual(expect.objectContaining({
      state: 'available', event: expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.ADVANCE', providerIds: ['macro-calendar-bea'] })
    }))
    repository.detail = revision({ providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-schedule' })
    expect(service.getEventDetail({ eventKey: 'US.CPI.2026-08', asOf })).toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
    repository.detail = revision({
      eventKey: 'US.CPI.RELEASE.11111111-1111-4111-8111-111111111111',
      providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-ics-manual',
      eventFamily: 'consumer-price-index', eventNameKey: 'cpi'
    })
    expect(service.getEventDetail({ eventKey: 'US.CPI.RELEASE.11111111-1111-4111-8111-111111111111', asOf })).toEqual(expect.objectContaining({
      state: 'available', event: expect.objectContaining({ providerIds: ['macro-calendar-bls'] })
    }))
    repository.detail = revision({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-statement' })
    expect(service.getEventDetail({ eventKey: 'US.FOMC.2026-12-09', asOf })).toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
    repository.detail = revision({ revisionKind: 'official-release' })
    expect(service.getEventDetail({ eventKey: 'US.FOMC.2026-12-09', asOf })).toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
  })

  it('canonicalizes a complete BLS family for month and detail without exposing stored raw display strings', () => {
    const values = employmentValues()
    const service = createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: values[2], month: values }) })
    const releasedAsOf = '2026-08-12T00:00:00.000Z'

    const month = service.queryMonth({ month: '2026-08', asOf: releasedAsOf })
    const detail = service.getEventDetail({ eventKey: values[2]!.eventKey, asOf: releasedAsOf })

    expect(month).toMatchObject({ state: 'available', events: expect.arrayContaining([
      expect.objectContaining({ eventKey: values[0]!.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 20, displayValue: '+20K', unit: 'thousands' } }),
      expect.objectContaining({ eventKey: values[1]!.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 4.1, displayValue: '4.1%', unit: 'percent' } }),
      expect.objectContaining({ eventKey: values[2]!.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 0.05319148936169249, displayValue: '0.1%', unit: 'percent' }, previous: { numericValue: 0.2934115764203771, displayValue: '0.3%', unit: 'percent' } })
    ]) })
    expect(detail).toMatchObject({ state: 'available', event: { eventKey: values[2]!.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 0.05319148936169249, displayValue: '0.1%', unit: 'percent' } } })
    expect(JSON.stringify([month, detail])).not.toContain('0.05319148936169249%')
    expect(month.state === 'available' && month.events.every((event) => !event.officialReleaseDate?.includes('T'))).toBe(true)
    expect(JSON.stringify([month, detail])).not.toMatch(/sourceUrl|rawRecordId|evidenceHash/)

    const foreign = { ...values[0], descriptorId: macroEconomicCalendarQueryPolicy.employmentRefreshDescriptorId, caveats: ['manual-ics-import'] }
    expect(createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: foreign }) }).getEventDetail({ eventKey: foreign.eventKey, asOf: releasedAsOf })).toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
  })

  it.each([
    ['missing', () => employmentValues().slice(0, 2)],
    ['duplicate', () => [...employmentValues(), { ...employmentValues()[2], revisionId: 'duplicate-ahe' }]],
    ['conflicting identity', () => employmentValues().map((value, index) => index === 2 ? { ...value, releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.conflict' } : value)],
    ['conflicting duplicate', () => [...employmentValues(), { ...employmentValues()[2], revisionId: 'conflicting-ahe', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.conflict' }]],
    ['invalid unit', () => employmentValues().map((value, index) => index === 2 ? { ...value, actual: { ...value.actual, unit: 'thousands' } } : value)]
  ] as const)('suppresses the complete BLS family for a %s member set without raw fallback', (_name, createValues) => {
    const values = createValues()
    const repository = createRepository({ detail: values[0], month: values })
    const service = createMacroEconomicCalendarQueryService({ repository })

    expect(service.queryMonth({ month: '2026-08', asOf })).toEqual({ state: 'available', asOf, events: [] })
    expect(service.getEventDetail({ eventKey: values[0]!.eventKey, asOf })).toEqual({ state: 'unavailable', failureCode: 'event-not-found' })
    expect(JSON.stringify(service.queryMonth({ month: '2026-08', asOf }))).not.toMatch(/stored-raw|0\.05319148936169249%/)
  })

  it('projects a Fed official release with actual while keeping unavailable previous absent and redacted', () => {
    const fomc = revision({
      eventKey: 'US.FOMC.2026-07-29', releaseGroupKey: 'US.FOMC.2026-07-29', eventFamily: 'fomc', eventNameKey: 'fomc',
      periodKey: '2026-07-29', scheduledDate: '2026-07-29', providerId: 'macro-calendar-fed',
      descriptorId: macroEconomicCalendarQueryPolicy.fedDecisionDescriptorId, revisionKind: 'official-release', lifecycleState: 'released',
      publishedAt: '2026-07-30T00:30:00.000Z',
      actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' } as never,
      sourceUrl: 'https://secret.example.test/raw', rawRecordId: 'raw-secret', evidenceHash: 'evidence-secret', caveats: ['official-time-not-published']
    })
    const service = createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: fomc, month: [fomc] }) })

    const detail = service.getEventDetail({ eventKey: fomc.eventKey, asOf })
    const month = service.queryMonth({ month: '2026-07', asOf })

    expect(detail).toEqual(expect.objectContaining({ state: 'available', event: expect.objectContaining({ officialReleaseDate: '2026-07-29', publishedAt: '2026-07-30T00:30:00.000Z', actual: fomc.actual, previous: undefined }) }))
    expect(month).toEqual(expect.objectContaining({ state: 'available', events: [expect.objectContaining({ eventKey: fomc.eventKey, officialReleaseDate: '2026-07-29', publishedAt: '2026-07-30T00:30:00.000Z', actual: fomc.actual, previous: undefined })] }))
    expect(JSON.stringify([detail, month])).not.toMatch(/secret|rawRecordId|evidenceHash|sourceUrl|https?:/i)
    const corrected = createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: { ...fomc, revisionKind: 'official-revision' } }) })
      .getEventDetail({ eventKey: fomc.eventKey, asOf })
    expect(corrected).toMatchObject({ state: 'available', event: { caveats: ['official-time-not-published'] } })
  })

  it('prefers the automatic BLS schedule without carrying an incomplete legacy manual family', () => {
    const automatic = revision({
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: '2026-M07',
      scheduledDate: '2026-08-07', scheduledAt: undefined, providerId: 'macro-calendar-bls',
      descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    const manualValue = revision({
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.legacy-uid', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.legacy-uid',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: '2026-M07',
      scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z', providerId: 'macro-calendar-bls',
      descriptorId: macroEconomicCalendarQueryPolicy.employmentRefreshDescriptorId, revisionKind: 'official-release', lifecycleState: 'released',
      caveats: ['official-period-not-published-in-ics', 'manual-ics-import'],
      actual: { numericValue: -23, displayValue: '-23K', unit: 'thousands' },
      previous: { numericValue: 20, displayValue: '+20K', unit: 'thousands' }
    })
    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [manualValue, automatic] }) })
      .queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toMatchObject({
      state: 'available',
      events: [{
        // The automatic BLS schedule states no time, so the row displays the family convention
        // (08:30 Eastern) — and says so, rather than passing our expectation off as a published time.
        eventKey: automatic.eventKey, scheduledAt: '2026-08-07T12:30:00.000Z', releaseTimeSource: 'convention-default',
        conventionScheduledAt: '2026-08-07T12:30:00.000Z', lifecycleState: 'scheduled',
        actual: undefined, previous: undefined, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
      }]
    })
    expect(result.state === 'available' && result.events.map((event) => event.eventKey)).toEqual([automatic.eventKey])
    expect(automatic.scheduledAt).toBeUndefined()
    expect(automatic.actual).toBeUndefined()
  })

  it('keeps automatic event detail schedule-only for an incomplete legacy BLS family', () => {
    const automatic = revision({
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: '2026-M07', scheduledDate: '2026-08-07',
      providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId,
      caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    const manualValue = revision({
      eventKey: 'US.NONFARM_PAYROLLS.RELEASE.legacy-uid', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.legacy-uid',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: '2026-M07', scheduledDate: '2026-08-07',
      providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.employmentRefreshDescriptorId,
      revisionKind: 'official-release', lifecycleState: 'released', caveats: ['manual-ics-import'],
      actual: { numericValue: -23, displayValue: '-23K', unit: 'thousands' }, previous: { numericValue: 20, displayValue: '+20K', unit: 'thousands' }
    })
    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: automatic, month: [manualValue, automatic] }) })
      .getEventDetail({ eventKey: automatic.eventKey, asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toMatchObject({ state: 'available', event: { eventKey: automatic.eventKey, lifecycleState: 'scheduled', actual: undefined, previous: undefined } })
  })

  it('hides a legacy manual BLS schedule when the automatic schedule covers the same metric and date', () => {
    const automatic = revision({
      eventKey: 'US.UNEMPLOYMENT.RELEASE.2026-M07', eventFamily: 'employment-situation', eventNameKey: 'unemployment',
      scheduledDate: '2026-08-07', providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId,
      caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    const manual = revision({
      eventKey: 'US.UNEMPLOYMENT.RELEASE.legacy-uid', eventFamily: 'employment-situation', eventNameKey: 'unemployment',
      scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z', providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.manualIcsDescriptorId,
      caveats: ['official-period-not-published-in-ics', 'manual-ics-import']
    })
    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [manual, automatic] }) })
      .queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    // The hidden manual row carried a real 12:30Z; the automatic row now reaches the same instant
    // through the family convention, which is exactly why that convention is the defensible one.
    expect(result).toMatchObject({
      state: 'available',
      events: [{ eventKey: automatic.eventKey, scheduledAt: '2026-08-07T12:30:00.000Z', releaseTimeSource: 'convention-default' }]
    })
    expect(result.state === 'available' && result.events).toHaveLength(1)
  })

  it('coalesces current manual CPI/Core and only the Employment metrics actually covered by automatic schedules', () => {
    const automaticCpi = automaticSchedule('US.CPI.RELEASE.2026-M06', 'US.CPI.RELEASE.2026-M06', 'consumer-price-index', 'cpi')
    const automaticCore = automaticSchedule('US.CORE_CPI.RELEASE.2026-M06', 'US.CPI.RELEASE.2026-M06', 'consumer-price-index', 'core-cpi')
    const automaticNonfarm = automaticSchedule('US.NONFARM_PAYROLLS.RELEASE.2026-M06', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06', 'employment-situation', 'nonfarm-payrolls')
    const automaticUnemployment = automaticSchedule('US.UNEMPLOYMENT.RELEASE.2026-M06', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06', 'employment-situation', 'unemployment')
    const manualCpi = manualSchedule('US.CPI.RELEASE.manual', 'consumer-price-index', 'cpi')
    const manualCore = manualSchedule('US.CORE_CPI.RELEASE.manual', 'consumer-price-index', 'core-cpi')
    const manualNonfarm = manualSchedule('US.NONFARM_PAYROLLS.RELEASE.legacy', 'employment-situation', 'nonfarm-payrolls')
    const manualUnemployment = manualSchedule('US.UNEMPLOYMENT.RELEASE.legacy', 'employment-situation', 'unemployment')
    const manualAhe = manualSchedule('US.AVERAGE_HOURLY_EARNINGS.RELEASE.legacy', 'employment-situation', 'average-hourly-earnings')
    const repository = createRepository({ month: [
      manualCpi, manualCore, manualNonfarm, manualUnemployment, manualAhe,
      automaticCpi, automaticCore, automaticNonfarm, automaticUnemployment
    ] })

    const result = createMacroEconomicCalendarQueryService({ repository }).queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toMatchObject({ state: 'available' })
    const eventKeys = result.state === 'available' ? result.events.map((event) => event.eventKey) : []
    expect(eventKeys).toHaveLength(5)
    expect(eventKeys).toEqual(expect.arrayContaining([
      automaticCpi.eventKey, automaticCore.eventKey, automaticNonfarm.eventKey, automaticUnemployment.eventKey, manualAhe.eventKey
    ]))
    expect(eventKeys).not.toEqual(expect.arrayContaining([
      manualCpi.eventKey, manualCore.eventKey, manualNonfarm.eventKey, manualUnemployment.eventKey
    ]))
  })

  it('does not project obsolete manual CPI family records', () => {
    const obsoleteCpi = manualSchedule('US.CPI.RELEASE.obsolete', 'cpi', 'cpi')
    const obsoleteCore = manualSchedule('US.CORE_CPI.RELEASE.obsolete', 'core-cpi', 'core-cpi')
    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [obsoleteCpi, obsoleteCore] }) })
      .queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toEqual({ state: 'available', asOf: '2026-08-12T00:00:00.000Z', events: [] })
  })

  it('uses automatic official values to cover same-day manual ICS Employment rows after schedule revisions are superseded', () => {
    const automaticNonfarm = automaticValue(
      automaticSchedule('US.NONFARM_PAYROLLS.RELEASE.2026-M06', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06', 'employment-situation', 'nonfarm-payrolls'),
      147,
      139
    )
    const automaticUnemployment = automaticValue(
      automaticSchedule('US.UNEMPLOYMENT.RELEASE.2026-M06', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06', 'employment-situation', 'unemployment'),
      4.1,
      4.2
    )
    const automaticAhe = automaticValue(
      automaticSchedule('US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M06', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06', 'employment-situation', 'average-hourly-earnings'),
      0.3,
      0.2
    )
    const manualNonfarm = manualEmploymentValue('US.NONFARM_PAYROLLS.RELEASE.legacy-uid', 'nonfarm-payrolls')
    const manualUnemployment = manualEmploymentValue('US.UNEMPLOYMENT.RELEASE.legacy-uid', 'unemployment')
    const manualAhe = manualEmploymentValue('US.AVERAGE_HOURLY_EARNINGS.RELEASE.legacy-uid', 'average-hourly-earnings')

    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [
      manualNonfarm, manualUnemployment, manualAhe, automaticNonfarm, automaticUnemployment, automaticAhe
    ] }) }).queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toMatchObject({ state: 'available' })
    expect(result.state === 'available' && result.events.map((event) => event.eventKey)).toEqual([
      automaticNonfarm.eventKey, automaticUnemployment.eventKey, automaticAhe.eventKey
    ])
  })

  it('coalesces CPI/Core automatic schedules with their v2 values without hiding unrelated same-day events', () => {
    const cpiSchedule = automaticSchedule('US.CPI.RELEASE.2026-M07', 'US.CPI.RELEASE.2026-M07', 'consumer-price-index', 'cpi')
    const coreSchedule = automaticSchedule('US.CORE_CPI.RELEASE.2026-M07', 'US.CPI.RELEASE.2026-M07', 'consumer-price-index', 'core-cpi')
    const manualCpi = manualSchedule('US.CPI.RELEASE.manual', 'consumer-price-index', 'cpi')
    const manualCore = manualSchedule('US.CORE_CPI.RELEASE.manual', 'consumer-price-index', 'core-cpi')
    const automaticCpiValue = automaticValue(cpiSchedule, 3.1, 3)
    const automaticCoreValue = automaticValue(coreSchedule, 2.9, 2.8)
    const unrelated = revision({ eventKey: 'US.FOMC.2026-08-07.DECISION', releaseGroupKey: 'US.FOMC.2026-08-07.DECISION', scheduledDate: '2026-08-07' })
    const repository = createRepository({ detail: cpiSchedule, month: [manualCpi, automaticCpiValue, unrelated, manualCore, automaticCoreValue, cpiSchedule, coreSchedule] })
    const service = createMacroEconomicCalendarQueryService({ repository })

    const month = service.queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })
    const detail = service.getEventDetail({ eventKey: cpiSchedule.eventKey, asOf: '2026-08-12T00:00:00.000Z' })

    expect(month).toMatchObject({ state: 'available' })
    expect(month.state === 'available' && month.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: cpiSchedule.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 3.1, displayValue: '3.1%', unit: 'percent' }, previous: { numericValue: 3, displayValue: '3.0%', unit: 'percent' } }),
      expect.objectContaining({ eventKey: coreSchedule.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 2.9, displayValue: '2.9%', unit: 'percent' }, previous: { numericValue: 2.8, displayValue: '2.8%', unit: 'percent' } }),
      expect.objectContaining({ eventKey: unrelated.eventKey })
    ]))
    expect(month.state === 'available' && month.events.map((event) => event.eventKey)).not.toEqual(expect.arrayContaining([manualCpi.eventKey, manualCore.eventKey]))
    expect(detail).toMatchObject({ state: 'available', event: { eventKey: cpiSchedule.eventKey, officialReleaseDate: '2026-08-07', publishedAt: undefined, actual: { numericValue: 3.1 }, previous: { numericValue: 3 } } })
  })

  it('does not invent an official release date for an impossible or future joined schedule date', () => {
    const malformed = revision({
      eventKey: 'US.FOMC.2026-02-30', releaseGroupKey: 'US.FOMC.2026-02-30', eventFamily: 'fomc', eventNameKey: 'fomc',
      periodKey: '2026-02-30', scheduledDate: '2026-02-30', providerId: 'macro-calendar-fed',
      descriptorId: macroEconomicCalendarQueryPolicy.fedDecisionDescriptorId, revisionKind: 'official-release', lifecycleState: 'released',
      publishedAt: '2026-08-03T18:00:00.000Z', actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' }
    })
    const future = employmentValues().map((value) => ({ ...value, scheduledDate: '2026-08-07' }))
    const service = createMacroEconomicCalendarQueryService({ repository: createRepository({ detail: malformed, month: [malformed, ...future] }) })

    const malformedDetail = service.getEventDetail({ eventKey: malformed.eventKey, asOf })
    expect(malformedDetail).toMatchObject({ state: 'available' })
    expect(malformedDetail.state === 'available' && malformedDetail.event.officialReleaseDate).toBeUndefined()
    const month = service.queryMonth({ month: '2026-08', asOf })
    expect(month.state === 'available' && month.events.filter((event) => event.providerIds.includes('macro-calendar-bls'))
      .every((event) => !Object.hasOwn(event, 'officialReleaseDate'))).toBe(true)
    expect(malformedDetail.state === 'available' && malformedDetail.event.officialReleaseDate).toBeUndefined()
    expect(JSON.stringify([malformedDetail, month])).not.toContain('08:30')
  })

  it('keeps canonical manual CPI/Core rows queryable when no automatic schedule covers their metrics', () => {
    const manualCpi = manualSchedule('US.CPI.RELEASE.manual', 'consumer-price-index', 'cpi')
    const manualCore = manualSchedule('US.CORE_CPI.RELEASE.manual', 'consumer-price-index', 'core-cpi')
    const unrelated = revision({ eventKey: 'US.FOMC.2026-08-07.DECISION', scheduledDate: '2026-08-07' })
    const result = createMacroEconomicCalendarQueryService({ repository: createRepository({ month: [manualCpi, manualCore, unrelated] }) })
      .queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })

    expect(result).toMatchObject({ state: 'available' })
    expect(result.state === 'available' && result.events.map((event) => event.eventKey)).toEqual(expect.arrayContaining([
      manualCpi.eventKey, manualCore.eventKey, unrelated.eventKey
    ]))
  })

  it('keeps the frozen pre-automatic manual projection queryable by its asOf', () => {
    const automatic = automaticSchedule('US.CPI.RELEASE.2026-M07', 'US.CPI.RELEASE.2026-M07', 'consumer-price-index', 'cpi')
    const manual = manualSchedule('US.CPI.RELEASE.manual', 'consumer-price-index', 'cpi')
    const repository = createRepository()
    repository.listEffectiveMonthAsOf = ({ asOf: snapshotAsOf }) => snapshotAsOf === asOf ? [manual] : [manual, automatic]
    repository.getEffectiveEventAsOf = ({ eventKey, asOf: snapshotAsOf }) => eventKey === automatic.eventKey && snapshotAsOf !== asOf ? automatic : eventKey === manual.eventKey && snapshotAsOf === asOf ? manual : undefined
    const service = createMacroEconomicCalendarQueryService({ repository })

    expect(service.queryMonth({ month: '2026-08', asOf }).state).toEqual('available')
    expect(service.queryMonth({ month: '2026-08', asOf })).toMatchObject({ events: [expect.objectContaining({ eventKey: manual.eventKey })] })
    expect(service.queryMonth({ month: '2026-08', asOf: '2026-08-12T00:00:00.000Z' })).toMatchObject({ events: [expect.objectContaining({ eventKey: automatic.eventKey })] })
    expect(service.getEventDetail({ eventKey: manual.eventKey, asOf })).toMatchObject({ state: 'available', event: { eventKey: manual.eventKey } })
  })
})

function automaticSchedule(eventKey: string, releaseGroupKey: string, eventFamily: string, eventNameKey: string) {
  return revision({ eventKey, releaseGroupKey, eventFamily, eventNameKey, periodKey: '2026-M07', scheduledDate: '2026-08-07', providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'] })
}

function manualSchedule(eventKey: string, eventFamily: string, eventNameKey: string) {
  return revision({ eventKey, releaseGroupKey: `${eventKey}.group`, eventFamily, eventNameKey, periodKey: '2026-M07', scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z', providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.manualIcsDescriptorId, caveats: ['manual-ics-import'] })
}

function automaticValue(schedule: Record<string, unknown>, actual: number, previous: number) {
  const unit = schedule.eventNameKey === 'nonfarm-payrolls' ? 'thousands' : 'percent'
  return revision({ ...schedule, revisionId: `${schedule.eventKey}-value`, descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2', revisionKind: 'official-release', lifecycleState: 'released', actual: { numericValue: actual, displayValue: `stored-raw-${actual}`, unit }, previous: { numericValue: previous, displayValue: `stored-raw-${previous}`, unit }, caveats: ['bls-python-schedule'] })
}

function employmentValues() {
  return [
    automaticValue(automaticSchedule('US.NONFARM_PAYROLLS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'nonfarm-payrolls'), 20, -23),
    automaticValue(automaticSchedule('US.UNEMPLOYMENT.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'unemployment'), 4.1, 4.2),
    automaticValue(automaticSchedule('US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'average-hourly-earnings'), 0.05319148936169249, 0.2934115764203771)
  ]
}

function manualEmploymentValue(eventKey: string, eventNameKey: string) {
  return revision({
    eventKey,
    releaseGroupKey: `${eventKey}.group`,
    eventFamily: 'employment-situation',
    eventNameKey,
    periodKey: '2026-M06',
    scheduledDate: '2026-08-07',
    scheduledAt: '2026-08-07T12:30:00.000Z',
    providerId: 'macro-calendar-bls',
    descriptorId: macroEconomicCalendarQueryPolicy.employmentRefreshDescriptorId,
    revisionKind: 'official-release',
    lifecycleState: 'released',
    actual: { numericValue: 1, displayValue: '1', unit: 'percent' },
    previous: { numericValue: 1, displayValue: '1', unit: 'percent' },
    caveats: ['manual-ics-import']
  })
}

function createRepository(seed: { month?: any[]; detail?: any } = {}) {
  const monthCalls: Array<{ monthStart: string; monthEndExclusive: string; asOf: string; limit: number }> = []
  const detailCalls: Array<{ eventKey: string; asOf: string }> = []
  return {
    month: seed.month ?? [], detail: seed.detail,
    monthCalls, detailCalls,
    listEffectiveMonthAsOf(input: { monthStart: string; monthEndExclusive: string; asOf: string; limit: number }) { monthCalls.push(input); return this.month },
    getEffectiveEventAsOf(input: { eventKey: string; asOf: string }) { detailCalls.push(input); return this.detail }
  } as unknown as MacroCalendarRepository & { month: any[]; detail: any; monthCalls: typeof monthCalls; detailCalls: typeof detailCalls }
}

describe('the reader\'s own release time', () => {
  it('wins over both the published time and the convention, and keeps the date the reader chose', () => {
    // A published instant (12:30Z) that the reader moves to a different day entirely (13:30Z).
    const automatic = revision({
      eventKey: 'US.CORE_CPI.RELEASE.2026-M09', eventFamily: 'consumer-price-index',
      scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z',
      providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId
    })
    const editedAt = '2026-10-15T13:30:00.000Z'
    const service = createMacroEconomicCalendarQueryService({
      repository: createRepository({ month: [automatic] }),
      releaseTimeOverrides: { get: (eventKey) => eventKey === automatic.eventKey ? { scheduledAt: editedAt, scheduledDate: '2026-10-15' } : undefined }
    })
    const result = service.queryMonth({ month: '2026-10', asOf: '2026-10-16T00:00:00.000Z' })
    expect(result.state === 'available' && result.events[0]).toMatchObject({
      eventKey: automatic.eventKey,
      scheduledDate: '2026-10-15',
      scheduledAt: editedAt,
      releaseTimeSource: 'user-edited',
      // The convention we would otherwise have shown stays visible beside the edit.
      conventionScheduledAt: '2026-10-14T12:30:00.000Z'
    })
  })

  it('leaves a row on its published time when the reader has edited a different event', () => {
    const automatic = revision({
      eventKey: 'US.CORE_CPI.RELEASE.2026-M09', eventFamily: 'consumer-price-index',
      scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z',
      providerId: 'macro-calendar-bls', descriptorId: macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId
    })
    const service = createMacroEconomicCalendarQueryService({
      repository: createRepository({ month: [automatic] }),
      releaseTimeOverrides: { get: () => undefined }
    })
    const result = service.queryMonth({ month: '2026-10', asOf: '2026-10-16T00:00:00.000Z' })
    expect(result.state === 'available' && result.events[0]).toMatchObject({ scheduledAt: '2026-10-14T12:30:00.000Z', releaseTimeSource: 'official' })
  })
})

function revision(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: 'revision-1', eventKey: 'US.FOMC.2026-12-09', releaseGroupKey: 'US.FOMC.2026-12-09', eventFamily: 'fomc', eventNameKey: 'fomc', countryCode: 'US', importance: 'high', periodKey: '2026-12-09', lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-15', detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', sourceUrl: 'https://secret.example.test/source', rawRecordId: 'raw-secret', evidenceHash: 'evidence-secret', evidenceRefs: [], snapshotHash: 'snapshot-secret', parserVersion: 'parser-secret', caveats: ['official-time-not-published'], ...overrides
  }
}
