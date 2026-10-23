import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { zeroXRouterCalendarTransportPolicy as transportPolicy } from '../../application/zeroXRouterSourcePolicy'
import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import { createZeroXRouterCalendarCollectionService } from './zeroXRouterCalendarCollectionService'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'

const descriptors = Object.keys(transportPolicy.descriptorPaths)
const input = { month: '2026-09', locale: 'zh' } as const
const completed = (descriptorId: string, locale = 'zh', month: string = input.month) => ({ state: 'succeeded', descriptorId, locale,
  month, acceptedBytes: 42,
  collection: { state: 'succeeded', status: 'success-empty', inputRows: 0, skippedRows: 0, storedRows: 0 } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function factory() {
  expect(existsSync(new URL('./zeroXRouterCalendarRefreshService.ts', import.meta.url))).toBe(true)
  return (await import('./zeroXRouterCalendarRefreshService')).createZeroXRouterCalendarRefreshService
}
async function setup() {
  const create = await factory()
  const now = vi.fn(() => new Date('2026-09-09T00:00:00.000Z'))
  const readReadiness = vi.fn(async () => ({ enabled: true, hasCredential: true }))
  const requestManual = vi.fn(async (request: { descriptorId: string; locale: string; month: string }) => completed(request.descriptorId, request.locale, request.month))
  const requestAutomatic = vi.fn(async () => descriptors.flatMap(id => transportPolicy.locales.map(locale => completed(id, locale))))
  const service = create({ now, readReadiness, collection: { requestManual, requestAutomatic } as never })
  return { service, now, readReadiness, requestManual, requestAutomatic }
}

describe('unregistered calendar refresh facade', () => {
  it.each(['storage-unavailable', 'archive-unavailable'])('retains only the safe storage failure for %s', async failureCode => {
    const h = await setup()
    h.requestManual.mockResolvedValue({ state: 'unavailable', failureCode } as never)
    expect(await h.service.refreshManual(input)).toMatchObject({ state: 'unavailable', failureCode: 'storage-unavailable' })
  })

  it('names the shared ceiling verdict on the failing source and on the batch', async () => {
    const h = await setup()
    h.requestManual.mockResolvedValue({ state: 'unavailable', failureCode: 'storage-pressure' } as never)
    const result = await h.service.refreshManual(input)
    expect(result).toMatchObject({ state: 'unavailable', failureCode: 'storage-pressure' })
    // Per source, not just per batch: the panel labels the source, and a source that was
    // refused by the ceiling must be distinguishable from one that never answered.
    expect(result.items.map(item => [item.state, item.failureCode])).toEqual(
      descriptors.map(() => ['unavailable', 'storage-pressure']))
  })
  it.each([
    ['2026-01-01T00:00:00.000Z', ['2025-12', '2026-01', '2026-02']],
    ['2024-02-29T23:59:59.000Z', ['2024-01', '2024-02', '2024-03']],
    ['2026-12-31T23:59:59.000Z', ['2026-11', '2026-12', '2027-01']]
  ])('accepts only UTC adjacent months at %s', async (instant, months) => {
    const h = await setup()
    h.now.mockReturnValue(new Date(instant))
    for (const month of months) expect((await h.service.refreshManual({ month, locale: 'en' })).state).toBe('completed')
    expect(h.requestManual.mock.calls.map(([request]) => request)).toEqual(months.flatMap(month =>
      descriptors.map(descriptorId => ({ descriptorId, month, locale: 'en' }))))
  })

  it('rejects malformed, out-of-window and extra-key input before readiness', async () => {
    const h = await setup()
    for (const value of [null, {}, [], { ...input, month: '2026-9' }, { ...input, month: '2026-13' },
      { ...input, month: '2026-07' }, { ...input, locale: 'fr' }, ...['url', 'headers', 'descriptorId', 'startTime', 'endTime'].map(key => ({ ...input, [key]: 'private' }))]) {
      expect(await h.service.refreshManual(value as never)).toEqual({ state: 'unavailable', failureCode: 'input-invalid', items: [] })
    }
    expect(h.readReadiness).not.toHaveBeenCalled()
    expect(h.requestManual).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'missing', 'throws'] as const)('dispatches nothing when readiness is %s', async state => {
    const h = await setup()
    h.readReadiness.mockImplementation(async () => {
      if (state === 'throws') throw new Error('private-credential')
      return { enabled: state !== 'disabled', hasCredential: state !== 'missing' }
    })
    for (const result of [await h.service.refreshManual(input), await h.service.refreshAutomatic()]) {
      expect(result.state).toBe('unavailable')
      expect(JSON.stringify(result)).not.toContain('private')
    }
    expect(h.requestManual).not.toHaveBeenCalled()
    expect(h.requestAutomatic).not.toHaveBeenCalled()
  })

  it('aggregates fixed descriptor/locale ordering and treats empty success as completed', async () => {
    const h = await setup()
    const manual = await h.service.refreshManual(input)
    expect(manual.state).toBe('completed')
    expect(manual.items.map(item => [item.descriptorId, item.locale])).toEqual(descriptors.map(id => [id, 'zh']))
    const auto = await h.service.refreshAutomatic()
    expect(auto.state).toBe('completed')
    expect(auto.items.map(item => [item.descriptorId, item.locale])).toEqual(descriptors.flatMap(id => [['zh', id], ['en', id]].map(([locale, descriptor]) => [descriptor, locale])))
    expect(h.requestAutomatic.mock.calls).toEqual([[descriptors]])
    expect(JSON.stringify([manual, auto])).not.toMatch(/body|acceptedBytes|evidence|rawRecord|apiKey|sourceUrl/)
  })

  it('requests only the enabled feeds on an automatic tick', async () => {
    const h = await setup()
    await h.service.refreshAutomatic(['macro-calendar-0xrouter-financial-events'])
    expect(h.requestAutomatic).toHaveBeenCalledWith(['macro-calendar-0xrouter-financial-events'])
  })

  it('maps failures by dispatch position, rejects missing/transport-only/malformed collection outcomes', async () => {
    const h = await setup()
    h.requestManual.mockImplementation(async request => request.descriptorId === descriptors[0]
      ? completed(request.descriptorId, request.locale, request.month) : { state: 'unavailable', failureCode: 'private-provider-error' } as never)
    const partial = await h.service.refreshManual(input)
    expect(partial.state).toBe('partial')
    expect(partial.items[1]).toEqual({ descriptorId: descriptors[1], locale: 'zh', state: 'unavailable' })
    const malformed = [undefined, { state: 'succeeded' }, { ...completed(descriptors[0]!), collection: undefined },
      { ...completed(descriptors[0]!), collection: { state: 'succeeded', status: 'success', inputRows: 1, skippedRows: 0, storedRows: 0 } }]
    for (const result of malformed) {
      h.requestManual.mockResolvedValue(result as never)
      expect((await h.service.refreshManual(input)).state).toBe('unavailable')
    }
    h.requestAutomatic.mockResolvedValue([completed(descriptors[0]!, 'zh')] as never)
    const incomplete = await h.service.refreshAutomatic()
    expect(incomplete.state).toBe('partial')
    expect(incomplete.items).toHaveLength(6)
    h.requestAutomatic.mockRejectedValue(new Error('private-body'))
    expect((await h.service.refreshAutomatic()).state).toBe('unavailable')
  })

  it.each(['all-wrong', 'one-wrong', 'missing'] as const)('rejects manual month mismatch: %s', async mode => {
    const h = await setup()
    h.requestManual.mockImplementation(async request => {
      const result = completed(request.descriptorId, request.locale, request.month)
      if (mode === 'missing') return { ...result, month: undefined } as never
      return { ...result, month: mode === 'all-wrong' || request.descriptorId === descriptors[1] ? '2026-08' : request.month }
    })
    const result = await h.service.refreshManual(input)
    expect(result.state).toBe(mode === 'one-wrong' ? 'partial' : 'unavailable')
    expect(result.items.map(item => item.state)).toEqual(mode === 'one-wrong'
      ? ['succeeded', 'unavailable', 'succeeded'] : ['unavailable', 'unavailable', 'unavailable'])
  })

  it('limits in-flight batch metadata to six even across month rollover and releases completed keys', async () => {
    const h = await setup()
    const gate = deferred<never>()
    h.requestManual.mockImplementation(() => gate.promise)
    const batches = ['2026-08', '2026-09', '2026-10'].flatMap(month => ['zh', 'en'].map(locale => h.service.refreshManual({ month, locale } as never)))
    expect(h.service.refreshManual(input)).toBe(batches[2])
    h.now.mockReturnValue(new Date('2026-10-01T00:00:00.000Z'))
    expect(await h.service.refreshManual({ month: '2026-11', locale: 'zh' })).toEqual({ state: 'unavailable', failureCode: 'busy', items: [] })
    gate.resolve({ state: 'unavailable' } as never)
    await Promise.all(batches)
    h.requestManual.mockImplementation(async request => completed(request.descriptorId, request.locale, request.month))
    expect((await h.service.refreshManual({ month: '2026-11', locale: 'zh' })).state).toBe('completed')
  })

  it('releases failed manual batches and preserves valid nonempty outcome counts', async () => {
    const h = await setup()
    h.requestManual.mockRejectedValue(new Error('private-body-header'))
    expect((await h.service.refreshManual(input)).state).toBe('unavailable')
    h.requestManual.mockImplementation(async request => ({ ...completed(request.descriptorId, request.locale, request.month),
      collection: { state: 'succeeded', status: 'partial', inputRows: 3, skippedRows: 1, storedRows: 2 } }))
    const next = await h.service.refreshManual(input)
    expect(next.state).toBe('completed')
    expect(next.items.every(item => item.state === 'succeeded' && item.status === 'partial' && item.storedRows === 2)).toBe(true)
    expect(h.requestManual).toHaveBeenCalledTimes(6)
  })

  it('keeps a whole manual batch single-flight after its first real collection completes, then allows a new refresh', async () => {
    const create = await factory()
    const database = new DatabaseSync(':memory:')
    const queue = createSourceRequestGovernanceQueue({ now: () => 0 })
    const gate = deferred<void>()
    let appends = 0, sequence = 0
    const now = () => new Date('2026-09-09T01:00:00.000Z')
    const requestJsonBody = vi.fn(async ({ url }: { url: string }) => {
      const body = JSON.stringify({ code: 200, msg: '', data: [{ calendarId: 'derived', id: 1, calendarName: 'Derived',
        locale: new URL(url).searchParams.get('locale'), star: 3, pubTimestamp: now().valueOf() }] })
      return { state: 'succeeded' as const, body, status: 200, contentType: 'application/json', acceptedBytes: Buffer.byteLength(body) }
    })
    const collection = createZeroXRouterCalendarCollectionService({ requestGovernanceQueue: queue, now,
      getApiKey: async () => 'derived-safe-key', requestJsonBody, createCollectionId: () => `derived-${++sequence}`,
      evidence: { reserve: () => ({}), release: () => true, append: async value => {
        if (++appends === 2) await gate.promise
        return { rawRecordId: 'derived-raw', providerId: value.descriptor.providerId, descriptorId: value.descriptor.descriptorId,
          sourceUrl: value.sourceUrl, detectedAt: value.detectedAt, evidenceHash: 'a'.repeat(64), parserVersion: value.parserVersion, inserted: true, deduped: false }
      } },
      createRepository: resolveCollectionContext => createMarketCalendarEventRepository({ database, resolveCollectionContext,
        now: () => now().toISOString(), readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
    })
    const service = create({ collection, now, readReadiness: async () => ({ enabled: true, hasCredential: true }) })
    try {
      const first = service.refreshManual(input)
      await vi.waitFor(() => expect(appends).toBe(2))
      expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(1)
      expect(service.refreshManual(input)).toBe(first)
      expect(requestJsonBody).toHaveBeenCalledTimes(2)
      gate.resolve()
      expect((await first).state).toBe('completed')
      expect(requestJsonBody).toHaveBeenCalledTimes(3)
      expect((await service.refreshManual(input)).state).toBe('completed')
      expect(requestJsonBody).toHaveBeenCalledTimes(6)
      expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(6)
    } finally { gate.resolve(); queue.close(); database.close() }
  })
})
