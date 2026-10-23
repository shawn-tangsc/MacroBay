import { describe, expect, it, vi } from 'vitest'

import { crossAssetIndexJobDefinitions } from './crossAssetIndexJob'
import { createCrossAssetIndexRuntime } from './crossAssetIndexRuntime'
import { crossAssetPolicy } from './crossAssetPolicy'

const API_KEY = 'test-key-not-a-real-credential'
const at = (iso: string) => Date.parse(iso)
const now = at('2026-10-14T12:00:00.000Z')
const row = (openTime: string, close: number) => ({
  symbolCode: 'USTEC', openTime, openPrice: close - 5, highPrice: close + 10, lowPrice: close - 10, closePrice: close, volume: 100
})

/** The published shape, three hours after the last bar closed: the market is shut, the source is not. */
const closedSessionPage = { data: [row('2026-10-14T08:55:00.000Z', 25_234.5), row('2026-10-14T09:00:00.000Z', 25_240)] }
const jobRuntime = () => ({ registerHandler: vi.fn(), setSchedule: vi.fn(), enqueueDefinition: vi.fn(async () => undefined) }) as never
const fetchOf = (body: unknown, status = 200) => vi.fn(async () => ({ status, text: async () => JSON.stringify(body) })) as unknown as typeof fetch

function setup(overrides: Partial<Parameters<typeof createCrossAssetIndexRuntime>[0]> = {}) {
  const append = vi.fn(() => ({ state: 'updated' as const, added: 2 }))
  const onError = vi.fn()
  const runtime = createCrossAssetIndexRuntime({
    jobRuntime: jobRuntime(),
    store: { append },
    resolveProfile: async () => ({ credentialRef: crossAssetPolicy.index.sourceId, enabled: true }),
    getCredential: async () => ({ apiKey: API_KEY }),
    fetchImpl: fetchOf(closedSessionPage),
    now: () => now,
    onError,
    ...overrides
  })
  return { runtime, append, onError }
}

describe('cross-asset licensed index feed', () => {
  it('stores the closed session bars and stays ready while the market is shut', async () => {
    const { runtime, append } = setup()
    const result = await runtime.run(now)

    expect(result).toMatchObject({ state: 'stored', added: 2, offGrid: 0, forming: 0 })
    expect(append).toHaveBeenCalledWith({
      observedAtMs: now, origin: 'rest',
      bars: [
        { symbol: 'USTEC', barOpenMs: at('2026-10-14T08:55:00.000Z'), barEndMs: at('2026-10-14T09:00:00.000Z'), open: '25229.5', high: '25244.5', low: '25224.5', close: '25234.5', volume: '100' },
        { symbol: 'USTEC', barOpenMs: at('2026-10-14T09:00:00.000Z'), barEndMs: at('2026-10-14T09:05:00.000Z'), open: '25235', high: '25250', low: '25230', close: '25240', volume: '100' }
      ]
    })
    // A shut market is a successful tick. This is the state that keeps the row on the *real* index at
    // night instead of switching it to the tokenised proxy — the one thing the row must never do.
    expect(runtime.state()).toEqual({ state: 'ready' })
  })

  it('reports a switched-off or unkeyed source as unavailable without spending a request', async () => {
    const fetchImpl = fetchOf(closedSessionPage)
    const disabled = setup({ resolveProfile: async () => ({ credentialRef: null, enabled: false }), fetchImpl })
    expect(await disabled.runtime.run(now)).toEqual({ state: 'unavailable', failureCode: 'disabled' })
    expect(disabled.runtime.state()).toEqual({ state: 'unavailable', failureCode: 'disabled' })

    const unkeyed = setup({ getCredential: async () => null, fetchImpl })
    expect(await unkeyed.runtime.run(now)).toEqual({ state: 'unavailable', failureCode: 'credential-missing' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('records a transport failure as a code and never as the URL the key travelled in', async () => {
    const failure = new Error(`request to ${crossAssetPolicy.baseUrl}/api/v1/candle failed`)
    const onError = vi.fn()
    const { runtime } = setup({ fetchImpl: vi.fn(async () => { throw failure }) as never, onError })

    expect(await runtime.run(now)).toEqual({ state: 'unavailable', failureCode: 'transport-unavailable' })
    expect(runtime.state()).toEqual({ state: 'unavailable', failureCode: 'transport-unavailable' })
    const [error, sourceId] = onError.mock.calls[0]
    expect(sourceId).toBe(crossAssetPolicy.index.sourceId)
    expect(String(error)).toBe('Error: cross-asset-index transport-unavailable')
    expect(String(error)).not.toContain(API_KEY)
    expect(String(error)).not.toContain('http')
  })

  it('reports a page with no usable bar as a failure rather than as an empty success', async () => {
    const { runtime, append, onError } = setup({ fetchImpl: fetchOf({ data: [] }) })

    expect(await runtime.run(now)).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(append).not.toHaveBeenCalled()
    expect(runtime.state()).toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(String(onError.mock.calls[0][0])).not.toContain(API_KEY)
  })

  it('keeps the row on the real index when the store refuses a write but the source answered', async () => {
    const { runtime } = setup({ store: { append: () => ({ state: 'limited', added: 0 }) } })

    expect(await runtime.run(now)).toMatchObject({ state: 'unchanged' })
    expect(runtime.state()).toEqual({ state: 'ready' })
  })

  it('polls the fallback every fifteen minutes, not every five, to leave the budget to the dollar', async () => {
    const [definition] = crossAssetIndexJobDefinitions()

    // The licensed index is the row's fallback, so it does not have to tick: one request a quarter hour
    // is 2,880 a month, against the 8,640 the five-minute real dollar index already spends.
    expect(definition).toMatchObject({ id: 'market-intelligence.collect-cross-asset-index', trigger: { kind: 'interval', intervalMs: 15 * 60_000 } })
  })

  it('spends a request on the startup tick and nothing after disposal', async () => {
    const registerHandler = vi.fn()
    const enqueueDefinition = vi.fn(async () => undefined)
    const fetchImpl = fetchOf(closedSessionPage)
    const runtime = createCrossAssetIndexRuntime({
      jobRuntime: { registerHandler, setSchedule: vi.fn(), enqueueDefinition } as never,
      store: { append: () => ({ state: 'unchanged' as const, added: 0 }) },
      resolveProfile: async () => ({ credentialRef: crossAssetPolicy.index.sourceId, enabled: true }),
      getCredential: async () => ({ apiKey: API_KEY }),
      fetchImpl, now: () => now
    })

    // The job is registered under its own fixed handler id, with a manual startup tick so a reader who
    // opens the app mid-session does not wait five minutes for the first request.
    expect(registerHandler).toHaveBeenCalledWith('market-intelligence.collect-cross-asset-index', expect.any(Function))
    expect(enqueueDefinition).toHaveBeenCalledOnce()
    const handler = registerHandler.mock.calls[0][1] as () => Promise<unknown>
    await handler()
    expect(fetchImpl).toHaveBeenCalledOnce()

    runtime.dispose()
    await handler()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
