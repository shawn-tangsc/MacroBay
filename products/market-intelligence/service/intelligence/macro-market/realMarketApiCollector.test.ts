import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealMarketApiCollector, type RealMarketApiTransport } from './realMarketApiCollector'
import { realMarketApiBackfillNote, realMarketApiDeepBackfillNote, realMarketApiPolicy } from './realMarketApiPolicy'
import { realMarketApiCandleResponse, realMarketApiPriceResponse } from './realMarketApiResponseFixtures'
import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'
import { macroMarketBackfillBars, macroMarketReturn } from './macroMarketReturns'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** A key of the shape the provider issues. It is never the user's key, and it is never written down. */
export const TEST_KEY = `${'ab12'.repeat(16)}`
const series = realMarketApiPolicy.series.dollarIndex
const goldSeries = realMarketApiPolicy.series.gold
const at = (minute: number) => Date.UTC(2026, 9, 14, 11, minute)
/**
 * A store whose one-time deep backfill has already run, so what a test observes is the ordinary path.
 *
 * The ladder is deliberately once-only, and the tests that were written before it describe the cadence
 * after the repair — this is how they say "the history was already deepened, carry on".
 */
const withDeepBackfillDone = (store: MacroMarketStore, ranAtMs = 0): MacroMarketStore => {
  for (const seriesId of [series, goldSeries]) store.note(realMarketApiDeepBackfillNote(seriesId, 'ranAtMs'), String(ranAtMs))
  return store
}

