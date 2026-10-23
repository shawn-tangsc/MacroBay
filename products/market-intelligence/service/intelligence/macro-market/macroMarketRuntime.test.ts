import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MACRO_MARKET_COLLECT_JOB_ID, macroMarketJobDefinitions } from './macroMarketJob'
import { createMacroMarketRuntime, createMacroMarketTransport } from './macroMarketRuntime'
import { REAL_MARKET_API_DXY_COLLECT_JOB_ID } from './realMarketApiDxyJob'
import { realMarketApiPolicy } from './realMarketApiPolicy'
import { realMarketApiCandleResponse, realMarketApiPriceResponse } from './realMarketApiResponseFixtures'

/** The provider's own answer for spot gold, the second instrument the licensed source carries. */
const goldPriceResponse = Object.freeze({ ...realMarketApiPriceResponse, symbolCode: 'XAUUSD', closePrice: 4180.5 })
const goldCandleResponse = Object.freeze({
  data: Object.freeze(realMarketApiCandleResponse.data.map(row => Object.freeze({ ...row, symbolCode: 'XAUUSD', closePrice: 4180.5 })))
})

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const basketPayload = (atMs: number) => Object.fromEntries(['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'USD/SEK', 'USD/CHF'].map(symbol => [symbol,
  { meta: { symbol }, values: [{ datetime: new Date(atMs).toISOString().replace('T', ' ').slice(0, 19), open: '1', high: '1', low: '1', close: '1.1' }], status: 'ok' }]))
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response

const jobRuntime = () => {
  const handlers = new Map<string, (payload: unknown, context: never) => Promise<void>>()
  const schedules: unknown[] = []
  const enqueued: unknown[] = []
  return {
    handlers, schedules, enqueued,
    registerHandler: (id: string, handler: (payload: unknown, context: never) => Promise<void>) => { handlers.set(id, handler) },
    setSchedule: (definition: unknown) => { schedules.push(definition) },
    enqueueDefinition: async (definition: unknown) => { enqueued.push(definition); return { id: 'run-1' } }
  }
}

describe('the macro-market transport', () => {
  it('reads a JSON body and reports a broken transport as its own state', async () => {
    expect(await createMacroMarketTransport((async () => response({ status: 'ok' })) as unknown as typeof fetch)('https://x'))
      .toEqual({ state: 'ok', status: 200, body: { status: 'ok' } })
    expect(await createMacroMarketTransport((async () => { throw new Error('offline') }) as unknown as typeof fetch)('https://x'))
      .toEqual({ state: 'unavailable', failureCode: 'transport-unavailable' })
    expect(await createMacroMarketTransport((async () => ({ status: 200, text: async () => 'x'.repeat(1200 * 1024) }) as unknown as Response) as unknown as typeof fetch)('https://x'))
      .toEqual({ state: 'unavailable', failureCode: 'response-invalid' })
  })
})

