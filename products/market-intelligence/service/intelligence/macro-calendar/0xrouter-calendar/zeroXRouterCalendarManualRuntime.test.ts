import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRawRecordStore } from '../../application/rawRecordStore'
import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import { createMacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'
import { createMacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'

const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).reverse().forEach(dispose => dispose()) })
const scope = { month: '2026-09', locale: 'zh' } as const
const time = '2026-09-10T01:00:00.000Z'
async function setup(options: { enabled?: boolean; hasCredential?: boolean; evidenceReady?: boolean;
  gate?: Promise<void>; data?: unknown[]; failEndpoint?: string; pressure?: boolean } = {}) {
  expect(existsSync(new URL('./zeroXRouterCalendarManualRuntime.ts', import.meta.url)), 'manual composition is implemented').toBe(true)
  const { createZeroXRouterCalendarManualRuntime } = await import('./zeroXRouterCalendarManualRuntime')
  const directory = mkdtempSync(join(tmpdir(), 'mc-v1-manual-'))
  const database = new DatabaseSync(join(directory, 'calendar.sqlite'))
  const queue = createSourceRequestGovernanceQueue({ now: () => Date.parse(clock) })
  const rawRecords = createRawRecordStore()
  const archive = createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: join(directory, 'evidence') })
  const evidence = createMacroCalendarEvidenceStore(archive)
  let sequence = 0
  let clock = time
  const requestJsonBody = vi.fn(async (input: { url: string }) => {
    await options.gate
    if (options.failEndpoint && new URL(input.url).pathname.endsWith(options.failEndpoint)) {
      return { state: 'failed' as const, failureCode: 'response-unavailable' as const }
    }
    // Derived transport contract inputs; never used as real provider evidence or UI data.
    const body = JSON.stringify({ code: 200, msg: '', data: options.data ?? [{ calendarId: 'derived', id: 1,
      calendarName: 'Derived event', locale: 'zh', star: 3, pubTimestamp: Date.parse(time), estimateValue: 0, preValue: '2', pubValue: '3' }] })
    return { state: 'succeeded' as const, body, acceptedBytes: Buffer.byteLength(body), status: 200, contentType: 'application/json' }
  })
  const runtime = createZeroXRouterCalendarManualRuntime({ database, evidence, evidenceReady: options.evidenceReady ?? true,
    requestGovernanceQueue: queue, requestJsonBody, getApiKey: async () => 'derived-safe-key',
    readReadiness: async () => ({ enabled: options.enabled ?? true, hasCredential: options.hasCredential ?? true }),
    readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: !options.pressure }),
    now: () => new Date(clock), createCollectionId: () => `derived-${++sequence}`, cursorKey: Buffer.alloc(32, 1) })
  disposals.push(() => { database.close(); queue.close(); rmSync(directory, { recursive: true, force: true }) })
  return { runtime, database, archive, requestJsonBody, queue, rawRecords, setTime: (value: string) => { clock = value } }
}

