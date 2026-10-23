import { describe, expect, it } from 'vitest'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { projectMacroCalendarMonth } from './macroCalendarProjection'

describe('macroCalendarProjection', () => {
  it('excludes future schedule, actual, and correction snapshots at a past as-of while preserving consensus unavailability', () => {
    const result = projectMacroCalendarMonth({
      asOf: '2026-08-01T12:00:00.000Z',
      monthStart: '2026-08-01',
      monthEndExclusive: '2026-09-01',
      revisions: [
        revision({ detectedAt: '2026-08-02T00:00:00.000Z' }),
        revision({ revisionId: 'actual', detectedAt: '2026-08-03T00:00:00.000Z', lifecycleState: 'released', revisionKind: 'official-release', actual: { displayValue: '2.8%' } }),
        revision({ revisionId: 'correction', detectedAt: '2026-08-04T00:00:00.000Z', lifecycleState: 'released', revisionKind: 'official-revision', actual: { displayValue: '2.9%' } })
      ]
    })
    expect(result.events).toEqual([])

    const visible = projectMacroCalendarMonth({ asOf: '2026-08-03T00:00:00.000Z', monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', revisions: [revision(), revision({ revisionId: 'future', detectedAt: '2026-08-04T00:00:00.000Z', lifecycleState: 'released', revisionKind: 'official-release', actual: { displayValue: '2.9%' } })] })
    expect(visible.events[0]).toMatchObject({ consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', lifecycleState: 'scheduled' })
  })
})

function revision(overrides: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision {
  return { revisionId: 'schedule', eventKey: 'US.CPI.2026-07', releaseGroupKey: 'US.BLS.CPI.2026-07', eventFamily: 'cpi', eventNameKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-07', lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-02', detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-bls', descriptorId: 'fixture', sourceUrl: 'https://official.invalid', evidenceHash: 'evidence', evidenceRefs: [], snapshotHash: 'hash', parserVersion: 'fixture-v1', caveats: [], ...overrides }
}