const openStore = (): MacroMarketStore => {
  const directory = mkdtempSync(join(tmpdir(), 'real-dxy-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

type Route = Readonly<{ status?: number; body?: unknown; failure?: 'transport-unavailable' }>
/** The symbol a URL asked for, so the transport can answer that instrument and nothing else. */
const requestedSymbol = (url: string): string => new URL(url).searchParams.get('symbolCode') ?? ''
/** The provider's own answer for the other instrument this source answers. */
const goldPriceResponse = Object.freeze({ ...realMarketApiPriceResponse, symbolCode: 'XAUUSD', closePrice: 4180.5 })
const goldCandleResponse = Object.freeze({
  data: Object.freeze(realMarketApiCandleResponse.data.map(row => Object.freeze({ ...row, symbolCode: 'XAUUSD', closePrice: 4180.5 })))
})
const instrumentBody = (url: string): unknown => {
  const gold = requestedSymbol(url) === 'XAUUSD'
  return url.includes('/api/v1/candle') ? (gold ? goldCandleResponse : realMarketApiCandleResponse) : (gold ? goldPriceResponse : realMarketApiPriceResponse)
}
/** A transport that answers by endpoint and remembers every URL it was handed. */
function transportFor(routes: Readonly<{ price?: Route; candle?: Route }> = {}) {
  const urls: string[] = []
  const transport: RealMarketApiTransport = async url => {
    urls.push(url)
    const route = url.includes('/api/v1/candle') ? routes.candle : routes.price
    if (route?.failure) return { state: 'unavailable', failureCode: route.failure }
    return { state: 'ok', status: route?.status ?? 200, body: route?.body ?? instrumentBody(url) }
  }
  return { transport, urls }
}

const collectorFor = (store: MacroMarketStore, transport: RealMarketApiTransport, apiKey: string = TEST_KEY) =>
  createRealMarketApiCollector({ store, transport, credentials: async () => apiKey })
/** The unkeyed case is its own collector rather than a default argument: `undefined` is not "absent". */
const keylessCollectorFor = (store: MacroMarketStore, transport: RealMarketApiTransport) =>
  createRealMarketApiCollector({ store, transport, credentials: async () => undefined })

describe('the real dollar index collector', () => {
  it('backfills five-minute history for both instruments on its first tick, then reads one bar each', async () => {
    const store = withDeepBackfillDone(openStore())
    const { transport, urls } = transportFor()
    const collector = collectorFor(store, transport)

    // No history and no force flag: the first tick of a fresh profile has no phase to be late for.
    await expect(collector.run(at(0))).resolves.toEqual({
      state: 'stored', plan: 'backfill', added: 6, credits: 4, series: [series, goldSeries]
    })
    // One price leg and one history leg per instrument — both on the five-minute bar that is recorded.
    expect(urls).toHaveLength(4)
    expect(urls[0]).toContain('/api/v1/price?')
    expect(urls[0]).toContain('symbolCode=DXY')
    expect(urls[0]).toContain('timeFrame=M5')
    expect(urls[1]).toContain('/api/v1/candle?')
    expect(urls[1]).toContain('symbolCode=DXY')
    expect(urls[1]).toContain('timeFrame=M5')
    // A week of five-minute bars, which is what the longest window on the wire needs.
    expect(urls[1]).toContain(`limit=${macroMarketBackfillBars(5 * 60_000)}`)
    expect(urls[2]).toContain('/api/v1/price?')
    expect(urls[2]).toContain('symbolCode=XAUUSD')
    expect(urls[3]).toContain('/api/v1/candle?')
    expect(urls[3]).toContain('symbolCode=XAUUSD')
    // The price leg's own bar is stored first, so the fresher close survives the backfill's duplicate.
    expect(store.latest(series)).toEqual({ atMs: Date.UTC(2026, 9, 14, 11, 30), value: 102.236 })
    expect(store.latest(goldSeries)).toEqual({ atMs: Date.UTC(2026, 9, 14, 11, 30), value: 4180.5 })
    expect(store.count(series)).toBe(3)
    expect(store.count(goldSeries)).toBe(3)
    expect(store.readNote(realMarketApiPolicy.notes.lastPlan)).toBe('backfill')
    expect(store.readNote(realMarketApiPolicy.notes.lastRunAtMs)).toBe(String(at(0)))
    expect(store.readNote(realMarketApiBackfillNote(series))).toBe(String(at(0)))
    expect(store.readNote(realMarketApiBackfillNote(goldSeries))).toBe(String(at(0)))
    store.close()
  })

/** A page for one rung of the deep backfill: `count` bars, `stepMs` apart, ending at the newest one. */
function ladderPage(symbolCode: string, newestAtMs: number, stepMs: number, count: number) {
  return {
    data: Array.from({ length: count }, (_, index) => ({
      symbolCode, openPrice: 100, closePrice: 100 + index, highPrice: 101, lowPrice: 99, volume: 1,
      openTime: new Date(newestAtMs - index * stepMs).toISOString()
    }))
  }
}

/**
 * The provider as it would have to behave for a week to arrive in one tick: a page holds as many bars
 * as this product asks for, so the deeper time frames reach further back.
 */
function deepTransportFor(options: Readonly<{ refuse?: string; pageBars?: number }> = {}) {
  const urls: string[] = []
  const newestAtMs = Date.UTC(2026, 9, 14, 11, 30)
  const transport: RealMarketApiTransport = async url => {
    urls.push(url)
    const parsed = new URL(url)
    const symbol = parsed.searchParams.get('symbolCode') ?? 'DXY'
    const timeFrame = parsed.searchParams.get('timeFrame') ?? 'M5'
    if (parsed.pathname.endsWith('/price')) {
      return { state: 'ok', status: 200, body: symbol === 'XAUUSD' ? goldPriceResponse : realMarketApiPriceResponse }
    }
    if (options.refuse === timeFrame) return { state: 'ok', status: 403, body: { message: 'plan does not include this time frame' } }
    const stepMs = { M5: 5 * 60_000, M15: 15 * 60_000, H1: 3_600_000, H4: 4 * 3_600_000 }[timeFrame]!
    const rows = options.pageBars ?? Number(parsed.searchParams.get('limit'))
    return { state: 'ok', status: 200, body: ladderPage(symbol, newestAtMs, stepMs, rows) }
  }
  return { transport, urls }
}

describe('the licensed source\'s one-time deep backfill', () => {
  it('asks a ladder of time frames once, deep enough that the seven-day window can be answered', async () => {
    const store = openStore()
    const { transport, urls } = deepTransportFor()
    await collectorFor(store, transport).run(at(0))

    // A page is capped at about a day of bars, so the deeper rungs are what reach a week back.
    const candleTimeFrames = urls.filter(url => url.includes('/api/v1/candle')).map(url => new URL(url).searchParams.get('timeFrame'))
    expect(candleTimeFrames).toEqual(['M5', 'M15', 'H1', 'H4', 'M5', 'M15', 'H1', 'H4'])
    expect(urls.filter(url => url.includes('timeFrame=H1'))[0]).toContain(`limit=${macroMarketBackfillBars(3_600_000)}`)
    expect(urls.filter(url => url.includes('timeFrame=H4'))[0]).toContain(`limit=${macroMarketBackfillBars(14_400_000)}`)

    // The point of the whole exercise: the longest window now computes instead of reading as blank.
    expect(macroMarketReturn(store, series, '7d')).toMatchObject({ state: 'available' })
    expect(macroMarketReturn(store, goldSeries, '7d')).toMatchObject({ state: 'available' })
    // What each rung actually returned is left in the store, so the provider's own ceiling is readable.
    const evidence = store.readNote(realMarketApiDeepBackfillNote(series, 'evidence')) ?? ''
    for (const timeFrame of ['M5', 'M15', 'H1', 'H4']) expect(evidence).toContain(`${timeFrame}:`)
    expect(store.readNote(realMarketApiDeepBackfillNote(series, 'ranAtMs'))).toBe(String(at(0)))
    store.close()
  })

  it('repairs the history even when the ordinary backfill is not due yet', async () => {
    const store = openStore()
    // What a running app looks like on the tick after a restart: an older build armed the six-hour gate
    // minutes ago, and the series is still short. The repair must not queue behind that gate — waiting
    // for it is exactly how the week stayed missing while every tick reported `stored`.
    for (const seriesId of [series, goldSeries]) store.note(realMarketApiBackfillNote(seriesId), String(at(0) - 22 * 60_000))
    const { transport, urls } = deepTransportFor()
    await collectorFor(store, transport).run(at(0))

    expect(urls.filter(url => url.includes('timeFrame=H4'))).toHaveLength(2)
    expect(macroMarketReturn(store, series, '7d')).toMatchObject({ state: 'available' })
    expect(store.readNote(realMarketApiDeepBackfillNote(series, 'ranAtMs'))).toBe(String(at(0)))
    store.close()
  })

  it('never asks the ladder twice, even though the history is still short', async () => {
    const store = openStore()
    // Eight bars per rung leaves the series well short of a week, which is the case that tempts a retry.
    const { transport, urls } = deepTransportFor({ pageBars: 8 })
    const collector = collectorFor(store, transport)
    await collector.run(at(0))
    const afterFirst = urls.length
    // Six hours later the ordinary thin-history retry is due, and the series is still short of a week.
    await collector.run(at(0) + realMarketApiPolicy.backfillRetryMs)

    const later = urls.slice(afterFirst).filter(url => url.includes('/api/v1/candle'))
    // One rung per instrument — the ordinary backfill — not the ladder all over again.
    expect(later.map(url => new URL(url).searchParams.get('timeFrame'))).toEqual(['M5', 'M5'])
    expect(store.readNote(realMarketApiDeepBackfillNote(series, 'ranAtMs'))).toBe(String(at(0)))
    store.close()
  })

  it('keeps the level and the rungs that answered when one rung is refused', async () => {
    const store = openStore()
    const { transport } = deepTransportFor({ refuse: 'H4' })
    await expect(collectorFor(store, transport).run(at(0))).resolves.toMatchObject({ state: 'stored', credits: 10 })

    // A refused rung is not the instrument failing: the level and the nearer rungs are still stored.
    expect(store.latest(series)).toBeDefined()
    const evidence = store.readNote(realMarketApiDeepBackfillNote(series, 'evidence')) ?? ''
    expect(evidence).toContain('H4:0')
    expect(evidence).toContain('H1:')
    store.close()
  })

  it('counts a ladder that came back empty as run, so it cannot repeat forever', async () => {
    const store = openStore()
    const urls: string[] = []
    const transport: RealMarketApiTransport = async url => {
      urls.push(url)
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/price')) {
        return { state: 'ok', status: 200, body: requestedSymbol(url) === 'XAUUSD' ? goldPriceResponse : realMarketApiPriceResponse }
      }
      return { state: 'ok', status: 200, body: { data: [] } }
    }
    const collector = collectorFor(store, transport)
    await expect(collector.run(at(0))).resolves.toMatchObject({ state: 'stored' })
    expect(store.readNote(realMarketApiDeepBackfillNote(realMarketApiPolicy.series.dollarIndex, 'ranAtMs'))).toBe(String(at(0)))
    expect(store.readNote(realMarketApiDeepBackfillNote(realMarketApiPolicy.series.dollarIndex, 'evidence'))).toContain('M5:0')

    const afterFirst = urls.length
    await collector.run(at(0) + realMarketApiPolicy.backfillRetryMs)
    expect(urls.slice(afterFirst).filter(url => url.includes('/api/v1/candle')).map(url => new URL(url).searchParams.get('timeFrame')))
      .toEqual(['M5', 'M5'])
    store.close()
  })
})

  it('keeps the instrument that answered when the provider refuses the other one', async () => {
    const store = openStore()
    // The gold symbol is not on the plan; the dollar is. One instrument's refusal is not the tick's.
    const transport: RealMarketApiTransport = async url => requestedSymbol(url) === 'XAUUSD'
      ? { state: 'ok', status: 403, body: { status: 'error', code: 403 } }
      : { state: 'ok', status: 200, body: instrumentBody(url) }
    const result = await collectorFor(store, transport).run(at(0))

    expect(result).toMatchObject({
      state: 'stored', added: 3, series: [series],
      failures: [{ symbolCode: 'XAUUSD', failureCode: 'plan-restricted' }]
    })
    expect(store.count(series)).toBe(3)
    expect(store.count(goldSeries)).toBe(0)
    // The refusal is left where it can be read, and the tick still armed the cadence it did serve.
    expect(store.readNote(realMarketApiPolicy.notes.lastFailureCode)).toBe('plan-restricted')
    expect(store.readNote(realMarketApiPolicy.notes.lastSymbolFailures)).toBe('XAUUSD:plan-restricted')
    expect(store.readNote(realMarketApiPolicy.notes.lastRunAtMs)).toBe(String(at(0)))
    store.close()
  })

  it('collects on its own five-minute cadence and no sooner, measured from the last successful tick', async () => {
    const store = withDeepBackfillDone(openStore())
    const { transport, urls } = transportFor()
    const collector = collectorFor(store, transport)

    await expect(collector.run(at(0), { force: true })).resolves.toMatchObject({ state: 'stored' })
    await expect(collector.run(at(1))).resolves.toEqual({ state: 'idle', credits: 0 })
    // The interval trigger fires a moment after the boundary that armed it, so a tick that arrives a
    // little before the full five minutes has to be treated as due — otherwise the cadence doubles.
    await expect(collector.run(at(4))).resolves.toMatchObject({ state: 'unchanged', plan: 'latest' })
    // Two price legs per due tick, and each instrument's history leg only while its retry window is
    // open: the first tick backfilled both, the third read both prices and asked for no history.
    expect(urls).toHaveLength(6)
    // The second tick lands inside the bar the first one already stored, so nothing is written twice.
    expect(store.count(series)).toBe(3)
    expect(store.count(goldSeries)).toBe(3)
    store.close()
  })

  it('reports the provider\'s own failures and writes nothing at all', async () => {
    const cases = [
      // One price request per instrument is what a refused tick costs, on each of them.
      [{ price: { status: 401 } }, 'credential-rejected', 2],
      [{ price: { status: 403 } }, 'plan-restricted', 2],
      [{ price: { status: 429 } }, 'rate-limited', 2],
      [{ price: { failure: 'transport-unavailable' as const } }, 'transport-unavailable', 2],
      [{ price: { status: 200, body: { ...realMarketApiPriceResponse, closePrice: '102.237' } } }, 'response-invalid', 2],
      // The backfill is part of its instrument's tick: a page this product cannot read fails that
      // instrument rather than leaving a level stored beside a history nobody could read — so with
      // both of them unreadable the tick is unavailable, having spent two price and two candle legs.
      [{ candle: { body: { data: [] } } }, 'response-invalid', 4]
    ] as const
    for (const [routes, failureCode, credits] of cases) {
      // The ordinary backfill keeps its own rule: an unreadable history page fails that instrument.
      const store = withDeepBackfillDone(openStore())
      const { transport } = transportFor(routes)
      await expect(collectorFor(store, transport).run(at(0))).resolves.toEqual({ state: 'unavailable', failureCode, credits })
      expect(store.count(series)).toBe(0)
      expect(store.readNote(realMarketApiPolicy.notes.lastFailureCode)).toBe(failureCode)
      expect(store.readNote(realMarketApiPolicy.notes.lastRunAtMs)).toBeUndefined()
      store.close()
    }
  })

  it('asks for no key it does not have, and spends no request on one', async () => {
    const store = openStore()
    const { transport, urls } = transportFor()
    await expect(keylessCollectorFor(store, transport).run(at(0))).resolves.toEqual({
      state: 'unavailable', failureCode: 'credential-missing', credits: 0
    })
    expect(urls).toHaveLength(0)
    store.close()
  })

  it('retries a thin backfill only after six hours, so every tick is not two requests', async () => {
    const store = withDeepBackfillDone(openStore())
    const { transport, urls } = transportFor()
    const collector = collectorFor(store, transport)
    // The fixture's three bars leave the series too short for the 24h window, which is exactly the
    // provider-stingy case the guard exists for.
    await collector.run(at(0))
    await collector.run(at(5))
    // One history leg per instrument, and only on the tick whose retry window is open for it.
    expect(urls.filter(url => url.includes('/api/v1/candle'))).toHaveLength(2)
    // Six hours later the history is worth asking for again — for both series, on their own clocks.
    await collector.run(at(0) + realMarketApiPolicy.backfillRetryMs)
    expect(urls.filter(url => url.includes('/api/v1/candle'))).toHaveLength(4)
    store.close()
  })

  it('never writes the key anywhere it could be read back', async () => {
    const store = openStore()
    const { transport } = transportFor({ price: { status: 401 } })
    const captured: string[] = []
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(level => vi.spyOn(console, level)
      .mockImplementation((...args: unknown[]) => { captured.push(args.map(String).join(' ')) }))
    try {
      await collectorFor(store, transport).run(at(0))
      await collectorFor(store, transport).run(at(0), { force: true })
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    const keyFragment = TEST_KEY.slice(0, 12)
    expect(captured.join('\n')).not.toContain(keyFragment)
    // Nor in anything the store keeps: notes are codes and counters, never a URL.
    const stored = [realMarketApiPolicy.notes.lastPlan, realMarketApiPolicy.notes.lastRunAtMs, realMarketApiPolicy.notes.lastFailureCode]
      .map(note => store.readNote(note) ?? '').join(' ')
    expect(stored).not.toContain(keyFragment)
    expect(store.count()).toBe(0)
    store.close()
  })
})
