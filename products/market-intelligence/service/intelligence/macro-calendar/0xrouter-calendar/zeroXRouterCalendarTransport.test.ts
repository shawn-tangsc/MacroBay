import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import { zeroXRouterSourcePolicy } from '../../application/zeroXRouterSourcePolicy'
import { createZeroXRouterCalendarTransport, zeroXRouterCalendarPrefetchMonth, zeroXRouterCalendarPrefetchOwner } from './zeroXRouterCalendarTransport'

const apiKey = 'safe-test-key'
const acceptedBody = JSON.stringify({ code: 200, msg: 'ok', data: [] })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function createScheduledHarness() {
  const queue = createSourceRequestGovernanceQueue({ now: () => Date.parse('2026-09-07T01:02:03.000Z') })
  const enqueue = vi.fn(queue.enqueue)
  const responses: ReturnType<typeof deferred<unknown>>[] = []
  const harness = createHarness({
    queue: { enqueue },
    now: () => new Date('2026-09-07T01:02:03.000Z'),
    requestJsonBody: async () => {
      const response = deferred<unknown>()
      responses.push(response)
      return response.promise
    }
  })
  return {
    ...harness, enqueue, queue,
    async complete(index: number, failed = false) {
      await vi.waitFor(() => expect(responses.length).toBeGreaterThan(index))
      responses[index]!.resolve(failed ? { state: 'failed', failureCode: 'response-unavailable' } : {
        state: 'succeeded', body: acceptedBody, acceptedBytes: Buffer.byteLength(acceptedBody),
        status: 200, contentType: 'application/json'
      })
    }
  }
}

function createHarness(options: {
  apiKey?: string
  requestJsonBody?: (input: unknown) => Promise<unknown>
  now?: () => Date
  queue?: { enqueue: (input: unknown) => Promise<unknown> }
  consumeAcceptedResponse?: Parameters<typeof createZeroXRouterCalendarTransport>[0]['consumeAcceptedResponse']
} = {}) {
  const requestJsonBody = vi.fn(options.requestJsonBody ?? (async () => ({
    state: 'succeeded' as const,
    body: acceptedBody,
    acceptedBytes: Buffer.byteLength(acceptedBody),
    status: 200,
    contentType: 'application/json'
  })))
  const queue = options.queue ?? createSourceRequestGovernanceQueue({ now: () => Date.parse('2026-09-07T01:02:03.000Z') })
  return {
    requestJsonBody,
    transport: createZeroXRouterCalendarTransport({
      requestGovernanceQueue: queue as never,
      getApiKey: async () => options.apiKey === undefined ? apiKey : options.apiKey,
      requestJsonBody: requestJsonBody as never,
      now: options.now,
      consumeAcceptedResponse: options.consumeAcceptedResponse
    })
  }
}

