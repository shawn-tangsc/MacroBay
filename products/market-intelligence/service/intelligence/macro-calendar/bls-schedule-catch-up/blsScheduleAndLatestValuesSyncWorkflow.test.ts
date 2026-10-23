import { describe, expect, it, vi } from 'vitest'

import { createBlsEmploymentMvpRefreshService } from '../bls-employment-refresh/blsEmploymentMvpRefreshService'
import { createBlsScheduleAndLatestValuesSyncWorkflow } from './blsScheduleAndLatestValuesSyncWorkflow'

const groups = [
  { family: 'cpi' as const, scheduledDate: '2026-08-12', period: '2026-M07' as const, eventKey: 'US.CPI.RELEASE.2026-M07' },
  { family: 'employment' as const, scheduledDate: '2026-08-07', period: '2026-M07' as const, eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07' }
]

describe('BLS schedule and latest values workflow', () => {
  it('returns unavailable and performs no value work when schedule persistence fails', async () => {
    const refreshAutomatic = vi.fn()
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'unavailable' as const })) },
      repository: { getEffectiveEventAsOf: vi.fn() },
      refresh: { refreshAutomatic },
      now: () => '2026-08-19T00:00:00.000Z'
    })
    await expect(workflow.sync({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
    expect(refreshAutomatic).not.toHaveBeenCalled()
  })

  it('uses one frozen as-of, selects mature latest groups, and maps family outcomes in fixed order', async () => {
    const getEffectiveEventAsOf = vi.fn(() => undefined)
    const refreshAutomatic = vi.fn(async (input: { family: string }) => ({ state: input.family === 'cpi' ? 'updated' as const : 'unchanged' as const }))
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'updated' as const, groups })) },
      repository: { getEffectiveEventAsOf },
      refresh: { refreshAutomatic },
      now: () => '2026-08-19T00:00:00.000Z'
    })
    await expect(workflow.sync({ year: '2026' })).resolves.toEqual({
      state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' }
    })
    expect(refreshAutomatic).toHaveBeenCalledTimes(2)
    expect(refreshAutomatic.mock.calls.every(([input]) => input.workflowAsOf === '2026-08-19T00:00:00.000Z')).toBe(true)
  })

  it('keeps a missing CPI and Employment flow within the five exact locked reads', async () => {
    const events = [...cpiScheduleGroup(), ...employmentScheduleGroup()]
    const getEffectiveEventAsOf = vi.fn(({ eventKey }) => events.find((event) => event.eventKey === eventKey))
    const refresh = createBlsEmploymentMvpRefreshService({
      repository: { getEffectiveEventAsOf, appendManyIfNew: vi.fn((revisions) => ({ insertedCount: revisions.length, dedupedCount: 0 })) },
      valuesBridge: { run: vi.fn(async (input: { family: 'cpi' | 'employment' }) => ({ state: 'response' as const, status: 200, body: familyResponse(input.family) })) },
      evidence: { reserve: vi.fn(() => Object.freeze({})), release: vi.fn(), appendApiBody: vi.fn(() => ({ rawRecordId: 'raw', evidenceHash: 'hash' })) } as never,
      now: () => '2026-08-19T00:00:00.000Z'
    })
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'updated' as const, groups })) },
      repository: { getEffectiveEventAsOf }, refresh, now: () => '2026-08-19T00:00:00.000Z'
    })

    await workflow.sync({ year: '2026' })
    expect(getEffectiveEventAsOf).toHaveBeenCalledTimes(5)
  })

  it('does not request values for a non-current schedule year', async () => {
    const refreshAutomatic = vi.fn()
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'unchanged' as const, groups })) },
      repository: { getEffectiveEventAsOf: vi.fn() },
      refresh: { refreshAutomatic },
      now: () => '2026-08-19T00:00:00.000Z'
    })
    await expect(workflow.sync({ year: '2025' })).resolves.toEqual({ state: 'completed', schedule: 'unchanged', values: { cpi: 'not-required', employment: 'not-required' } })
    expect(refreshAutomatic).not.toHaveBeenCalled()
  })

  it('keeps a same-day date-only group immature and selects only the latest prior group', async () => {
    const refreshAutomatic = vi.fn(async () => ({ state: 'updated' as const }))
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'unchanged' as const, groups: [
        { ...groups[0]!, scheduledDate: '2026-08-19', period: '2026-M08' as const, eventKey: 'US.CPI.RELEASE.2026-M08' },
        { ...groups[0]!, scheduledDate: '2026-08-12' },
        { ...groups[0]!, scheduledDate: '2026-07-12', period: '2026-M06' as const, eventKey: 'US.CPI.RELEASE.2026-M06' }
      ] })) },
      repository: { getEffectiveEventAsOf: vi.fn() }, refresh: { refreshAutomatic }, now: () => '2026-08-19T23:59:59.999Z'
    })
    await workflow.sync({ year: '2026' })
    expect(refreshAutomatic).toHaveBeenCalledOnce()
    expect(refreshAutomatic).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-M07', scheduledDate: '2026-08-12' }))
  })

  it('isolates one family repository failure and preserves the other family result', async () => {
    const refreshAutomatic = vi.fn(async (input: { family: string }) => ({ state: input.family === 'employment' ? 'updated' as const : 'unavailable' as const }))
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'updated' as const, groups })) },
      repository: { getEffectiveEventAsOf: vi.fn(({ eventKey }) => { if (String(eventKey).includes('.CPI.')) throw new Error('private repository detail'); return undefined }) },
      refresh: { refreshAutomatic }, now: () => '2026-08-19T00:00:00.000Z'
    })
    await expect(workflow.sync({ year: '2026' })).resolves.toEqual({ state: 'completed', schedule: 'updated', values: { cpi: 'unavailable', employment: 'updated' } })
  })

  it('treats an accepted official revision family as current without an automatic correction request', async () => {
    const refreshAutomatic = vi.fn(async () => ({ state: 'unchanged' as const }))
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'unchanged' as const, groups: [groups[0]!] })) },
      repository: { getEffectiveEventAsOf: vi.fn() },
      refresh: { refreshAutomatic }, now: () => '2026-08-19T00:00:00.000Z'
    })

    await expect(workflow.sync({ year: '2026' })).resolves.toEqual({
      state: 'completed', schedule: 'unchanged', values: { cpi: 'current', employment: 'not-required' }
    })
    expect(refreshAutomatic).toHaveBeenCalledOnce()
  })

  it('does not accept a mismatched member identity as a complete current family', async () => {
    const refreshAutomatic = vi.fn(async () => ({ state: 'updated' as const }))
    const workflow = createBlsScheduleAndLatestValuesSyncWorkflow({
      schedule: { sync: vi.fn(async () => ({ state: 'completed' as const, schedule: 'unchanged' as const, groups: [groups[0]!] })) },
      repository: { getEffectiveEventAsOf: vi.fn(({ eventKey }) => completeCpiRevision(eventKey === 'US.CORE_CPI.RELEASE.2026-M07' ? 'US.CORE_CPI.RELEASE.2026-M06' : eventKey)) },
      refresh: { refreshAutomatic }, now: () => '2026-08-19T00:00:00.000Z'
    })

    await expect(workflow.sync({ year: '2026' })).resolves.toEqual({
      state: 'completed', schedule: 'unchanged', values: { cpi: 'updated', employment: 'not-required' }
    })
    expect(refreshAutomatic).toHaveBeenCalledOnce()
  })
})