describe('the macro-market runtime', () => {
  it('registers the job, schedules the five-minute clock and runs it from a startup tick', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const atMs = Date.UTC(2026, 9, 14, 6, 0)
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: true }),
      getCredential: async () => ({ apiKey: 'key' }), now: () => atMs,
      fetchImpl: (async () => response(basketPayload(atMs))) as unknown as typeof fetch
    })

    expect(runtime.handlers.has(MACRO_MARKET_COLLECT_JOB_ID)).toBe(true)
    // Two jobs and two clocks now: the basket on its own profile, the real index beside it.
    expect(runtime.schedules).toHaveLength(2)
    expect(macroMarketJobDefinitions()[0]).toMatchObject({ trigger: { kind: 'interval', intervalMs: 5 * 60_000 } })
    expect(runtime.enqueued).toHaveLength(2)

    await runtime.handlers.get(MACRO_MARKET_COLLECT_JOB_ID)!({}, {} as never)
    expect(macro.store.latest('dxy-synthetic')).toBeDefined()
    expect(macro.store.latest('eur-usd')?.value).toBeCloseTo(1.1, 6)
    macro.store.close()
  })

  it('collects the real dollar index into the same store, under its own switch and source id', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const atMs = Date.UTC(2026, 9, 14, 11, 0)
    const errors: Readonly<{ message: string; sourceId: string }>[] = []
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      // The basket is switched off here; only the real index is enabled, so a stored real level can
      // only have come from the second collector.
      resolveProfile: async sourceId => sourceId === realMarketApiPolicy.sourceId
        ? { credentialRef: realMarketApiPolicy.credentialRef, enabled: true }
        : { credentialRef: 'twelve-data-market', enabled: false },
      getCredential: async () => ({ apiKey: `${'ab12'.repeat(16)}` }), now: () => atMs,
      fetchImpl: (async url => response(String(url).includes('/api/v1/candle')
        ? (new URL(String(url)).searchParams.get('symbolCode') === 'XAUUSD' ? goldCandleResponse : realMarketApiCandleResponse)
        : (new URL(String(url)).searchParams.get('symbolCode') === 'XAUUSD' ? goldPriceResponse : realMarketApiPriceResponse))) as unknown as typeof fetch,
      onError: (error, sourceId) => { errors.push({ message: String(error), sourceId }) }
    })

    expect(runtime.handlers.has(REAL_MARKET_API_DXY_COLLECT_JOB_ID)).toBe(true)
    await runtime.handlers.get(REAL_MARKET_API_DXY_COLLECT_JOB_ID)!({ startup: true }, {} as never)
    expect(macro.store.count(realMarketApiPolicy.series.dollarIndex)).toBe(3)
    expect(macro.store.count(realMarketApiPolicy.series.gold)).toBe(3)
    expect(macro.store.count('eur-usd')).toBe(0)
    expect(errors).toHaveLength(0)
    macro.store.close()
  })

  it('files a real-index failure under its own source id, never under the fallback source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const errors: Readonly<{ message: string; sourceId: string }>[] = []
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      resolveProfile: async sourceId => ({ credentialRef: sourceId, enabled: true }),
      getCredential: async () => ({ apiKey: 'key' }), now: () => Date.UTC(2026, 9, 14, 11, 0),
      fetchImpl: (async () => response({ message: 'unauthorized' }, 401)) as unknown as typeof fetch,
      onError: (error, sourceId) => { errors.push({ message: String(error), sourceId }) }
    })

    // Both instruments are asked, so a refused tick spends one price request on each of them.
    await expect(macro.runRealMarketApiDxy(Date.UTC(2026, 9, 14, 11, 0), { force: true }))
      .resolves.toEqual({ state: 'unavailable', failureCode: 'credential-rejected', credits: 2 })
    expect(errors).toEqual([{ message: 'Error: realmarketapi-market credential-rejected', sourceId: 'realmarketapi-market' }])
    // The whole message is a code and a symbol: no URL, and so no key, can travel in it.
    expect(JSON.stringify(errors)).not.toContain('apiKey')
    macro.store.close()
  })

  it('reports a missing credential instead of fetching without one, and never throws out of the job', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const errors: unknown[] = []
    const fetchImpl = vi.fn()
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      resolveProfile: async () => ({ enabled: true }), getCredential: async () => null, now: () => Date.UTC(2026, 9, 14, 6, 0),
      fetchImpl: fetchImpl as unknown as typeof fetch, onError: error => errors.push(error)
    })
    await expect(runtime.handlers.get(MACRO_MARKET_COLLECT_JOB_ID)!({}, {} as never)).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(errors).toHaveLength(1)
    expect(macro.store.count()).toBe(0)
    macro.store.close()
  })

  it('does nothing at all while the reader has not enabled the source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const fetchImpl = vi.fn()
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      resolveProfile: async () => ({ credentialRef: 'ref', enabled: false }), getCredential: async () => ({ apiKey: 'key' }),
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => Date.UTC(2026, 9, 14, 6, 0)
    })
    // Switched off is its own state: not "no credential", and certainly not a credit spent.
    await expect(macro.run(Date.UTC(2026, 9, 14, 6, 0))).resolves.toEqual({ state: 'disabled', credits: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(macro.store.count()).toBe(0)
    macro.store.close()
  })

  it('swallows a throwing transport into a reported failure rather than a rejected job', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-runtime-')); directories.push(directory)
    const runtime = jobRuntime()
    const macro = createMacroMarketRuntime({
      jobRuntime: runtime as never, dataDirectory: directory,
      resolveProfile: async () => ({ credentialRef: 'ref', enabled: true }), getCredential: async () => { throw new Error('vault closed') },
      fetchImpl: (async () => response({})) as unknown as typeof fetch, now: () => Date.UTC(2026, 9, 14, 6, 0)
    })
    await expect(macro.run(Date.UTC(2026, 9, 14, 6, 0))).resolves.toMatchObject({ state: 'unavailable' })
    macro.store.close()
  })
})
