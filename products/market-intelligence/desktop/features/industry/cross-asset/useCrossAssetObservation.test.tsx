// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** 固定基准：租约到期只是夹具字段，钩子不读它；摸系统时钟只会让同一提交的两次结果不可比。 */
const FIXED_NOW = Date.parse('2026-11-09T00:00:00.000Z')
import { useCrossAssetObservation } from './useCrossAssetObservation'

let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers() })
const client = () => ({
  acquire: vi.fn(async () => ({ state: 'active', leaseId: 'lease', expiresAt: FIXED_NOW + 30_000 })),
  renew: vi.fn(async () => ({ state: 'active', leaseId: 'lease', expiresAt: FIXED_NOW + 30_000 })),
  release: vi.fn(async () => ({ state: 'released' })), refresh: vi.fn(async () => ({ state: 'accepted' })),
  getSourceConfiguration: vi.fn(async () => ({ state: 'configured', enabled: true })),
  query: vi.fn(async () => ({ state: 'unavailable' }))
})
async function render(api: ReturnType<typeof client>) {
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  let latest!: ReturnType<typeof useCrossAssetObservation>
  function Harness() { latest = useCrossAssetObservation({ client: api as never }); return createElement('output', null, latest.range) }
  await act(async () => root!.render(createElement(Harness)))
  return { container, state: () => latest }
}

describe('cross-asset visible lease hook', () => {
  it('keeps the rows when a lease renewal fails, and reacquires on its next backoff step', async () => {
    vi.useFakeTimers()
    const api = client()
    const cached = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: {},
      quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
      forming: { index: { at: 'current', returnPercent: 1 }, btc: null, eth: null } }
    api.query.mockResolvedValue(cached as never)
    api.renew.mockResolvedValueOnce({ state: 'expired' } as never)
    const page = await render(api)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    // A lost lease is not a failed read: the rows stay live-looking and the hook comes back after
    // the first backoff step instead of painting the error state.
    expect(page.state().state).toBe('ready')
    expect(page.state().snapshot).toMatchObject({ sourceState: 'live' })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(api.acquire).toHaveBeenCalledTimes(2)
  })

  it('retains closed history but removes live claims after an unavailable query and hides an old range', async () => {
    vi.useFakeTimers()
    const api = client()
    const cached = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: { index: [] },
      quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
      forming: { index: { at: 'current', returnPercent: 1 }, btc: null, eth: null }, observationKey: { indexBtc: 'up', ethBtc: 'stronger' } }
    api.query.mockResolvedValueOnce(cached as never)
    const page = await render(api)
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(page.state().snapshot).toMatchObject({ curves: cached.curves, sourceState: 'unavailable',
      quotes: { index: { state: 'stale' } }, forming: { index: null } })
    await act(async () => page.state().setRange('1h'))
    expect(page.state().snapshot).toBeUndefined()
  })
  it('acquires once, serially queries every second, renews at ten seconds and releases on unmount', async () => {
    vi.useFakeTimers()
    const api = client(); await render(api)
    expect(api.acquire).toHaveBeenCalledOnce()
    expect(api.query).toHaveBeenCalledWith({ range: '24h' })
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(api.renew).toHaveBeenCalledOnce()
    expect(api.query).toHaveBeenCalledTimes(11)
    await act(async () => root!.unmount()); root = undefined
    expect(api.release).toHaveBeenCalledWith('lease')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not overlap slow queries and switches the next request to the latest range', async () => {
    vi.useFakeTimers()
    const api = client()
    let resolve!: (value: { state: string }) => void
    api.query.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const page = await render(api)
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(api.query).toHaveBeenCalledOnce()
    await act(async () => page.state().setRange('1h'))
    await act(async () => resolve({ state: 'unavailable' }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(api.query).toHaveBeenLastCalledWith({ range: '1h' })
    expect(api.acquire).toHaveBeenCalledOnce()
  })

  it('releases on hidden and reacquires when visible without querying a removed configuration summary', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    const api = client(); await render(api)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(api.release).toHaveBeenCalledOnce()
    const queries = api.query.mock.calls.length
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(api.query).toHaveBeenCalledTimes(queries)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(api.acquire).toHaveBeenCalledTimes(2)
    expect(api.getSourceConfiguration).not.toHaveBeenCalled()
  })

  it('releases an acquire that arrives after unmount without starting query timers', async () => {
    vi.useFakeTimers()
    const api = client()
    let resolve!: (value: { state: string; leaseId: string; expiresAt: number }) => void
    api.acquire.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await render(api)
    await act(async () => root!.unmount()); root = undefined
    await act(async () => resolve({ state: 'active', leaseId: 'late', expiresAt: FIXED_NOW + 30_000 }))
    expect(api.release).toHaveBeenCalledWith('late')
    expect(vi.getTimerCount()).toBe(0)
  })
})
it('stays loading while the runtime is not ready, and only turns to the error after the retry ladder', async () => {
  vi.useFakeTimers()
  const api = client()
  api.acquire.mockRejectedValue(new Error('runtime not ready'))
  const page = await render(api)
  expect(page.state().state).toBe('loading')
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(page.state().state).toBe('loading')
  // 1 + 2 + 4 + 8 + 16 seconds of backoff, then a sixth failure is terminal.
  await act(async () => vi.advanceTimersByTimeAsync(40_000))
  expect(page.state().state).toBe('error')
  expect(page.state().failure).toBe('query')
})

it('never paints an error while a slow query is still on its way', async () => {
  vi.useFakeTimers()
  const api = client()
  // 延迟解决的查询：mock 推断出的 promise 结果类型比 `unknown` 窄，直接赋值会因逆变失败；
  // 这里保留 `unknown` 作为存储类型（调用点给的是完整快照），只在交接处做一次类型转换。
  let resolve!: (value: unknown) => void
  api.query.mockImplementationOnce(() => new Promise(done => { resolve = done as unknown as (value: unknown) => void }))
  const page = await render(api)
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(page.state().state).toBe('loading')
  const snapshot = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: {},
    quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
    forming: { index: null, btc: null, eth: null } }
  await act(async () => resolve(snapshot))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  expect(page.state().state).toBe('ready')
})

it('keeps the previous rows and marks them stale when a later read fails', async () => {
  vi.useFakeTimers()
  const api = client()
  const cached = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: {},
    quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
    forming: { index: null, btc: null, eth: null } }
  api.query.mockResolvedValueOnce(cached as never).mockResolvedValue({ state: 'unavailable' } as never)
  const page = await render(api)
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  expect(page.state().state).toBe('ready')
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(page.state().stale).toBe(true)
  expect(page.state().snapshot).toMatchObject({ sourceState: 'unavailable' })
})

it('keeps the rows when an explicit refresh rejects, and only errors with nothing on screen', async () => {
  vi.useFakeTimers()
  const api = client()
  const cached = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: {},
    quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
    forming: { index: null, btc: null, eth: null } }
  api.query.mockResolvedValue(cached as never)
  api.refresh.mockRejectedValueOnce(new Error('refresh failed'))
  const page = await render(api)
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  await act(async () => page.state().refresh())
  expect(page.state().stale).toBe(true)
  expect(page.state().state).toBe('ready')
  expect(page.state().snapshot).not.toBeUndefined()
})
