import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCrossAssetRuntime } from './crossAssetRuntime'
import { CrossAssetClientError, type ClosedBar, type BinanceAsset } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'

const now = Date.parse('2026-09-14T12:00:00.000Z')
const missing = () => ({ index: { state: 'missing' as const }, btc: { state: 'missing' as const }, eth: { state: 'missing' as const } })
const bar = { symbol: 'QQQUSDT' as const, barOpenMs: now - 300_000, barEndMs: now, open: '100', high: '101', low: '99', close: '100', volume: '1' }
function setup() {
  let enabled = true
  const streams: ReturnType<typeof createStream>[] = []
  const callbacks: ((state: 'connected' | 'disconnected' | 'overflow') => void)[] = []
  function createStream(callback: (state: 'connected' | 'disconnected' | 'overflow') => void) {
    callbacks.push(callback)
    let observer: ((asset: 'proxy' | 'btc' | 'eth') => void) | undefined
    const stream = { close: vi.fn(), takeClosed: vi.fn(() => [] as typeof bar[]),
      observeKlines: (listener: typeof observer) => { observer = listener; return () => { observer = undefined } },
      emitKline: (asset: 'proxy' | 'btc' | 'eth') => observer?.(asset),
      snapshot: () => ({ state: 'connected' as const, quotes: missing(), quoteCount: 0, formingCount: 0, closedCount: 0 }) }
    streams.push(stream)
    return stream
  }
  const fetchMetadata = vi.fn(async () => ['proxy', 'btc', 'eth'].map(asset => ({ asset, state: 'admitted', priceDecimals: asset === 'btc' ? 1 : 2 })))
  const fetchHistory = vi.fn(async function* () { yield [bar] })
  const fetchClosedBars = vi.fn(async (input: { asset: BinanceAsset; endMs: number; limit: number }) => [{ ...bar, symbol: crossAssetPolicy.binanceAssets[input.asset] }])
  const append = vi.fn(() => ({ state: 'updated' as const, added: 1 }))
  const queryAt = vi.fn((input: { symbol: ClosedBar['symbol'] }) => Array.from({ length: 2017 }, (_, index) => ({
    ...bar, symbol: input.symbol, barOpenMs: now - (2017 - index) * 300_000, barEndMs: now - (2016 - index) * 300_000
  })))
  const runtime = createCrossAssetRuntime({ now: () => Date.now(), readEnabled: async () => enabled,
    client: { fetchMetadata, fetchHistory, fetchClosedBars } as never,
    store: { append, queryAt }, createStream: vi.fn(createStream) })
  return { runtime, streams, callbacks, append, queryAt, fetchHistory, fetchMetadata, fetchClosedBars, setEnabled: (value: boolean) => { enabled = value } }
}