describe('0xRouter calendar transport', () => {
  it('accepts a complete calendar month above the generic 256 KiB cap through the real bounded transport', async () => {
    // Derived contract data, not a provider fixture. No body is printed on failure.
    const body = JSON.stringify({ code: 200, msg: '', data: Array.from({ length: 600 }, (_, id) => ({
      id, calendarId: id, calendarName: 'Derived '.repeat(60), pubTimestamp: Date.parse('2026-09-15T00:00:00.000Z')
    })) })
    expect(Buffer.byteLength(body)).toBeGreaterThan(256 * 1024)
    platformFetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } }))
    const queue = createSourceRequestGovernanceQueue({ now: Date.now })
    let consumedBytes = 0
    const transport = createZeroXRouterCalendarTransport({ requestGovernanceQueue: queue, getApiKey: async () => apiKey,
      consumeAcceptedResponse: async response => { consumedBytes = response.acceptedBytes } })
    try {
      const result = await transport.requestManual({ descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh' })
      expect(result.state).toBe('succeeded')
      expect(consumedBytes).toBe(Buffer.byteLength(body))
    } finally { queue.close(); platformFetch.mockReset() }
  })
  it('holds the current key and next network request until consumer ACK, including a failed ACK', async () => {
    const ack = deferred<void>()
    const consume = vi.fn(async () => { await ack.promise; throw new Error('private-body-key') })
    const { transport, requestJsonBody } = createHarness({ consumeAcceptedResponse: consume })
    const input = { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh' } as const
    const first = transport.requestManual(input)
    const second = transport.requestManual({ ...input, locale: 'en' })
    await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce())
    expect(requestJsonBody).toHaveBeenCalledOnce()
    expect(transport.requestManual(input)).toBe(first)
    ack.resolve()
    expect(await first).toEqual({ state: 'unavailable', failureCode: 'response-unavailable' })
    await second
    expect(requestJsonBody).toHaveBeenCalledTimes(2)
  })

  it.each(['storage-pressure', 'storage-unavailable', 'archive-unavailable', 'parse-unavailable'] as const)(
    'forwards the consumer storage verdict %s instead of replacing it', async failureCode => {
      // A refused write is the one signal the calendar panel can act on, so the exact
      // verdict has to survive this seam rather than arriving as `response-unavailable`.
      const { transport } = createHarness({ consumeAcceptedResponse: async () => ({ state: 'unavailable', failureCode }) })
      expect(await transport.requestManual({ descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh' }))
        .toEqual({ state: 'unavailable', failureCode })
    })

  it('folds a consumer verdict outside the wire vocabulary into response-unavailable', async () => {
    const { transport } = createHarness({ consumeAcceptedResponse: async () => ({ state: 'unavailable', failureCode: 'private-verdict' }) as never })
    expect(await transport.requestManual({ descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh' }))
      .toEqual({ state: 'unavailable', failureCode: 'response-unavailable' })
  })

  it('captures receipt UTC once before consumer work and returns no accepted body', async () => {
    const now = vi.fn(() => new Date('2026-09-09T01:02:03.000Z'))
    let receipt: string | undefined
    const { transport } = createHarness({ now, consumeAcceptedResponse: async input => {
      receipt = input.detectedAt
      now.mockReturnValue(new Date('2026-09-10T00:00:00.000Z'))
    } })
    const result = await transport.requestManual({ descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh' })
    expect(receipt).toBe('2026-09-09T01:02:03.000Z')
    expect(now).toHaveBeenCalledOnce()
    expect(result).toEqual({ state: 'succeeded', descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh', acceptedBytes: Buffer.byteLength(acceptedBody) })
  })

  it('derives the only fixed endpoint and canonical UTC month range after queue admission', async () => {
    const { transport, requestJsonBody } = createHarness()

    await expect(transport.requestManual({
      descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'en'
    })).resolves.toMatchObject({
      state: 'succeeded',
      descriptorId: 'macro-calendar-0xrouter-economic-data',
      month: '2026-09',
      locale: 'en',
      acceptedBytes: Buffer.byteLength(acceptedBody)
    })

    const request = requestJsonBody.mock.calls[0]?.[0] as { url: string; apiKey: string }
    const url = new URL(request.url)
    expect(url.pathname).toBe('/cexdata/calendar/economic-data')
    expect([...url.searchParams.keys()].sort()).toEqual(['endTime', 'locale', 'startTime'])
    expect(url.searchParams.get('locale')).toBe('en')
    expect(url.searchParams.get('startTime')).toBe(String(Date.UTC(2026, 8, 1)))
    expect(url.searchParams.get('endTime')).toBe(String(Date.UTC(2026, 9, 1) - 1))
    expect(request.apiKey).toBe(apiKey)
  })

  it('rejects caller transport controls and invalid manual inputs before queue or transport', async () => {
    const { transport, requestJsonBody } = createHarness()
    const invalid = [
      { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-13', locale: 'zh' },
      { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'fr' },
      { descriptorId: 'macro-calendar-0xrouter-forged', month: '2026-09', locale: 'zh' },
      { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh', url: 'https://private.invalid' },
      { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh', headers: { authorization: 'private' } },
      { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh', startTime: 0 }
    ]

    for (const input of invalid) {
      await expect(transport.requestManual(input as never)).resolves.toEqual({ state: 'unavailable', failureCode: 'input-invalid' })
    }
    expect(requestJsonBody).not.toHaveBeenCalled()
  })

  it('fails closed for unsafe credentials and redirect, MIME, body, or error-envelope transport output', async () => {
    const noCredential = createHarness({ apiKey: '' })
    await expect(noCredential.transport.requestManual({
      descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh'
    })).resolves.toEqual({ state: 'unavailable', failureCode: 'credential-not-configured' })
    expect(noCredential.requestJsonBody).not.toHaveBeenCalled()

    for (const response of [
      { state: 'succeeded', body: acceptedBody, acceptedBytes: 1, status: 302, contentType: 'application/json' },
      { state: 'succeeded', body: acceptedBody, acceptedBytes: 1, status: 200, contentType: 'text/html' },
      { state: 'succeeded', body: JSON.stringify({ code: 500, msg: 'redacted', data: [] }), acceptedBytes: 1, status: 200, contentType: 'application/json' },
      { state: 'failed', failureCode: 'response-unavailable' }
    ]) {
      const { transport } = createHarness({ requestJsonBody: async () => response })
      await expect(transport.requestManual({
        descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-09', locale: 'zh'
      })).resolves.toEqual({ state: 'unavailable', failureCode: 'response-unavailable' })
    }
  })

  it('coalesces identical in-flight work and identifies manual work as user intent for the shared queue', async () => {
    let resolve!: (value: unknown) => void
    const bodyPending = new Promise<unknown>((done) => { resolve = done })
    const queueCalls: Array<{ intent?: string }> = []
    const queue = {
      enqueue: async (input: { intent?: string; run: () => Promise<unknown> }) => {
        queueCalls.push({ intent: input.intent })
        return input.run()
      }
    }
    const { transport, requestJsonBody } = createHarness({ queue, requestJsonBody: async () => bodyPending })
    const input = { descriptorId: 'macro-calendar-0xrouter-financial-events', month: '2026-09', locale: 'zh' } as const
    const first = transport.requestManual(input)
    const second = transport.requestManual(input)

    await Promise.resolve()
    expect(queueCalls).toEqual([{ intent: 'user' }])
    expect(requestJsonBody).toHaveBeenCalledOnce()
    resolve({ state: 'succeeded', body: acceptedBody, acceptedBytes: Buffer.byteLength(acceptedBody), status: 200, contentType: 'application/json' })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: 'succeeded' }),
      expect.objectContaining({ state: 'succeeded' })
    ])
  })

  it('derives all automatic work from the current UTC month without accepting caller input', async () => {
    const { transport, requestJsonBody } = createHarness({ now: () => new Date('2026-09-07T01:02:03.000Z') })
    const batch = await transport.requestAutomatic()
    expect(batch.results).toEqual(Array.from({ length: 6 }, () => expect.objectContaining({ state: 'succeeded', month: '2026-09' })))
    expect(batch.scopes).toHaveLength(6)
    expect(new Set(batch.scopes.map(scope => scope.month))).toEqual(new Set(['2026-09']))
    expect(requestJsonBody).toHaveBeenCalledTimes(6)
  })

  it('submits automatic work stepwise and submits a waiting manual request next', async () => {
    const { transport, enqueue, requestJsonBody, complete } = createScheduledHarness()
    const automatic = transport.requestAutomatic()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled())
    expect(enqueue).toHaveBeenCalledTimes(1)
    const manual = transport.requestManual({
      descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-08', locale: 'zh'
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    await complete(0)
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls[1]![0].intent).toBe('user')
    const url = new URL((requestJsonBody.mock.calls[1]![0] as { url: string }).url)
    expect(url.searchParams.get('startTime')).toBe(String(Date.UTC(2026, 7, 1)))
    for (let index = 1; index < 7; index += 1) await complete(index)
    await expect(manual).resolves.toMatchObject({ state: 'succeeded', month: '2026-08' })
    await expect(automatic).resolves.toMatchObject({ results: expect.any(Array) })
    expect((await automatic).results).toHaveLength(6)
    expect(enqueue).toHaveBeenCalledTimes(7)
  })

  it('promotes the same local automatic key and shares its result without preempting active work', async () => {
    const { transport, enqueue, requestJsonBody, complete } = createScheduledHarness()
    const automatic = transport.requestAutomatic()
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled())
    const input = { descriptorId: 'macro-calendar-0xrouter-central-bank-activities', month: '2026-09', locale: 'en' } as const
    const manual = transport.requestManual(input)
    expect(transport.requestManual(input)).toBe(manual)
    expect(enqueue).toHaveBeenCalledTimes(1)
    await complete(0)
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(enqueue.mock.calls.map(([entry]) => entry.intent)).toEqual(['automatic', 'user'])
    const url = new URL((requestJsonBody.mock.calls[1]![0] as { url: string }).url)
    expect(url.pathname).toBe('/cexdata/calendar/central-bank-activities')
    expect(url.searchParams.get('locale')).toBe('en')
    for (let index = 1; index < 6; index += 1) await complete(index)
    const { results } = await automatic
    expect(await manual).toBe(results[5])
    expect(enqueue).toHaveBeenCalledTimes(6)
  })

  it('reuses the entire unfinished automatic batch even after its prefix completes', async () => {
    const { transport, enqueue, complete } = createScheduledHarness()
    const first = transport.requestAutomatic()
    expect(transport.requestAutomatic()).toBe(first)
    await complete(0)
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2))
    expect(transport.requestAutomatic()).toBe(first)
    for (let index = 1; index < 6; index += 1) await complete(index)
    await expect(first).resolves.toMatchObject({ results: expect.any(Array) })
    expect((await first).results).toHaveLength(6)
    expect(enqueue).toHaveBeenCalledTimes(6)
  })

  it('derives the prefetch month and owner only at month end', () => {
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-09-27T00:00:00.000Z'))).toBeUndefined()
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-09-28T00:00:00.000Z'))).toBe('2026-10')
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-09-30T23:59:59.000Z'))).toBe('2026-10')
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-02-25T00:00:00.000Z'))).toBeUndefined()
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-02-26T00:00:00.000Z'))).toBe('2026-03')
    expect(zeroXRouterCalendarPrefetchMonth(new Date('2026-12-31T00:00:00.000Z'))).toBe('2027-01')
    // Fixed rotation: the hour names one feed, so the extra two requests never come from all three.
    expect(zeroXRouterCalendarPrefetchOwner(new Date('2026-09-29T00:10:00.000Z'))).toBe('macro-calendar-0xrouter-financial-events')
    expect(zeroXRouterCalendarPrefetchOwner(new Date('2026-09-29T01:10:00.000Z'))).toBe('macro-calendar-0xrouter-central-bank-activities')
    expect(zeroXRouterCalendarPrefetchOwner(new Date('2026-09-29T02:10:00.000Z'))).toBe('macro-calendar-0xrouter-economic-data')
    // The day is part of the slot: the same hour tomorrow belongs to the next feed.
    expect(zeroXRouterCalendarPrefetchOwner(new Date('2026-09-30T01:10:00.000Z'))).toBe('macro-calendar-0xrouter-economic-data')
  })

  it('prefetches the next UTC month for the hour feed inside the end-of-month window', async () => {
    const { transport, requestJsonBody } = createHarness({ now: () => new Date('2026-09-29T01:02:03.000Z') })
    const batch = await transport.requestAutomatic()
    // Six current-month rows plus two for the one owner feed: still inside ten per minute.
    expect(batch.scopes).toHaveLength(8)
    expect(batch.results).toHaveLength(8)
    expect(batch.scopes.filter(scope => scope.month === '2026-10').map(scope => [scope.descriptorId, scope.locale])).toEqual([
      ['macro-calendar-0xrouter-central-bank-activities', 'zh'],
      ['macro-calendar-0xrouter-central-bank-activities', 'en']
    ])
    expect(requestJsonBody).toHaveBeenCalledTimes(8)
    const nextMonthUrl = new URL((requestJsonBody.mock.calls[6]![0] as { url: string }).url)
    expect(nextMonthUrl.searchParams.get('startTime')).toBe(String(Date.UTC(2026, 9, 1)))
    expect(nextMonthUrl.searchParams.get('locale')).toBe('zh')
  })

  it('collects the prefetched month once and keeps the current month on every tick', async () => {
    const { transport, requestJsonBody } = createHarness({ now: () => new Date('2026-09-29T01:02:03.000Z'), queue: { enqueue: async (entry) => (entry as { run: () => Promise<unknown> }).run() } })
    await transport.requestAutomatic()
    const second = await transport.requestAutomatic()
    expect(second.scopes).toHaveLength(6)
    expect(new Set(second.scopes.map(scope => scope.month))).toEqual(new Set(['2026-09']))
    expect(requestJsonBody).toHaveBeenCalledTimes(14)
  })

  it('asks again for a prefetched month that did not succeed', async () => {
    const requestJsonBody = vi.fn(async ({ url }: { url: string }) => new URL(url).searchParams.get('startTime') === String(Date.UTC(2026, 9, 1))
      ? { state: 'failed' as const, failureCode: 'response-unavailable' as const }
      : { state: 'succeeded' as const, body: acceptedBody, acceptedBytes: Buffer.byteLength(acceptedBody), status: 200, contentType: 'application/json' })
    const { transport } = createHarness({ now: () => new Date('2026-09-29T01:02:03.000Z'), requestJsonBody,
      queue: { enqueue: async (entry) => (entry as { run: () => Promise<unknown> }).run() } })
    await transport.requestAutomatic()
    const retry = await transport.requestAutomatic()
    expect(retry.scopes.filter(scope => scope.month === '2026-10')).toHaveLength(2)
    expect(requestJsonBody).toHaveBeenCalledTimes(16)
  })

  it('keeps a separate in-flight batch per requested descriptor set', async () => {
    const { transport } = createHarness({ now: () => new Date('2026-09-07T01:02:03.000Z') })
    const economic = transport.requestAutomatic(['macro-calendar-0xrouter-economic-data'])
    const financial = transport.requestAutomatic(['macro-calendar-0xrouter-financial-events'])
    expect(economic).not.toBe(financial)
    expect((await economic).scopes.every(scope => scope.descriptorId === 'macro-calendar-0xrouter-economic-data')).toBe(true)
    expect((await financial).scopes.every(scope => scope.descriptorId === 'macro-calendar-0xrouter-financial-events')).toBe(true)
  })

  it('continues local work after a failed automatic response', async () => {
    const { transport, enqueue, complete } = createScheduledHarness()
    const automatic = transport.requestAutomatic()
    await complete(0, true)
    for (let index = 1; index < 6; index += 1) await complete(index)
    const { results } = await automatic
    expect(results[0]).toEqual({ state: 'unavailable', failureCode: 'response-unavailable' })
    expect(results.slice(1)).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({ state: 'succeeded' })))
    expect(enqueue).toHaveBeenCalledTimes(6)
  })

  it('preserves an automatic request already waiting in the shared quota queue', async () => {
    let now = Date.parse('2026-09-07T01:02:03.000Z')
    const queue = createSourceRequestGovernanceQueue({ now: () => now })
    const policy = zeroXRouterSourcePolicy.requestGovernance
    for (let index = 0; index < policy.rollingWindow.maxRequests; index += 1) {
      await queue.enqueue({ sourceId: zeroXRouterSourcePolicy.sourceId, policy, apiKey, run: async () => undefined })
    }
    const enqueue = vi.fn(queue.enqueue)
    const { transport, requestJsonBody } = createHarness({ queue: { enqueue }, now: () => new Date(now) })
    const automatic = transport.requestAutomatic()
    await vi.waitFor(() => expect(queue.pendingCount()).toBe(1))
    const manual = transport.requestManual({
      descriptorId: 'macro-calendar-0xrouter-central-bank-activities', month: '2026-09', locale: 'en'
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(requestJsonBody).not.toHaveBeenCalled()
    now += policy.rollingWindow.windowMs
    queue.pump()
    await Promise.all([automatic, manual])
    expect(enqueue.mock.calls.map(([entry]) => entry.intent)).toEqual([
      'automatic', 'user', 'automatic', 'automatic', 'automatic', 'automatic'
    ])
    expect(requestJsonBody).toHaveBeenCalledTimes(6)
    queue.close()
  })

  it('bounds local waiting work while allowing same-key joins at capacity', async () => {
    const { transport, enqueue, queue, complete } = createScheduledHarness()
    const input = { descriptorId: 'macro-calendar-0xrouter-economic-data', month: '2026-01', locale: 'zh' } as const
    const active = transport.requestManual(input)
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1))
    const waiting = Array.from({ length: 10 }, (_, index) => transport.requestManual({
      ...input, month: `2026-${String(index + 2).padStart(2, '0')}`
    }))
    expect(transport.requestManual({ ...input, month: '2026-02' })).toBe(waiting[0])
    let overflow: unknown
    const rejected = transport.requestManual({ ...input, month: '2026-12' }).then((result) => { overflow = result })
    await vi.waitFor(() => expect(overflow).toEqual({ state: 'unavailable', failureCode: 'response-unavailable' }))
    expect(enqueue).toHaveBeenCalledTimes(1)
    // Closing the real shared queue drains local requests safely without spending its quota.
    queue.close()
    await complete(0)
    await Promise.all([active, ...waiting, rejected])
    expect(enqueue).toHaveBeenCalledTimes(11)
  })
})