function cpiScheduleGroup() {
  return [schedule('US.CPI.RELEASE.2026-M07', 'US.CPI.RELEASE.2026-M07', 'cpi', '2026-08-12'), schedule('US.CORE_CPI.RELEASE.2026-M07', 'US.CPI.RELEASE.2026-M07', 'core-cpi', '2026-08-12')]
}

function employmentScheduleGroup() {
  return [
    schedule('US.NONFARM_PAYROLLS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'nonfarm-payrolls', '2026-08-07'),
    schedule('US.UNEMPLOYMENT.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'unemployment', '2026-08-07'),
    schedule('US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'average-hourly-earnings', '2026-08-07')
  ]
}

function schedule(eventKey: string, releaseGroupKey: string, eventNameKey: string, scheduledDate: string) {
  return { eventKey, releaseGroupKey, eventFamily: 'bls', eventNameKey, countryCode: 'US', importance: 'high', periodKey: '2026-M07', lifecycleState: 'scheduled' as const, revisionKind: 'schedule' as const, scheduledDate, detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-python-schedule', sourceUrl: 'https://bls.gov', evidenceHash: 'schedule', evidenceRefs: [], snapshotHash: 'snapshot', parserVersion: 'parser', caveats: ['bls-python-schedule'] }
}

function familyResponse(family: 'cpi' | 'employment'): string {
  const series = family === 'cpi'
    ? [
      { seriesID: 'CUUR0000SA0', data: [{ year: '2025', period: 'M06', value: '100' }, { year: '2025', period: 'M07', value: '101' }, { year: '2026', period: 'M06', value: '103' }, { year: '2026', period: 'M07', value: '105' }] },
      { seriesID: 'CUUR0000SA0L1E', data: [{ year: '2025', period: 'M06', value: '200' }, { year: '2025', period: 'M07', value: '201' }, { year: '2026', period: 'M06', value: '205' }, { year: '2026', period: 'M07', value: '207' }] }
    ]
    : [
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M05', value: '100' }, { year: '2026', period: 'M06', value: '103' }, { year: '2026', period: 'M07', value: '108' }] },
      { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M05', value: '4.3' }, { year: '2026', period: 'M06', value: '4.2' }, { year: '2026', period: 'M07', value: '4.1' }] },
      { seriesID: 'CES0500000003', data: [{ year: '2026', period: 'M05', value: '30' }, { year: '2026', period: 'M06', value: '31' }, { year: '2026', period: 'M07', value: '32' }] }
    ]
  return JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series } })
}