describe('cross-asset visible runtime', () => {
  afterEach(() => vi.useRealTimers())
  it('keeps bounded internal lifecycle and successful-write diagnostics', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime } = setup()
    try {
      await runtime.acquire(); await runtime.whenIdle()
      expect(runtime.diagnostics()).toMatchObject({ activeLeases: 1, physicalSockets: 1, pendingRest: 0, closedBacklog: 0, lastSuccessfulWriteAt: now })
      await runtime.dispose()
      expect(runtime.diagnostics()).toMatchObject({ activeLeases: 0, physicalSockets: 0, pendingRest: 0 })
    } finally { await runtime.dispose() }
  })

  it('becomes live when the socket connects after cached backfill has finished', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, callbacks } = setup()
    try {
      await runtime.acquire()
      await vi.advanceTimersByTimeAsync(0)
      await runtime.whenIdle()
      callbacks[0]('disconnected')
      await vi.advanceTimersByTimeAsync(1200)
      await runtime.whenIdle()
      streams.at(-1)!.snapshot = () => ({ state: 'connecting' as never, quotes: missing(), quoteCount: 0, formingCount: 0, closedCount: 0 })
      const lease = await runtime.acquire()
      if (lease.state === 'active') await runtime.refresh(lease.leaseId)
      await runtime.whenIdle()
      expect(runtime.snapshot().state).toBe('stale')
      callbacks.at(-1)!('connected')
      expect(runtime.snapshot().state).toBe('live')
    } finally { await runtime.dispose() }
  })

  it('keeps admitted assets collecting when one contract is unavailable', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchMetadata, fetchClosedBars, streams } = setup()
    fetchMetadata.mockResolvedValue([{ asset: 'proxy', state: 'unavailable' }, { asset: 'btc', state: 'admitted', priceDecimals: 1 }, { asset: 'eth', state: 'admitted', priceDecimals: 2 }] as never)
    try {
      await runtime.acquire(); await runtime.whenIdle()
      expect(fetchClosedBars.mock.calls.map(([input]) => input.asset)).toEqual(['btc', 'eth'])
      expect(streams).toHaveLength(1)
      expect(runtime.snapshot().quotes.index).toEqual({ state: 'missing' })
    } finally { await runtime.dispose() }
  })

  it('stops collection after storage refuses a write and does not restart automatically', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, append, streams, fetchClosedBars } = setup()
    append.mockReturnValue({ state: 'limited', added: 0 } as never)
    try {
      const lease = await runtime.acquire(); await runtime.whenIdle()
      expect(runtime.snapshot().state).toBe('limited')
      expect(streams[0].close).toHaveBeenCalledOnce()
      const writes = append.mock.calls.length; const reads = fetchClosedBars.mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      if (lease.state === 'active') await runtime.renew(lease.leaseId)
      expect(append).toHaveBeenCalledTimes(writes)
      expect(fetchClosedBars).toHaveBeenCalledTimes(reads)
      expect(runtime.snapshot().state).toBe('limited')
    } finally { await runtime.dispose() }
  })

  it('retains admitted tick precision for safe quote presentation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime } = setup()
    try {
      await runtime.acquire(); await runtime.whenIdle()
      expect(runtime.snapshot()).toHaveProperty('priceDecimals', { index: 2, btc: 1, eth: 2 })
    } finally { await runtime.dispose() }
  })

  it('repairs a missing latest closed bar after ninety seconds and at most once per five minutes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars, queryAt } = setup()
    try {
      const lease = await runtime.acquire(); await runtime.whenIdle()
      queryAt.mockReturnValue([])
      for (let elapsed = 10_000; elapsed <= 90_000; elapsed += 10_000) {
        await vi.advanceTimersByTimeAsync(10_000)
        if (lease.state === 'active') await runtime.renew(lease.leaseId)
      }
      await runtime.whenIdle()
      expect(fetchClosedBars).toHaveBeenCalledTimes(6)
      expect(fetchClosedBars.mock.calls.slice(3).map(([input]) => input.limit)).toEqual([12, 12, 12])
      for (let elapsed = 0; elapsed < 30_000; elapsed += 10_000) {
        await vi.advanceTimersByTimeAsync(10_000)
        if (lease.state === 'active') await runtime.renew(lease.leaseId)
      }
      expect(fetchClosedBars).toHaveBeenCalledTimes(6)
    } finally { await runtime.dispose() }
  })

  it('does not cancel an explicit test during disabled lease reconciliation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars, streams, setEnabled } = setup()
    setEnabled(false)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    fetchClosedBars.mockImplementationOnce(async () => { await gate; return [bar] })
    try {
      const testing = runtime.testInterface()
      await runtime.acquire()
      release(); await vi.advanceTimersByTimeAsync(0)
      expect(streams).toHaveLength(1)
      for (const asset of ['proxy', 'btc', 'eth'] as const) streams[0].emitKline(asset)
      expect(await testing).toMatchObject({ state: 'passed' })
    } finally { release(); await runtime.cancelInterfaceTest(); await runtime.dispose() }
  })

  it('does not launch production REST alongside a configuration test awaiting REST', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars, fetchMetadata } = setup()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    fetchClosedBars.mockImplementationOnce(async () => { await gate; return [bar] })
    const testing = runtime.testInterface()
    try {
      const lease = await runtime.acquire()
      expect(fetchMetadata).not.toHaveBeenCalled()
      if (lease.state === 'active') expect(await runtime.refresh(lease.leaseId)).toEqual({ state: 'busy' })
    } finally {
      await runtime.cancelInterfaceTest(); release(); await testing; await runtime.dispose()
    }
  })

  it('allows a configuration test without any lease while disabled and cancels only its temporary socket', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, setEnabled, append } = setup()
    setEnabled(false)
    try {
      const testing = runtime.testInterface()
      await vi.advanceTimersByTimeAsync(0)
      expect(streams).toHaveLength(1)
      expect(append).not.toHaveBeenCalled()
      expect(await runtime.cancelInterfaceTest()).toEqual({ state: 'cancelled' })
      await testing
      expect(streams[0].close).toHaveBeenCalledOnce()
      expect(await runtime.cancelInterfaceTest()).toEqual({ state: 'cancelled' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { await runtime.dispose() }
  })

  it('cancels an active configuration test without closing production collection', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams } = setup()
    try {
      await runtime.acquire(); await runtime.whenIdle()
      const testing = runtime.testInterface()
      await vi.advanceTimersByTimeAsync(0)
      await runtime.cancelInterfaceTest(); await testing
      expect(streams[0].close).not.toHaveBeenCalled()
      expect(streams).toHaveLength(1)
    } finally { await runtime.dispose() }
  })

  it('reads each cached window and rechecks only twelve trailing bars instead of replaying full history', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, queryAt, fetchClosedBars, fetchHistory } = setup()
    queryAt.mockImplementation(input => Array.from({ length: 2017 }, (_, index) => ({
      ...bar, symbol: input.symbol, barOpenMs: now - (2017 - index) * 300_000, barEndMs: now - (2016 - index) * 300_000
    })))
    try {
      await runtime.acquire(); await runtime.whenIdle()
      expect(queryAt).toHaveBeenCalledTimes(3)
      expect(fetchHistory).not.toHaveBeenCalled()
      expect(fetchClosedBars.mock.calls.map(([input]) => input)).toEqual(Object.keys(crossAssetPolicy.binanceAssets).map(asset => ({ asset, endMs: now, limit: 12 })))
    } finally { await runtime.dispose() }
  })

  it('tests REST and genuine klines without closing shared collection or writing test bars', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, append, fetchClosedBars } = setup()
    const lease = await runtime.acquire(); await runtime.whenIdle()
    if (lease.state !== 'active') throw new Error('fixture lease')
    const writes = append.mock.calls.length
    const reads = fetchClosedBars.mock.calls.length
    const testing = runtime.testInterface()
    await vi.advanceTimersByTimeAsync(0)
    expect(await runtime.testInterface()).toEqual({ state: 'busy' })
    for (const asset of ['proxy', 'btc', 'eth'] as const) streams[0].emitKline(asset)
    expect(await testing).toMatchObject({ state: 'passed', assets: { index: { rest: true, ws: true }, btc: { rest: true, ws: true }, eth: { rest: true, ws: true } } })
    expect(fetchClosedBars).toHaveBeenCalledTimes(reads + 3)
    expect(streams).toHaveLength(1)
    expect(streams[0].close).not.toHaveBeenCalled()
    expect(append).toHaveBeenCalledTimes(writes)
    await runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes an exclusively owned test socket after its 15s sampling deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, setEnabled } = setup()
    setEnabled(false)
    const lease = await runtime.acquire()
    if (lease.state !== 'active') throw new Error('fixture lease')
    const testing = runtime.testInterface()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await testing).toMatchObject({ state: 'partial' })
    expect(streams).toHaveLength(1)
    expect(streams[0].close).toHaveBeenCalledOnce()
    await runtime.dispose()
  })

  it('waits for Retry-After after a REST failure even when a stream is already open', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars } = setup()
    fetchClosedBars.mockRejectedValueOnce(new CrossAssetClientError('rate-limited', 10_000))
    const lease = await runtime.acquire(); await runtime.whenIdle()
    expect(runtime.snapshot().state).toBe('limited')
    await vi.advanceTimersByTimeAsync(9999)
    expect(fetchClosedBars).toHaveBeenCalledTimes(1)
    if (lease.state === 'active') await runtime.renew(lease.leaseId)
    await vi.advanceTimersByTimeAsync(1)
    await runtime.whenIdle()
    expect(fetchClosedBars).toHaveBeenCalledTimes(4)
    await runtime.dispose()
  })

  it('pauses automatic REST after 418 until explicit refresh', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars } = setup()
    fetchClosedBars.mockRejectedValueOnce(new CrossAssetClientError('request-banned'))
    const lease = await runtime.acquire(); await runtime.whenIdle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchClosedBars).toHaveBeenCalledTimes(1)
    if (lease.state !== 'active') throw new Error('fixture lease')
    expect(await runtime.refresh(lease.leaseId)).toEqual({ state: 'accepted' })
    await runtime.whenIdle()
    expect(fetchClosedBars).toHaveBeenCalledTimes(4)
    await runtime.dispose()
  })

  it('reconnects only after bounded backoff and ignores a superseded connection callback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, callbacks } = setup()
    await runtime.acquire(); await runtime.whenIdle()
    callbacks[0]('disconnected')
    expect(streams[0].close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(999)
    expect(streams).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(201)
    await runtime.whenIdle()
    expect(streams).toHaveLength(2)
    callbacks[0]('disconnected')
    expect(streams[1].close).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts only with a visible lease and shares one stream across windows', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, fetchClosedBars } = setup()
    expect(streams).toHaveLength(0)
    const first = await runtime.acquire()
    await runtime.whenIdle()
    const second = await runtime.acquire()
    expect(first.state).toBe('active'); expect(second.state).toBe('active')
    expect(streams).toHaveLength(1)
    expect(fetchClosedBars).toHaveBeenCalledTimes(3)
    if (first.state === 'active') await runtime.release(first.leaseId)
    expect(streams[0].close).not.toHaveBeenCalled()
    if (second.state === 'active') await runtime.release(second.leaseId)
    expect(streams[0].close).toHaveBeenCalledOnce()
    await runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops after abandoned leases expire and detects external source disable', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, streams, setEnabled } = setup()
    await runtime.acquire(); await runtime.whenIdle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(streams[0].close).toHaveBeenCalledOnce()
    const lease = await runtime.acquire(); await runtime.whenIdle()
    setEnabled(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(streams[1].close).toHaveBeenCalledOnce()
    if (lease.state === 'active') await runtime.renew(lease.leaseId)
    expect(streams).toHaveLength(2)
    expect(runtime.snapshot().state).toBe('disabled')
    await runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects refresh without a live lease and coalesces an in-flight refresh', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars } = setup()
    expect(await runtime.refresh('unknown')).toEqual({ state: 'expired' })
    const lease = await runtime.acquire(); await runtime.whenIdle()
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    fetchClosedBars.mockImplementation(async () => { await gate; return [bar] })
    if (lease.state !== 'active') throw new Error('fixture lease')
    expect(await runtime.refresh(lease.leaseId)).toEqual({ state: 'accepted' })
    expect(await runtime.refresh(lease.leaseId)).toEqual({ state: 'busy' })
    resolve(); await runtime.whenIdle()
    expect(fetchClosedBars).toHaveBeenCalledTimes(6)
    await runtime.dispose()
  })

  it('fences late REST data after release and drains already-validated closed stream bars', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, fetchClosedBars, append, streams } = setup()
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    fetchClosedBars.mockImplementation(async () => { await gate; return [bar] })
    const lease = await runtime.acquire()
    await vi.advanceTimersByTimeAsync(0)
    expect(streams).toHaveLength(1)
    streams[0].takeClosed.mockReturnValueOnce([bar])
    if (lease.state === 'active') await runtime.release(lease.leaseId)
    expect(append).toHaveBeenCalledTimes(1)
    resolve(); await runtime.whenIdle()
    expect(append).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })

  it('cancels a bounded maintenance batch and resumes from its returned bar boundary without deleting history', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const { runtime, append, fetchClosedBars } = setup()
    const controller = new AbortController()
    fetchClosedBars.mockImplementation(async input => {
      controller.abort()
      return [{ ...bar, symbol: crossAssetPolicy.assets[input.asset], barOpenMs: input.endMs - 300_000, barEndMs: input.endMs }]
    })
    const lease = await runtime.acquire(); await runtime.whenIdle()
    if (lease.state !== 'active') throw new Error('fixture lease')
    const cancelled = await runtime.maintain(lease.leaseId, 'btc', controller.signal)
    expect(cancelled.state).toBe('cancelled')
    expect(cancelled.nextBarOpenMs).toBeTypeOf('number')
    const writes = append.mock.calls.length
    const resumed = await runtime.maintain(lease.leaseId, 'btc')
    expect(resumed.state).toBe('completed')
    expect(append.mock.calls.length).toBeGreaterThanOrEqual(writes)
    expect(runtime.diagnostics().activeLeases).toBe(1)
    await runtime.dispose()
  })
})
