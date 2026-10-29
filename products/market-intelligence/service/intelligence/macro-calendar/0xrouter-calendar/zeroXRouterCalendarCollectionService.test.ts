import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import type { MarketCollectionContext } from './marketCalendarStorageValidation'
import type { MacroCalendarEvidenceAppendInput } from '../macroCalendarEvidenceStore'

const descriptorId = 'macro-calendar-0xrouter-economic-data'
const request = { descriptorId, month: '2026-09', locale: 'zh' } as const
const receivedAt = '2026-09-09T01:02:03.000Z'
const row = { calendarId: 'derived', id: 1, calendarName: 'Derived contract event', star: 3,
  pubTimestamp: Date.parse(receivedAt), estimateValue: '0', preValue: '2', fixPreValue: '3', pubValue: '4' }
const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()) })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function setup(options: { data?: unknown[]; archiveGate?: Promise<void>; writeGate?: Promise<void>;
  failure?: 'reserve' | 'archive' | 'write' | 'parse' | 'reference'; credential?: string
  rejectWrite?: 'storage-pressure' | 'row-too-large' } = {}) {
  expect(existsSync(new URL('./zeroXRouterCalendarCollectionService.ts', import.meta.url))).toBe(true)
  const { createZeroXRouterCalendarCollectionService } = await import('./zeroXRouterCalendarCollectionService')
  const database = new DatabaseSync(':memory:')
  const queue = createSourceRequestGovernanceQueue({ now: () => 0 })
  disposals.push(() => { database.close(); queue.close() })
  const events: string[] = []
  const reservations = new Set<object>()
  let resolver!: (id: string) => MarketCollectionContext | undefined
  let collectionSequence = 0
  let time = receivedAt
  const evidence = {
    reserve: vi.fn(() => { if (options.failure === 'reserve') return undefined; const ticket = {}; reservations.add(ticket); return ticket }),
    release: vi.fn((ticket: object) => reservations.delete(ticket)),
    append: vi.fn(async (input: MacroCalendarEvidenceAppendInput) => {
      events.push('archive')
      await options.archiveGate
      if (options.failure === 'archive') throw new Error('private-body-key-query')
      return { providerId: 'macro-calendar-0xrouter' as const,
        descriptorId: options.failure === 'reference' ? 'macro-calendar-0xrouter-financial-events' as const : input.descriptor.descriptorId,
        rawRecordId: 'derived-raw', evidenceHash: 'a'.repeat(64), detectedAt: '2020-01-01T00:00:00.000Z',
        sourceUrl: input.sourceUrl, parserVersion: input.parserVersion, inserted: false, deduped: true }
    })
  }
  const requestJsonBody = vi.fn(async (input: { url: string }) => {
    events.push('network')
    const data = (options.data ?? (options.failure === 'parse' ? [row, row] : [row])).map(value =>
      value && typeof value === 'object' ? { ...value, locale: new URL(input.url).searchParams.get('locale') } : value)
    const body = JSON.stringify({ code: 200, msg: 'private-provider-message', data })
    return { state: 'succeeded' as const, body, status: 200, contentType: 'application/json', acceptedBytes: Buffer.byteLength(body) }
  })
  const service = createZeroXRouterCalendarCollectionService({ requestGovernanceQueue: queue,
    getApiKey: async () => options.credential ?? 'safe-derived-key', requestJsonBody, evidence,
    now: () => new Date(time), createCollectionId: () => `derived-collection-${++collectionSequence}`,
    createRepository: resolve => {
      resolver = resolve
      const repository = createMarketCalendarEventRepository({ database, resolveCollectionContext: resolve,
        now: () => time, readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
      return { appendCollection: async input => {
        events.push('write')
        await options.writeGate
        if (options.failure === 'write') throw new Error('private-sqlite-body-key')
        if (options.rejectWrite) return { state: 'unavailable' as const, failureCode: options.rejectWrite }
        return repository.appendCollection(input)
      } }
    }
  })
  return { service, database, evidence, requestJsonBody, events, reservations, resolver: (id: string) => resolver(id),
    setTime: (value: string) => { time = value } }
}

describe('unregistered calendar complete collection unit (derived contracts)', () => {
  it.each(['archiveGate', 'writeGate'] as const)('waits for %s before the next network and clears the context/reservation', async gateName => {
    const gate = deferred()
    const h = await setup({ [gateName]: gate.promise })
    const first = h.service.requestManual(request)
    const second = h.service.requestManual({ ...request, locale: 'en' })
    await vi.waitFor(() => expect(h.events).toContain(gateName === 'archiveGate' ? 'archive' : 'write'))
    expect(h.requestJsonBody).toHaveBeenCalledOnce()
    expect(h.service.requestManual(request)).toBe(first)
    expect(h.resolver('unrelated')).toBeUndefined()
    if (gateName === 'writeGate') expect(h.resolver('derived-collection-1')?.detectedAt).toBe(receivedAt)
    gate.resolve()
    expect((await first).state).toBe('succeeded')
    expect((await second).state).toBe('succeeded')
    expect(h.events).toEqual(['network', 'archive', 'write', 'network', 'archive', 'write'])
    expect(h.reservations.size).toBe(0)
    expect(h.resolver('derived-collection-1')).toBeUndefined()
    expect(h.resolver('derived-collection-2')).toBeUndefined()
  })

  it.each(['economic-data', 'financial-events', 'central-bank-activities'] as const)('routes %s through MC2 into real SQLite without leaking source data', async endpoint => {
    const h = await setup()
    const result = await h.service.requestManual({ ...request, descriptorId: `macro-calendar-0xrouter-${endpoint}` })
    expect(result).toMatchObject({ state: 'succeeded', collection: { status: 'success', inputRows: 1, skippedRows: 0, storedRows: 1 } })
    const stored = h.database.prepare('select * from mi_macro_calendar_market_event_observations').get()!
    expect(stored.descriptor_id).toBe(`macro-calendar-0xrouter-${endpoint}`)
    expect(stored.consensus_json).toBe(endpoint === 'economic-data' ? '{"displayValue":"0"}' : null)
    expect(stored.provider_previous_json).toBe(endpoint === 'economic-data' ? '{"displayValue":"3"}' : null)
    expect(stored.provider_actual_json).toBe(endpoint === 'economic-data' ? '{"displayValue":"4"}' : null)
    expect(JSON.stringify(result)).not.toMatch(/private|derived-raw|evidenceHash|body|sourceUrl|header|apiKey/)
  })

  it.each([[[], 'success-empty', 0], [[{}], 'all-skipped', 1], [[{}, row], 'partial', 1]] as const)('retains successful state %s', async (data, status, skippedRows) => {
    const h = await setup({ data: [...data] })
    expect(await h.service.requestManual(request)).toMatchObject({ state: 'succeeded', collection: { status, skippedRows } })
    expect(h.database.prepare('select status from mi_macro_calendar_market_event_collections').get()?.status).toBe(status)
  })

  it.each(['reserve', 'archive', 'write', 'parse', 'reference'] as const)('fails safely and releases %s resources before continuing', async failure => {
    const h = await setup({ failure })
    const results = await Promise.all([h.service.requestManual(request), h.service.requestManual({ ...request, locale: 'en' })])
    expect(results.every(result => result.state === 'unavailable')).toBe(true)
    expect(JSON.stringify(results)).not.toMatch(/private|derived-raw|body|sourceUrl|header|apiKey/)
    expect(h.requestJsonBody).toHaveBeenCalledTimes(2)
    expect(h.database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(0)
    expect(h.reservations.size).toBe(0)
    expect(h.resolver('derived-collection-1')).toBeUndefined()
    expect(h.resolver('derived-collection-2')).toBeUndefined()
    if (failure === 'reserve') expect(h.evidence.append).not.toHaveBeenCalled()
  })

  it('reports the storage ceiling verdict as storage-pressure, not as a generic storage failure', async () => {
    const h = await setup({ rejectWrite: 'storage-pressure' })
    const result = await h.service.requestManual(request)
    // The panel can only say "storage limited" if this exact verdict reaches it.
    expect(result).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(JSON.stringify(result)).not.toMatch(/private|derived-raw|evidenceHash|body|sourceUrl|header|apiKey/)
    expect(h.database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(0)
  })

  it('does not promote an unrelated repository verdict into a storage-ceiling claim', async () => {
    const h = await setup({ rejectWrite: 'row-too-large' })
    expect(await h.service.requestManual(request)).toEqual({ state: 'unavailable', failureCode: 'storage-unavailable' })
  })

  it('keeps a new collection and receipt time for identical archived body', async () => {
    const h = await setup()
    await h.service.requestManual(request)
    h.setTime('2026-09-09T02:00:00.000Z')
    await h.service.requestManual(request)
    const rows = h.database.prepare('select collection_id, detected_at, raw_record_id from mi_macro_calendar_market_event_collections order by collection_sequence').all()
    expect(rows).toEqual([
      { collection_id: 'derived-collection-1', detected_at: receivedAt, raw_record_id: 'derived-raw' },
      { collection_id: 'derived-collection-2', detected_at: '2026-09-09T02:00:00.000Z', raw_record_id: 'derived-raw' }
    ])
  })

  it('uses receipt time even if archive ACK arrives later, then retains archive evidence on SQLite rollback', async () => {
    const gate = deferred()
    const h = await setup({ archiveGate: gate.promise })
    const first = h.service.requestManual(request)
    await vi.waitFor(() => expect(h.evidence.append).toHaveBeenCalledOnce())
    h.setTime('2026-09-09T03:00:00.000Z')
    gate.resolve()
    expect((await first).state).toBe('succeeded')
    expect(h.database.prepare('select detected_at, recorded_at from mi_macro_calendar_market_event_collections').get()).toEqual({
      detected_at: receivedAt, recorded_at: '2026-09-09T03:00:00.000Z'
    })
    // The second cycle re-observes the same unchanged event, so it stores no observation row of
    // its own; the failure is injected on the collection row the write model always writes.
    h.database.exec("create trigger derived_failure before insert on mi_macro_calendar_market_event_collections begin select raise(abort, 'derived-private-sqlite'); end")
    expect(await h.service.requestManual(request)).toEqual({ state: 'unavailable', failureCode: 'storage-unavailable' })
    expect(h.evidence.append).toHaveBeenCalledTimes(2)
    expect(h.database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(1)
    expect(h.resolver('derived-collection-2')).toBeUndefined()
    expect(h.reservations.size).toBe(0)
  })

  it('deduplicates the automatic batch while the bound consumer archives every endpoint and locale', async () => {
    const h = await setup()
    const batch = h.service.requestAutomatic()
    expect(h.service.requestAutomatic()).toBe(batch)
    const { results } = await batch
    expect(results).toHaveLength(6)
    expect(results.every(result => result.state === 'succeeded')).toBe(true)
    expect(h.evidence.append).toHaveBeenCalledTimes(6)
    expect(h.database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(6)
    expect(h.reservations.size).toBe(0)
  })

  it('does not request, reserve or write without a credential', async () => {
    const h = await setup({ credential: '' })
    expect(await h.service.requestManual(request)).toEqual({ state: 'unavailable', failureCode: 'credential-not-configured' })
    expect(h.events).toEqual([])
    expect(h.evidence.reserve).not.toHaveBeenCalled()
  })
})