describe('MC-V1 manual archive and SQLite composition', () => {
  it('keeps per-endpoint attempts distinct from stored success and clears a failure only after that source succeeds', async () => {
    const options = { failEndpoint: '' }
    const h = await setup(options)
    expect(await h.runtime.refreshManual(scope)).toMatchObject({ state: 'completed' })
    options.failEndpoint = 'economic-data'
    expect(await h.runtime.refreshManual(scope)).toMatchObject({ state: 'partial' })
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({
      state: 'failed', attemptedAt: time, trigger: 'manual', failureCode: 'response-unavailable' })
    expect(h.runtime.readRefreshAttempt(scope, 'financial-event')).toEqual({ state: 'succeeded', attemptedAt: time, trigger: 'manual' })
    expect(h.runtime.readRefreshAttempt({ ...scope, locale: 'en' }, 'economic-indicator')).toBeUndefined()
    expect(h.runtime.readRefreshAttempt({ ...scope, month: '2026-08' }, 'economic-indicator')).toBeUndefined()
    expect(h.database.prepare("select count(*) as n from mi_macro_calendar_market_event_observations where event_kind = 'economic-indicator'").get()?.n).toBe(1)
    options.failEndpoint = ''
    expect(await h.runtime.refreshManual(scope)).toMatchObject({ state: 'completed' })
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({ state: 'succeeded', attemptedAt: time, trigger: 'manual' })
    await h.runtime.dispose()
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toBeUndefined()
  })

  it('leaves a visible trace of a refused automatic refresh, with verdict, time and origin', async () => {
    // The automatic tick is the only thing that tries to collect when nobody pressed refresh.
    // Before this, a refused tick wrote nothing anywhere and the page showed a stale batch with
    // no way to tell "the source has nothing" from "we could not store what it sent".
    const h = await setup({ pressure: true })
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toBeUndefined()
    expect((await h.runtime.refreshAutomatic()).state).toBe('unavailable')
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({
      state: 'failed', attemptedAt: time, failureCode: 'storage-pressure', trigger: 'automatic' })
    expect(h.runtime.readRefreshAttempt(scope, 'financial-event')).toMatchObject({ state: 'failed', trigger: 'automatic' })
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(0)
    // Nothing was stored, so the verdict must not be dressed up as a successful collection.
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n).toBe(0)
  })

  it('keeps the automatic record separate and shows whichever attempt is more recent', async () => {
    const options = { failEndpoint: '' }
    const h = await setup(options)
    expect((await h.runtime.refreshManual(scope)).state).toBe('completed')
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({ state: 'succeeded', attemptedAt: time, trigger: 'manual' })
    options.failEndpoint = 'economic-data'
    h.setTime('2026-09-10T02:00:00.000Z')
    expect((await h.runtime.refreshAutomatic()).state).toBe('partial')
    // The newer automatic verdict is what the reader sees now. The manual record still exists
    // untouched: an automatic run is never written into the manual outcome (design 133).
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({
      state: 'failed', attemptedAt: '2026-09-10T02:00:00.000Z', failureCode: 'response-unavailable', trigger: 'automatic' })
    expect(h.runtime.readRefreshAttempt(scope, 'financial-event')).toEqual({
      state: 'succeeded', attemptedAt: '2026-09-10T02:00:00.000Z', trigger: 'automatic' })
    options.failEndpoint = ''
    h.setTime('2026-09-10T03:00:00.000Z')
    expect((await h.runtime.refreshManual(scope)).state).toBe('completed')
    expect(h.runtime.readRefreshAttempt(scope, 'economic-indicator')).toEqual({
      state: 'succeeded', attemptedAt: '2026-09-10T03:00:00.000Z', trigger: 'manual' })
  })
  it('archives and stores a complete 600-row month above 256 KiB without dropping economic values', async () => {
    const data = Array.from({ length: 600 }, (_, id) => ({ id: id + 1, calendarId: `derived-${id}`, locale: 'zh', star: 3, calendarName: 'Derived '.repeat(60),
      pubTimestamp: Date.parse(time), estimateValue: '0', preValue: '2', pubValue: '3' }))
    const h = await setup({ data })
    expect((await h.runtime.refreshManual(scope)).state).toBe('completed')
    expect(h.archive.inspect().committedBytes).toBeGreaterThan(256 * 1024)
    expect(h.archive.inspect().activeReservations).toBe(0)
    const row = h.database.prepare("select count(*) as n from mi_macro_calendar_market_event_observations where event_kind = 'economic-indicator' and consensus_json = ? and provider_actual_json = ?")
      .get('{"displayValue":"0"}', '{"displayValue":"3"}')
    expect(row?.n).toBe(600)
  })
  it('rejects calendar over-budget responses before archive or storage and leaves no reservations', async () => {
    const h = await setup({ data: [{ payload: 'x'.repeat(2 * 1024 * 1024) }] })
    expect((await h.runtime.refreshManual(scope)).state).toBe('unavailable')
    expect(h.archive.inspect().committedBytes).toBe(0)
    expect(h.archive.inspect().activeReservations).toBe(0)
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(0)
  })
  it('persists twenty sequential manual cycles across disposal and database reopen without automatic requests', async () => {
    const { createZeroXRouterCalendarManualRuntime } = await import('./zeroXRouterCalendarManualRuntime')
    const { createMarketCalendarPublicQueryService } = await import('./marketCalendarPublicQueryService')
    const directory = mkdtempSync(join(tmpdir(), 'mc-v1-twenty-cycles-'))
    const path = join(directory, 'calendar.sqlite')
    const rawRecords = createRawRecordStore()
    let clock = Date.parse(time)
    let sequence = 0
    const queue = createSourceRequestGovernanceQueue({ now: () => clock })
    const requestJsonBody = vi.fn(async () => {
      // Derived contract responses only. The clock advances through governance windows, never sleeps.
      const body = JSON.stringify({ code: 200, msg: '', data: [{ calendarId: 'derived', id: 1, calendarName: 'Derived lifecycle event',
        locale: 'zh', star: 3, pubTimestamp: Date.parse(time), estimateValue: 0, preValue: '2', pubValue: '3' }] })
      return { state: 'succeeded' as const, body, acceptedBytes: Buffer.byteLength(body), status: 200, contentType: 'application/json' }
    })
    const elapsed: number[] = []
    try {
      for (let cycle = 0; cycle < 20; cycle++) {
        const database = new DatabaseSync(path)
        const archive = createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: join(directory, 'evidence') })
        const runtime = createZeroXRouterCalendarManualRuntime({ database, evidence: createMacroCalendarEvidenceStore(archive), evidenceReady: true,
          requestGovernanceQueue: queue, requestJsonBody, getApiKey: async () => 'derived-safe-key',
          readReadiness: async () => ({ enabled: true, hasCredential: true }), now: () => new Date(clock),
          createCollectionId: () => `derived-cycle-${++sequence}`, cursorKey: Buffer.alloc(32, 1),
          readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
        const query = createMarketCalendarPublicQueryService({ repository: runtime.repository })
        try {
          expect(requestJsonBody).toHaveBeenCalledTimes(cycle * 3)
          const before = query.queryMonth({ ...scope, asOf: new Date(clock).toISOString() })
          expect(before).toMatchObject({ state: 'available' })
          if (before.state === 'available') expect(before.events).toHaveLength(cycle ? 3 : 0)
          const start = performance.now()
          expect((await runtime.refreshManual(scope)).state).toBe('completed')
          elapsed.push(performance.now() - start)
          expect(query.queryMonth({ ...scope, asOf: new Date(clock).toISOString() })).toMatchObject({ state: 'available',
            events: [{ consensus: { displayValue: '0' }, providerPrevious: { displayValue: '2' }, providerActual: { displayValue: '3' } }, {}, {}] })
          await runtime.dispose()
          expect(archive.inspect().activeReservations).toBe(0)
          expect((await runtime.refreshManual(scope)).state).toBe('unavailable')
          expect(requestJsonBody).toHaveBeenCalledTimes((cycle + 1) * 3)
          expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe((cycle + 1) * 3)
        } finally { await runtime.dispose(); query.dispose(); database.close() }
        clock += 60_001
      }
      const reopened = new DatabaseSync(path, { readOnly: true })
      try {
        // Twenty cycles re-observed the same three events with unchanged values: the write model
        // stores one row per event and remembers the resamples in the last-seen ledger, while
        // every batch is still recorded as its own collection.
        expect(reopened.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n).toBe(3)
        expect(reopened.prepare('select count(*) as n from mi_macro_calendar_market_observation_ledger').get()?.n).toBe(3)
        expect(reopened.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(60)
      }
      finally { reopened.close() }
      process.stdout.write(`MC-V1 derived lifecycle: ${JSON.stringify({ cycles: 20, requests: requestJsonBody.mock.calls.length,
        batchP95Ms: elapsed.toSorted((a, b) => a - b)[18] })}\n`)
    } finally { queue.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('stores three fixed endpoints in a real archive and database with independent economic values', async () => {
    const h = await setup()
    expect(h.requestJsonBody).not.toHaveBeenCalled()
    const result = await h.runtime.refreshManual(scope)
    expect(result.state).toBe('completed')
    expect(h.requestJsonBody).toHaveBeenCalledTimes(3)
    expect(h.rawRecords.listByProcessingOwner('macro-calendar', 10)).toHaveLength(3)
    expect(h.archive.inspect().activeReservations).toBe(0)
    const rows = h.database.prepare('select event_kind, consensus_json, provider_previous_json, provider_actual_json from mi_macro_calendar_market_event_observations').all()
    expect(rows).toHaveLength(3)
    expect(rows.find(row => row.event_kind === 'economic-indicator')).toMatchObject({
      consensus_json: '{"displayValue":"0"}', provider_previous_json: '{"displayValue":"2"}', provider_actual_json: '{"displayValue":"3"}' })
    expect(JSON.stringify(result)).not.toMatch(/derived-safe-key|rawRecordId|evidenceHash|sourceUrl|body|headers/)
    await h.runtime.dispose()
  })

  it.each([{ enabled: false }, { hasCredential: false }, { evidenceReady: false }])('does not request or archive with failed readiness %j', async options => {
    const h = await setup(options)
    expect((await h.runtime.refreshManual(scope)).state).toBe('unavailable')
    expect(h.requestJsonBody).not.toHaveBeenCalled()
    expect(h.archive.inspect().committedBytes).toBe(0)
  })

  it('coalesces same scope, rejects competing batches and drains before releasing the owner', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const h = await setup({ gate })
    const batch = h.runtime.refreshManual(scope)
    expect(h.runtime.refreshManual(scope)).toBe(batch)
    expect(await h.runtime.refreshManual({ ...scope, locale: 'en' })).toMatchObject({ state: 'unavailable', failureCode: 'busy' })
    await vi.waitFor(() => expect(h.requestJsonBody).toHaveBeenCalledOnce())
    let drained = false
    const stopping = h.runtime.dispose().then(() => { drained = true })
    expect((await h.runtime.refreshManual(scope)).state).toBe('unavailable')
    expect(drained).toBe(false)
    release()
    await batch
    await stopping
    expect(drained).toBe(true)
    expect(h.requestJsonBody).toHaveBeenCalledTimes(3)
    expect(h.archive.inspect().activeReservations).toBe(0)
    expect(h.database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toHaveLength(3)
    await h.runtime.dispose()
  })

  it.each([[[], 'success-empty'], [[{}], 'all-skipped']])('distinguishes successful empty and all-skipped %s', async (data, status) => {
    const h = await setup({ data: data as unknown[] })
    const result = await h.runtime.refreshManual(scope)
    expect(result.state).toBe('completed')
    expect(result.items.every(item => item.state === 'succeeded' && item.status === status)).toBe(true)
  })

  it('preserves successful sources when one endpoint fails', async () => {
    const h = await setup({ failEndpoint: 'financial-events' })
    expect((await h.runtime.refreshManual(scope)).state).toBe('partial')
    expect(h.database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toHaveLength(2)
  })
})
