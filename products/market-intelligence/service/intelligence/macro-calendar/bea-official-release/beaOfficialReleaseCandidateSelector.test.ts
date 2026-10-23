import { describe, expect, it } from 'vitest'

import { selectDueBeaOfficialReleaseGroups } from './beaOfficialReleaseCandidateSelector'
import type { MacroCalendarRevision } from '../macroCalendarContracts'

const now = '2026-08-26T12:45:00.000Z'
function revision(patch: Partial<MacroCalendarRevision>): MacroCalendarRevision {
  return {
    revisionId: 'revision', eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', eventNameKey: 'pce', countryCode: 'US', importance: 'high', periodKey: '2026-07', lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule', sourceUrl: 'https://www.bea.gov/news/schedule', evidenceHash: 'schedule', evidenceRefs: [], snapshotHash: 'schedule', parserVersion: 'schedule', caveats: [], ...patch
  }
}
const core = () => revision({ revisionId: 'core', eventKey: 'US.CORE_PCE.2026-07', eventFamily: 'core-pce', eventNameKey: 'core-pce' })

describe('BEA official-release candidate selector', () => {
  it('selects an exact due PCE/Core schedule pair and an independent GDP variant', () => {
    const selected = selectDueBeaOfficialReleaseGroups({ revisions: [revision({}), core(), revision({ revisionId: 'gdp', eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', eventFamily: 'gdp', eventNameKey: 'gdp', periodKey: '2026-Q2' })], now })
    expect(selected.map((group) => group.releaseGroupKey)).toEqual(['US.BEA.GDP.2026-Q2.SECOND', 'US.BEA.PCE.2026-07'])
  })

  it('rejects incomplete PCE/Core, future, foreign, and expired schedules without fallback', () => {
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [revision({})], now })).toEqual([])
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [revision({}), core(), revision({ revisionId: 'future', eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', eventFamily: 'gdp', eventNameKey: 'gdp', periodKey: '2026-Q2', scheduledAt: '2026-08-26T13:00:00.000Z' })], now })).toEqual([{ kind: 'pce-core', releaseGroupKey: 'US.BEA.PCE.2026-07', periodKey: '2026-07', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', eventKeys: ['US.PCE.2026-07', 'US.CORE_PCE.2026-07'] }])
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [revision({}), core()], now: '2026-08-28T12:31:00.000Z' })).toEqual([])
  })

  it('treats a date-only schedule as midnight America/New_York, not midnight UTC', () => {
    const dateOnly = revision({ scheduledDate: '2026-08-27', scheduledAt: undefined })
    const dateOnlyCore = { ...core(), scheduledDate: '2026-08-27', scheduledAt: undefined }
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [dateOnly, dateOnlyCore], now: '2026-08-27T03:00:00.000Z' })).toEqual([])
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [dateOnly, dateOnlyCore], now: '2026-08-27T04:00:00.000Z' })).toHaveLength(1)
  })

  it('rejects a schedule member whose event name identity is not canonical', () => {
    expect(selectDueBeaOfficialReleaseGroups({ revisions: [revision({}), { ...core(), eventNameKey: 'wrong-name' }], now })).toEqual([])
  })
})
