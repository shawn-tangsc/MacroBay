import { describe, expect, it, vi } from 'vitest'

import { createBlsEmploymentMvpRefreshService } from './blsEmploymentMvpRefreshService'

describe('BLS calendar-family refresh service', () => {
  it('allows disjoint automatic families while rejecting a second owner of the same family', async () => {
    let releaseCpi: ((value: { state: 'response'; status: number; body: string }) => void) | undefined
    const valuesBridge = { run: vi.fn((operation: { family: 'cpi' | 'employment' }) => operation.family === 'cpi'
      ? new Promise<{ state: 'response'; status: number; body: string }>((resolve) => { releaseCpi = resolve })
      : Promise.resolve({ state: 'response' as const, status: 200, body: familyResponse('employment') })) }
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge, repository: repository([...cpiGroup(), ...employmentGroup()], vi.fn((revisions) => ({ insertedCount: revisions.length, dedupedCount: 0 }))), evidence: evidenceStore(),
      now: () => '2026-08-08T00:00:00.000Z'
    })
    const cpi = service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })
    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'unavailable' })
    const employment = service.refreshAutomatic({ family: 'employment', eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })
    releaseCpi!({ state: 'response', status: 200, body: familyResponse('cpi') })
    await expect(Promise.all([cpi, employment])).resolves.toEqual([{ state: 'updated' }, { state: 'updated' }])
    expect(valuesBridge.run).toHaveBeenCalledTimes(2)
  })

  it('rejects a same-day or accessor-backed automatic candidate before reservation or transport', async () => {
    const valuesBridge = { run: vi.fn() }
    const reserve = vi.fn()
    const service = createBlsEmploymentMvpRefreshService({ valuesBridge, repository: repository(cpiGroup(), vi.fn()), evidence: { reserve, release: vi.fn(), appendApiBody: vi.fn() } as never, now: () => '2026-08-08T00:00:00.000Z' })
    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-08', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'unavailable' })
    const hostile = { family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' }
    Object.defineProperty(hostile, 'family', { enumerable: true, get: () => 'cpi' })
    await expect(service.refreshAutomatic(hostile as never)).resolves.toEqual({ state: 'unavailable' })
    expect(reserve).not.toHaveBeenCalled()
    expect(valuesBridge.run).not.toHaveBeenCalled()
  })

  it('rejects a lock-internal family whose repository member has a mismatched event key', async () => {
    const valuesBridge = { run: vi.fn() }
    const reserve = vi.fn()
    const appendManyIfNew = vi.fn()
    const events = cpiGroup()
    const mismatchedCore = { ...events[1]!, eventKey: 'US.CORE_CPI.RELEASE.2026-M06' }
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge,
      repository: {
        getEffectiveEventAsOf: vi.fn(({ eventKey }) => eventKey === 'US.CORE_CPI.RELEASE.2026-M07' ? mismatchedCore : events.find((event) => event.eventKey === eventKey)),
        appendManyIfNew
      },
      evidence: { reserve, release: vi.fn(), appendApiBody: vi.fn() } as never,
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'unavailable' })
    expect(valuesBridge.run).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('rejects a lock-internal family whose scheduled members share a non-canonical release group key', async () => {
    const valuesBridge = { run: vi.fn() }
    const reserve = vi.fn()
    const appendManyIfNew = vi.fn()
    const events = cpiGroup().map((event) => ({ ...event, releaseGroupKey: 'US.CPI.RELEASE.2026-M06' }))
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge,
      repository: repository(events, appendManyIfNew),
      evidence: { reserve, release: vi.fn(), appendApiBody: vi.fn() } as never,
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'unavailable' })
    expect(valuesBridge.run).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('returns unchanged after acquiring the automatic family lock when the exact official family is already complete', async () => {
    const valuesBridge = { run: vi.fn() }
    const reserve = vi.fn()
    const appendManyIfNew = vi.fn()
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge,
      repository: repository(completeOfficialCpiGroup(), appendManyIfNew),
      evidence: { reserve, release: vi.fn(), appendApiBody: vi.fn() } as never,
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'unchanged' })
    expect(valuesBridge.run).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('does not treat an official family with a non-canonical value unit as current', async () => {
    const valuesBridge = { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse('cpi') })) }
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 2, dedupedCount: 0 }))
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge,
      repository: repository(completeOfficialCpiGroup().map((revision, index) => index === 0
        ? { ...revision, actual: { ...revision.actual!, unit: 'unknown-unit' } }
        : revision), appendManyIfNew),
      evidence: evidenceStore(),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refreshAutomatic({ family: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M07', period: '2026-M07', scheduledDate: '2026-08-07', workflowAsOf: '2026-08-08T00:00:00.000Z', trigger: 'schedule-latest-catch-up' })).resolves.toEqual({ state: 'updated' })
    expect(valuesBridge.run).toHaveBeenCalledOnce()
    expect(appendManyIfNew).toHaveBeenCalledOnce()
  })
  it.each([
    ['cpi', cpiGroup, 'US.CPI.RELEASE.2026-M07', 2, { kind: 'calendar-family-values', family: 'cpi', period: '2026-M07' }],
    ['employment', employmentGroup, 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', 3, { kind: 'calendar-family-values', family: 'employment', period: '2026-M07' }]
  ] as const)('requests and atomically persists the complete %s family', async (_family, createGroup, eventKey, count, operation) => {
    const events = createGroup()
    const appendManyIfNew = vi.fn(() => ({ insertedCount: count, dedupedCount: 0 }))
    const valuesBridge = { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse(operation.family) })) }
    const appendApiBody = vi.fn(() => ({ rawRecordId: 'raw-bls', evidenceHash: 'hash' }))
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge,
      repository: repository(events, appendManyIfNew),
      evidence: evidenceStore(appendApiBody),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    const result = await service.refresh({ eventKey, confirmed: true })
    expect(valuesBridge.run).toHaveBeenCalledOnce()
    expect(valuesBridge.run).toHaveBeenCalledWith(operation)
    expect(result).toEqual({ state: 'updated' })
    expect(appendApiBody).toHaveBeenCalledOnce()
    expect(appendManyIfNew).toHaveBeenCalledOnce()
    const revisions = appendManyIfNew.mock.calls[0]![0]
    expect(revisions).toHaveLength(count)
    expect(revisions).toEqual(expect.arrayContaining(operation.family === 'cpi'
      ? [
        expect.objectContaining({ eventKey: 'US.CPI.RELEASE.2026-M07', actual: expect.objectContaining({ numericValue: expect.closeTo(3.960396039603964, 10), displayValue: '4.0%', unit: 'percent' }), previous: expect.objectContaining({ numericValue: expect.closeTo(3, 10), displayValue: '3.0%', unit: 'percent' }) }),
        expect.objectContaining({ eventKey: 'US.CORE_CPI.RELEASE.2026-M07', actual: expect.objectContaining({ numericValue: expect.closeTo(2.985074626865668, 10), displayValue: '3.0%', unit: 'percent' }), previous: expect.objectContaining({ numericValue: expect.closeTo(2.499999999999991, 10), displayValue: '2.5%', unit: 'percent' }) })
      ]
      : [
        expect.objectContaining({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', actual: expect.objectContaining({ numericValue: expect.closeTo(5, 10), displayValue: '+5K', unit: 'thousands' }), previous: expect.objectContaining({ numericValue: expect.closeTo(3, 10), displayValue: '+3K', unit: 'thousands' }) }),
        expect.objectContaining({ eventKey: 'US.UNEMPLOYMENT.RELEASE.2026-M07', actual: expect.objectContaining({ numericValue: expect.closeTo(4.1, 10), displayValue: '4.1%', unit: 'percent' }), previous: expect.objectContaining({ numericValue: expect.closeTo(4.2, 10), displayValue: '4.2%', unit: 'percent' }) }),
        expect.objectContaining({ eventKey: 'US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', actual: expect.objectContaining({ numericValue: expect.closeTo(3.2258064516129004, 10), displayValue: '3.2%', unit: 'percent' }), previous: expect.objectContaining({ numericValue: expect.closeTo(3.3333333333333437, 10), displayValue: '3.3%', unit: 'percent' }) })
      ]))
  })

  it('rejects a formatter-invalid family before evidence append or any revision write', async () => {
    const appendManyIfNew = vi.fn()
    const appendApiBody = vi.fn()
    const body = familyResponse('employment').replace('"value":"108"', '"value":"108.5"')
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body })) },
      repository: repository(employmentGroup(), appendManyIfNew), evidence: evidenceStore(appendApiBody),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    expect(appendApiBody).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('does not request or write when reservation is unavailable', async () => {
    const events = employmentGroup()
    const valuesBridge = { run: vi.fn() }
    const appendManyIfNew = vi.fn()
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge, repository: repository(events, appendManyIfNew),
      evidence: { reserve: vi.fn(() => undefined), release: vi.fn(), appendApiBody: vi.fn() } as never,
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    expect(valuesBridge.run).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('returns only frozen safe result DTOs', async () => {
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn() }, repository: repository(employmentGroup(), vi.fn()), evidence: evidenceStore(),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    const result = await service.refresh({ eventKey: 'invalid', confirmed: true })
    expect(result).toEqual({ state: 'unavailable' })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('rejects incomplete family output without evidence or a partial write', async () => {
    const events = employmentGroup()
    const appendManyIfNew = vi.fn()
    const appendApiBody = vi.fn()
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse('employment').replace('CES0500000003', 'foreign') })) },
      repository: repository(events, appendManyIfNew), evidence: evidenceStore(appendApiBody),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    expect(appendApiBody).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('replaces a complete legacy two-value Employment group with the versioned three-value family', async () => {
    const events = employmentGroup().map((event, index) => index < 2
      ? { ...event, descriptorId: 'macro-calendar-bls-employment-refresh-api', revisionKind: 'official-release' as const, lifecycleState: 'released' as const }
      : event)
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 3, dedupedCount: 0 }))
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse('employment') })) },
      repository: repository(events, appendManyIfNew), evidence: evidenceStore(),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'updated' })
    expect(appendManyIfNew.mock.calls[0]![0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2' }),
      expect.objectContaining({ eventKey: 'US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07' })
    ]))
  })

  it('dedupes retained evidence after a failed SQLite transaction before a successful retry', async () => {
    const events = cpiGroup()
    const appendManyIfNew = vi.fn()
      .mockReturnValueOnce({ insertedCount: 1, dedupedCount: 0 })
      .mockReturnValueOnce({ insertedCount: 2, dedupedCount: 0 })
    const appendApiBody = vi.fn(() => ({ rawRecordId: 'raw-bls', evidenceHash: 'hash' }))
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse('cpi') })) },
      repository: repository(events, appendManyIfNew), evidence: evidenceStore(appendApiBody),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'unavailable' })
    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'updated' })
    expect(appendApiBody).toHaveBeenCalledTimes(2)
  })

  it('returns unchanged for semantically equal values with tiny floating-point differences', async () => {
    const events = cpiGroup().map((event, index) => ({
      ...event,
      descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2',
      revisionKind: 'official-release' as const,
      lifecycleState: 'released' as const,
      actual: { numericValue: index === 0 ? 3.960396039604 : 2.985074626866, displayValue: 'unchanged', unit: 'percent' },
      previous: { numericValue: index === 0 ? 3.000000000001 : 2.500000000001, displayValue: 'unchanged', unit: 'percent' }
    }))
    const appendManyIfNew = vi.fn()
    const appendApiBody = vi.fn()
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge: { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: familyResponse('cpi') })) },
      repository: repository(events, appendManyIfNew), evidence: evidenceStore(appendApiBody),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'unchanged' })
    expect(appendApiBody).not.toHaveBeenCalled()
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('refreshes a January CPI group from the complete cross-year P-13 window', async () => {
    const events = cpiGroup('2026-M01')
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 2, dedupedCount: 0 }))
    const valuesBridge = { run: vi.fn(async () => ({ state: 'response' as const, status: 200, body: januaryCpiResponse() })) }
    const service = createBlsEmploymentMvpRefreshService({
      valuesBridge, repository: repository(events, appendManyIfNew), evidence: evidenceStore(),
      now: () => '2026-08-08T00:00:00.000Z'
    })

    await expect(service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).resolves.toEqual({ state: 'updated' })
    expect(valuesBridge.run).toHaveBeenCalledWith({ kind: 'calendar-family-values', family: 'cpi', period: '2026-M01' })
    expect(appendManyIfNew).toHaveBeenCalledOnce()
  })

  it('fences a late Python child result after the public deadline', async () => {
    vi.useFakeTimers()
    try {
      let resolveChild: ((value: { state: 'response'; status: number; body: string }) => void) | undefined
      const appendManyIfNew = vi.fn(() => ({ insertedCount: 3, dedupedCount: 0 }))
      const appendApiBody = vi.fn(() => ({ rawRecordId: 'raw-bls', evidenceHash: 'hash' }))
      const service = createBlsEmploymentMvpRefreshService({
        valuesBridge: { run: vi.fn(() => new Promise((resolve) => { resolveChild = resolve })) },
        repository: repository(employmentGroup(), appendManyIfNew), evidence: evidenceStore(appendApiBody),
        now: () => '2026-08-08T00:00:00.000Z'
      })

      const result = service.refresh({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M07', confirmed: true })
      await vi.advanceTimersByTimeAsync(17_000)
      await expect(result).resolves.toEqual({ state: 'unavailable' })
      resolveChild!({ state: 'response', status: 200, body: familyResponse('employment') })
      await Promise.resolve()
      await Promise.resolve()
      expect(appendApiBody).not.toHaveBeenCalled()
      expect(appendManyIfNew).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

function repository(events: any[], appendManyIfNew: ReturnType<typeof vi.fn>) {
  return { getEffectiveEventAsOf: vi.fn(({ eventKey }) => events.find((event) => event.eventKey === eventKey)), appendManyIfNew }
}

function cpiGroup(period = '2026-M07') {
  return [
    revision(`US.CPI.RELEASE.${period}`, `US.CPI.RELEASE.${period}`, 'cpi', 'cpi', period),
    revision(`US.CORE_CPI.RELEASE.${period}`, `US.CPI.RELEASE.${period}`, 'core-cpi', 'core-cpi', period)
  ]
}

function completeOfficialCpiGroup() {
  return cpiGroup().map((event, index) => ({
    ...event,
    descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2',
    revisionKind: index === 0 ? 'official-release' as const : 'official-revision' as const,
    lifecycleState: 'released' as const,
    actual: { numericValue: index + 2, displayValue: `${index + 2}.0%`, unit: 'percent' },
    previous: { numericValue: index + 1, displayValue: `${index + 1}.0%`, unit: 'percent' }
  }))
}

function employmentGroup() {
  return [
    revision('US.NONFARM_PAYROLLS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'nonfarm-payrolls'),
    revision('US.UNEMPLOYMENT.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'unemployment'),
    revision('US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M07', 'employment-situation', 'average-hourly-earnings')
  ]
}

function revision(eventKey: string, releaseGroupKey: string, eventFamily: string, eventNameKey: string, period = '2026-M07') {
  return { eventKey, releaseGroupKey, eventFamily, eventNameKey, countryCode: 'US', importance: 'high', periodKey: period, lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-07', detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-python-schedule', sourceUrl: 'https://www.bls.gov/schedule/2026/home.htm', evidenceHash: 'schedule', evidenceRefs: [], snapshotHash: 'snapshot', parserVersion: 'bls-python-annual-schedule-v1', caveats: ['bls-python-schedule'] }
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

function januaryCpiResponse(): string {
  const data = [{ year: '2024', period: 'M12', value: '100' }, { year: '2025', period: 'M01', value: '101' }, { year: '2025', period: 'M12', value: '102' }, { year: '2026', period: 'M01', value: '104' }]
  return JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [
    { seriesID: 'CUUR0000SA0', data },
    { seriesID: 'CUUR0000SA0L1E', data }
  ] } })
}

function evidenceStore(appendApiBody = vi.fn(() => ({ rawRecordId: 'raw-bls', evidenceHash: 'hash' }))) {
  return { reserve: vi.fn(() => Object.freeze({})), release: vi.fn(() => true), appendApiBody } as never
}
