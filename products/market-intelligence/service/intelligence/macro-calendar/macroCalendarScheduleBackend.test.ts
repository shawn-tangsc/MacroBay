import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import { createMacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import { createMacroCalendarScheduleBackend } from './macroCalendarScheduleBackend'

const detectedAt = '2026-08-04T00:00:00.000Z'

describe('macroCalendarScheduleBackend', () => {
  it('closes the backend owner when borrowed repository preparation fails', () => {
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(() => { throw new Error('derived-repository-prepare') })
    try {
      expect(() => createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir() })).toThrow('derived-repository-prepare')
      expect(close).toHaveBeenCalledOnce()
    } finally { prepare.mockRestore(); close.mockRestore() }
  })

  it('exposes the same owner used by the borrowed official repository and disposes it once', () => {
    const backend = createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir() })
    expect(backend.storage).toBeDefined()
    const close = vi.spyOn(backend.storage.database, 'close')
    backend.repository.close()
    expect(backend.storage.database.prepare('select count(*) as n from mi_macro_calendar_revisions').get()?.n).toBe(0)
    backend.storage.database.exec('create table derived_market (n integer); insert into derived_market values (1)')
    expect(backend.repository.inspectStorage().rowCount).toBe(0)
    backend.dispose()
    backend.dispose()
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes its owner when a later backend dependency fails construction', () => {
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    try {
      expect(() => createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir(),
        get testProviderConnection() { throw new Error('derived-backend-construction') }
      })).toThrow('derived-backend-construction')
      expect(close).toHaveBeenCalledOnce()
    } finally { close.mockRestore() }
  })

  it('persists enabled Fed and BEA fixed schedule evidence idempotently and exposes safe health', async () => {
    const request = vi.fn(async (descriptor) => {
      const body = descriptor.descriptorId === 'macro-calendar-fed-statement'
        ? readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures/fed-press-feed-2026-08-03.xml'), 'utf8')
        : fixture(descriptor.descriptorId)
      return { ok: true as const, descriptorId: descriptor.descriptorId, status: 200, acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html' }
    })
    const requestFomcStatement = vi.fn(async () => ({ ok: false as const, descriptorId: 'macro-calendar-fed-statement-body', failureCode: 'network-request-failed' as const }))
    const backend = createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir(), request, requestFomcStatement })
    await backend.profiles.save({ providerId: 'macro-calendar-fed', enabled: true })
    await backend.profiles.save({ providerId: 'macro-calendar-bea', enabled: true })

    await backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-fed-schedule', runId: 'fed-run', detectedAt })
    await backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-bea-schedule', runId: 'bea-run', detectedAt })
    await backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-bea-schedule', runId: 'bea-replay', detectedAt })

    expect(request.mock.calls.map(([descriptor]) => descriptor.descriptorId)).toEqual([
      'macro-calendar-fed-schedule', 'macro-calendar-fed-statement',
      'macro-calendar-bea-schedule', 'macro-calendar-bea-schedule'
    ])
    expect(requestFomcStatement).toHaveBeenCalledOnce()
    expect(backend.repository.listVisibleProviderFactsAsOf({ providerIds: ['macro-calendar-fed', 'macro-calendar-bea'], asOf: detectedAt })).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule' }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.ADVANCE', periodKey: '2026-Q3' }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.SECOND', periodKey: '2026-Q3' })
    ]))
    expect(backend.healthStore.getCurrent('macro-calendar-fed')).toMatchObject({ status: 'healthy', consecutiveFailures: 0 })
    expect(backend.healthStore.getCurrent('macro-calendar-bea')).toMatchObject({ status: 'healthy', consecutiveFailures: 0 })
    backend.dispose()
  })

  it('does not request a disabled provider and closes its repository exactly once', async () => {
    const request = vi.fn()
    const backend = createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir(), request })

    await backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-fed-schedule', runId: 'disabled-run', detectedAt })
    backend.dispose()
    backend.dispose()

    expect(request).not.toHaveBeenCalled()
    expect(backend.healthStore.getCurrent('macro-calendar-fed')).toMatchObject({ status: 'paused' })
  })

  it.each(['unavailable', 'throw'] as const)('keeps schedule healthy after a decision %s', async failure => {
    const rawRecords = createRawRecordStore()
    const request = vi.fn(async (descriptor) => {
      const body = descriptor.descriptorId === 'macro-calendar-fed-statement'
        ? readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures/fed-press-feed-2026-08-03.xml'), 'utf8')
        : fixture(descriptor.descriptorId)
      return { ok: true as const, descriptorId: descriptor.descriptorId, status: 200, acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html' }
    })
    const requestFomcStatement = vi.fn(async () => {
      if (failure === 'throw') throw new Error('derived-decision-failure')
      return { ok: false as const, descriptorId: 'macro-calendar-fed-statement-body', failureCode: 'network-request-failed' as const }
    })
    const backend = createMacroCalendarScheduleBackend({
      rawRecords, dataDir: testDataDir(), request, requestFomcStatement,
      evidenceArchive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: testDataDir() })
    })
    await backend.profiles.save({ providerId: 'macro-calendar-fed', enabled: true })

    await expect(backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-fed-schedule', runId: 'fed-run', detectedAt })).resolves.toMatchObject({
      state: 'updated', healthStatus: 'healthy'
    })
    expect(request.mock.calls.map(([descriptor]) => descriptor.descriptorId)).toEqual([
      'macro-calendar-fed-schedule', 'macro-calendar-fed-statement'
    ])
    expect(requestFomcStatement).toHaveBeenCalledOnce()
    expect(backend.repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })).toMatchObject({
      revisionKind: 'schedule', actual: undefined
    })
    backend.dispose()
  })

  it('forwards the job abort signal to FOMC RSS and body requests and writes the current actual', async () => {
    const rawRecords = createRawRecordStore()
    const controller = new AbortController()
    const request = vi.fn(async (descriptor, _runAt, signal) => {
      if (descriptor.descriptorId === 'macro-calendar-fed-statement') expect(signal).toBe(controller.signal)
      const body = descriptor.descriptorId === 'macro-calendar-fed-statement'
        ? readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures/fed-press-feed-2026-08-03.xml'), 'utf8')
        : fixture(descriptor.descriptorId)
      return { ok: true as const, descriptorId: descriptor.descriptorId, status: 200, acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html' }
    })
    const requestFomcStatement = vi.fn(async (_url: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      const body = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fed-statements/fixtures/fed-fomc-decision-2026-07-29.html'), 'utf8')
      return { ok: true as const, descriptorId: 'macro-calendar-fed-statement-body', status: 200, acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html' }
    })
    const backend = createMacroCalendarScheduleBackend({
      rawRecords, dataDir: testDataDir(), request, requestFomcStatement,
      evidenceArchive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: testDataDir() })
    })
    await backend.profiles.save({ providerId: 'macro-calendar-fed', enabled: true })

    await expect(backend.health.collectAndUpdateHealth({
      descriptorId: 'macro-calendar-fed-schedule', runId: 'fed-signal-run', detectedAt, signal: controller.signal
    })).resolves.toMatchObject({ state: 'updated', healthStatus: 'healthy' })
    expect(backend.repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })?.actual).toMatchObject({
      displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75
    })
    backend.dispose()
  })

  it('does not request a decision when the Fed schedule cannot be persisted', async () => {
    const request = vi.fn(async descriptor => ({ ok: false as const, descriptorId: descriptor.descriptorId, failureCode: 'network-request-failed' as const }))
    const requestFomcStatement = vi.fn()
    const backend = createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir(), request, requestFomcStatement })
    await backend.profiles.save({ providerId: 'macro-calendar-fed', enabled: true })
    await backend.health.collectAndUpdateHealth({ descriptorId: 'macro-calendar-fed-schedule', runId: 'failed-schedule', detectedAt })
    expect(request.mock.calls.map(([descriptor]) => descriptor.descriptorId)).toEqual(['macro-calendar-fed-schedule'])
    expect(requestFomcStatement).not.toHaveBeenCalled()
    expect(backend.repository.inspectStorage().rowCount).toBe(0)
    backend.dispose()
  })

  it('composes the manual BLS ICS service without creating an HTTP request path', () => {
    const request = vi.fn()
    const backend = createMacroCalendarScheduleBackend({ rawRecords: createRawRecordStore(), dataDir: testDataDir(), request })
    const body = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/bls-ics-manual/fixtures/bls-release-schedule.ics'), 'utf8')

    expect(backend.manualBlsIcs.preview({ body, truncated: false })).toMatchObject({
      state: 'ready', supportedReleaseGroups: 46, generatedEvents: 115
    })
    expect(request).not.toHaveBeenCalled()
    backend.dispose()
  })

  it('fails every evidence-producing entry point closed when archive migration is unavailable', async () => {
    const request = vi.fn()
    const blsScheduleBridge = { run: vi.fn() }
    const backend = createMacroCalendarScheduleBackend({
      rawRecords: createRawRecordStore(),
      dataDir: testDataDir(),
      request,
      blsScheduleBridge,
      evidenceReady: false
    })
    await backend.profiles.save({ providerId: 'macro-calendar-fed', enabled: true })

    await expect(backend.health.collectAndUpdateHealth({
      descriptorId: 'macro-calendar-fed-schedule', runId: 'blocked-run', detectedAt
    })).resolves.toMatchObject({ state: 'updated', healthStatus: 'failed' })
    expect(request).not.toHaveBeenCalled()

    const body = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/bls-ics-manual/fixtures/bls-release-schedule.ics'), 'utf8')
    expect(backend.manualBlsIcs.import({ body, truncated: false })).toEqual({
      state: 'failed', failureCode: 'persistence-failed'
    })
    expect(backend.repository.inspectStorage().rowCount).toBe(0)
    expect(backend.blsEmploymentSchedule).toBeUndefined()
    expect(blsScheduleBridge.run).not.toHaveBeenCalled()
    backend.dispose()
  })

  it('tests only the requested Fed provider and returns a coarse zero-mutation result', async () => {
    const rawRecords = createRawRecordStore()
    const testProviderConnection = vi.fn(async () => ({ state: 'succeeded' as const }))
    const backend = createMacroCalendarScheduleBackend({
      rawRecords,
      dataDir: testDataDir(),
      testProviderConnection
    } as never) as unknown as {
      testProviderConnection: (providerId: unknown) => Promise<unknown>
      repository: { listVisibleProviderFactsAsOf: (input: unknown) => unknown[] }
      healthStore: { getCurrent: (providerId: string) => unknown }
      dispose: () => void
    }

    await expect(backend.testProviderConnection('macro-calendar-fed')).resolves.toEqual({ state: 'succeeded' })
    expect(testProviderConnection).toHaveBeenCalledTimes(1)
    expect(rawRecords.listSafeSummaries()).toEqual([])
    expect(backend.repository.listVisibleProviderFactsAsOf({ providerIds: ['macro-calendar-fed'], asOf: detectedAt })).toEqual([])
    expect(backend.healthStore.getCurrent('macro-calendar-fed')).toBeUndefined()
    backend.dispose()
  })

  it('redacts a non-plain provider connection result without mutating calendar state', async () => {
    const rawRecords = createRawRecordStore()
    const testProviderConnection = vi.fn(async () => Object.assign(Object.create({ inherited: 'foreign' }), { state: 'succeeded' }))
    const backend = createMacroCalendarScheduleBackend({ rawRecords, dataDir: testDataDir(), testProviderConnection } as never) as unknown as {
      testProviderConnection: (providerId: unknown) => Promise<unknown>
      repository: { listVisibleProviderFactsAsOf: (input: unknown) => unknown[] }
      healthStore: { getCurrent: (providerId: string) => unknown }
      dispose: () => void
    }

    await expect(backend.testProviderConnection('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(testProviderConnection).toHaveBeenCalledOnce()
    expect(rawRecords.listSafeSummaries()).toEqual([])
    expect(backend.repository.listVisibleProviderFactsAsOf({ providerIds: ['macro-calendar-fed'], asOf: detectedAt })).toEqual([])
    expect(backend.healthStore.getCurrent('macro-calendar-fed')).toBeUndefined()
    backend.dispose()
  })

})

function fixture(descriptorId: string): string {
  const file = descriptorId === 'macro-calendar-fed-schedule' ? 'fed-fomc-schedule-2026-08-03.html' : 'bea-release-schedule-2026-08-03.html'
  return readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures', file), 'utf8')
}

function testDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'macro-calendar-schedule-backend-'))
}
