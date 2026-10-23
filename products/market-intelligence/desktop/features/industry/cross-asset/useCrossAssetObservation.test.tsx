// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCrossAssetObservation } from './useCrossAssetObservation'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers() })
const client = () => ({
  acquire: vi.fn(async () => ({ state: 'active', leaseId: 'lease', expiresAt: Date.now() + 30_000 })),
  renew: vi.fn(async () => ({ state: 'active', leaseId: 'lease', expiresAt: Date.now() + 30_000 })),
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
  it('removes live claims when a lease renewal fails and reacquires on its next bounded attempt', async () => {
    vi.useFakeTimers()
    const api = client()
    const cached = { schemaVersion: 1, range: '24h', mode: 'current', sourceState: 'live', curves: {},
      quotes: { index: { state: 'live', price: '100', tradedAtMs: 1, receivedAtMs: 1 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
      forming: { index: { at: 'current', returnPercent: 1 }, btc: null, eth: null }, observationKey: { indexBtc: 'up', ethBtc: 'stronger' } }
    api.query.mockResolvedValue(cached as never)
    api.renew.mockResolvedValueOnce({ state: 'expired' } as never)
    const page = await render(api)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(page.state().snapshot).toMatchObject({ sourceState: 'unavailable', forming: { index: null }, observationKey: { indexBtc: 'unavailable' } })
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
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
      quotes: { index: { state: 'stale' } }, forming: { index: null }, observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' } })
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
    await act(async () => resolve({ state: 'active', leaseId: 'late', expiresAt: Date.now() + 30_000 }))
    expect(api.release).toHaveBeenCalledWith('late')
    expect(vi.getTimerCount()).toBe(0)
  })
})
