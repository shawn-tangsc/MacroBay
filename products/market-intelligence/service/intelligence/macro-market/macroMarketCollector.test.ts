import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMacroMarketCollector, seriesIdForSymbol } from './macroMarketCollector'
import { macroMarketPolicy } from './macroMarketPolicy'
import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'
import { macroMarketReturn, macroMarketBackfillBars } from './macroMarketReturns'

const at = (hour: number, minute: number) => Date.UTC(2026, 9, 14, hour, minute)
const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
const closes: Record<string, string> = {
  'EUR/USD': '1.12024', 'USD/JPY': '158.30893', 'GBP/USD': '1.32659', 'USD/CAD': '1.4202', 'USD/SEK': '9.95408', 'USD/CHF': '0.83237',
  'XAU/USD': '4159.73383', 'USD/CNH': '6.6924', 'USDT/USD': '0.99899'
}
const payloadSeries = (symbols: readonly string[], barAtMs: number, count: number) => Object.fromEntries(symbols.map(symbol => [symbol,
  { meta: { symbol },
    values: Array.from({ length: count }, (_, index) => ({ datetime: stamp(barAtMs - (count - 1 - index) * 15 * 60_000),
      open: closes[symbol], high: closes[symbol], low: closes[symbol], close: closes[symbol] })), status: 'ok' }]))
const payloadFor = (symbols: readonly string[], barAtMs: number) => payloadSeries(symbols, barAtMs, 1)
/** The symbols one request asked for, so a transport can answer what it was asked and nothing else. */
const requestedSymbols = (url: string): string[] => (new URL(url).searchParams.get('symbol') ?? '').split(',').filter(Boolean)
/** A transport that answers exactly what the URL asked for. */
const answering = (barAtMs: number, count = 1) => vi.fn(async (url: string) =>
  ({ state: 'ok' as const, status: 200, body: payloadSeries(requestedSymbols(url), barAtMs, count) }))

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function store(): MacroMarketStore {
  const directory = mkdtempSync(join(tmpdir(), 'macro-market-'))
  directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

describe('the macro-market collector', () => {
  it('stores the basket and publishes the synthetic dollar index from it', async () => {
    const target = store()
    const barAt = at(6, 0)
    const transport = answering(barAt)
    const result = await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 0) }).run()

    expect(result).toMatchObject({ state: 'stored', plan: 'dollar-basket', credits: 6 })
    // A fresh profile backfills the longest window, and that backfill goes one symbol per request.
    expect(transport).toHaveBeenCalledTimes(macroMarketPolicy.tickSymbols.length)
    expect(transport.mock.calls[0]![0]).toContain('symbol=EUR%2FUSD')
    expect(target.count('eur-usd')).toBe(1)
    // Independent computation of ICE's formula over exactly these six closes.
    expect(target.latest('dxy-synthetic')?.value).toBeCloseTo(102.15264389424713, 6)
    // Re-reading the same bar fifteen minutes later (so the basket is due again) is a no-op, not a duplicate.
    expect(await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 15) }).run())
      .toMatchObject({ state: 'unchanged', added: 0 })
    target.close()
  })

  it('refuses a page that is missing a basket term instead of storing half a basket', async () => {
    const target = store()
    const incomplete = macroMarketPolicy.tickSymbols.filter(symbol => symbol !== 'USD/SEK')
    const transport = async () => ({ state: 'ok' as const, status: 200, body: payloadFor(incomplete, at(6, 15)) })
    const result = await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 15) }).run()

    // Half a basket is not a basket: the page is refused, nothing is stored, and the missing term is
    // recorded so the next run's diagnosis does not have to guess.
    expect(result).toMatchObject({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(target.readNote('missingSymbols')).toBe('USD/SEK')
    expect(target.count()).toBe(0)
    expect(target.latest('dxy-synthetic')).toBeUndefined()
    target.close()
  })

  it('fetches the extra series on their own tick, and nothing at all between ticks', async () => {
    const target = store()
    // The basket was collected a moment ago, so this tick belongs to the extras — elapsed time
    // decides the plan, never the wall-clock minute the job happens to fire on.
    target.note('lastBasketAtMs', String(at(6, 0)))
    // The provider's 15-minute bars close on the quarter hour whatever minute we ask at.
    const transport = vi.fn(async () => ({ state: 'ok' as const, status: 200, body: payloadFor(macroMarketPolicy.halfCadenceSymbols, at(6, 0)) }))
    const extras = await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 5) }).run()
    expect(extras).toMatchObject({ state: 'stored', plan: 'extras', credits: 2 })
    // Gold is not this source's anymore: the licensed provider collects it on the five-minute tick.
    expect(target.latest('xau-usd')).toBeUndefined()
    expect(target.latest('usd-cnh')?.value).toBeCloseTo(6.6924, 4)
    expect(target.latest('usdt-usd')?.value).toBeCloseTo(0.99899, 5)
    expect(seriesIdForSymbol('USD/CHF')).toBe('usd-chf')

    const idleTransport = vi.fn()
    // Both kinds are recent enough that this tick neither spends a credit nor calls out.
    target.note('lastBasketAtMs', String(at(6, 15)))
    target.note('lastExtrasAtMs', String(at(6, 5)))
    const idle = await createMacroMarketCollector({ transport: idleTransport, store: target, credentials: async () => 'key', now: () => at(6, 20) }).run()
    expect(idle).toEqual({ state: 'idle', credits: 0 })
    expect(idleTransport).not.toHaveBeenCalled()
    target.close()
  })

  it('asks for a week of history while the series is too thin, then settles on two bars', async () => {
    const target = store()
    const barAt = at(6, 0)
    const transport = answering(barAt)
    const collector = createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => barAt })
    await collector.run()
    // Nothing stored yet: the first tick backfills the longest window the wire admits, instead of the
    // day it used to ask for — a day cannot answer a week, which is why the 7d cell stayed empty.
    expect(macroMarketPolicy.backfillOutputsize).toBe(macroMarketBackfillBars(macroMarketPolicy.intervalMs))
    // One symbol per request: the provider truncates a six-symbol page at that size, and a credit is
    // spent per symbol either way, so splitting the backfill costs nothing.
    expect(transport).toHaveBeenCalledTimes(macroMarketPolicy.tickSymbols.length)
    for (const [url] of transport.mock.calls) {
      expect(requestedSymbols(url)).toHaveLength(1)
      expect(url).toContain(`outputsize=${macroMarketPolicy.backfillOutputsize}`)
    }
    expect(target.readNote('lastOutputsize')).toBe(String(macroMarketPolicy.backfillOutputsize))
    // One bar each is still no window at all, so the next tick backfills again rather than settling.
    await collector.run(at(6, 15))
    expect(transport.mock.calls[macroMarketPolicy.tickSymbols.length]![0]).toContain(`outputsize=${macroMarketPolicy.backfillOutputsize}`)
    target.close()
  })

  it('settles on the ordinary two-bar tick once a full backfill has landed', async () => {
    const target = store()
    let barAt = at(6, 0)
    const transport = vi.fn(async (url: string) => {
      const size = Number(new URL(url).searchParams.get('outputsize'))
      return { state: 'ok' as const, status: 200,
        body: payloadSeries(requestedSymbols(url), barAt, size === macroMarketPolicy.backfillOutputsize ? macroMarketPolicy.backfillOutputsize : macroMarketPolicy.outputsize) }
    })
    const collector = createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => barAt })
    await collector.run()
    // The backfilled week now answers every window, so the next basket tick is a two-bar read again.
    expect(target.count('dxy-synthetic')).toBe(macroMarketPolicy.backfillOutputsize)
    barAt = at(6, 15)
    expect(await collector.run(barAt)).toMatchObject({ state: 'stored', plan: 'dollar-basket' })
    expect(target.readNote('lastOutputsize')).toBe(String(macroMarketPolicy.outputsize))
    target.close()
  })

  it('stores every point of a backfill rather than the first batch of them', async () => {
    const target = store()
    // Six symbols of a hundred bars each is well past the storage batch limit; the first version of
    // the write loop kept the first 256 points and dropped the synthetic index that came last.
    const bars = macroMarketPolicy.tickSymbols.length * macroMarketPolicy.backfillOutputsize
    const transport = answering(at(6, 0), macroMarketPolicy.backfillOutputsize)
    const result = await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 0) }).run()

    expect(result).toMatchObject({ state: 'stored' })
    // The pairs, plus one synthetic index point per bar where all six currencies meet — the index
    // carries the same history they do, which is what makes the longer windows answerable at all.
    expect(target.count()).toBe(bars + macroMarketPolicy.backfillOutputsize)
    expect(target.count('dxy-synthetic')).toBe(macroMarketPolicy.backfillOutputsize)
    for (const symbol of macroMarketPolicy.tickSymbols) expect(target.count(seriesIdForSymbol(symbol))).toBe(macroMarketPolicy.backfillOutputsize)
    // And that stored week is exactly what the 7d window needs: it answers from the first run.
    expect(macroMarketReturn(target, 'dxy-synthetic', '7d').state).toBe('available')
    target.close()
  })

  it('refuses a page that is missing one of the symbols it asked for', async () => {
    const target = store()
    const short = macroMarketPolicy.tickSymbols.filter(symbol => symbol !== 'USD/CHF')
    const transport = async () => ({ state: 'ok' as const, status: 200, body: payloadFor(short, at(6, 0)) })
    const result = await createMacroMarketCollector({ transport, store: target, credentials: async () => 'key', now: () => at(6, 0) }).run()

    // A partial page is refused rather than stored as if it were the whole basket.
    expect(result).toMatchObject({ state: 'unavailable', failureCode: 'response-invalid' })
    expect(target.readNote('missingSymbols')).toBe('USD/CHF')
    expect(target.count()).toBe(0)
    target.close()
  })

  it('reports a metered provider and a missing credential without pretending to have data', async () => {
    const target = store()
    const limited = await createMacroMarketCollector({ transport: async () => ({ state: 'ok', status: 429, body: { code: 429, status: 'error' } }),
      store: target, credentials: async () => 'key', now: () => at(6, 0) }).run()
    expect(limited).toMatchObject({ state: 'unavailable', failureCode: 'rate-limited' })

    const noCredential = await createMacroMarketCollector({ transport: vi.fn(), store: target, credentials: async () => undefined, now: () => at(6, 0) }).run()
    expect(noCredential).toMatchObject({ state: 'unavailable', failureCode: 'credential-missing' })
    expect(target.count()).toBe(0)

    const transportDown = await createMacroMarketCollector({ transport: async () => ({ state: 'unavailable', failureCode: 'transport-unavailable' }),
      store: target, credentials: async () => 'key', now: () => at(6, 0) }).run()
    expect(transportDown).toMatchObject({ failureCode: 'transport-unavailable' })
    target.close()
  })

  it('returns the change over the window the clock asks for, and refuses a window with a hole', () => {
    const target = store()
    const point = (minute: number, value: number) => ({ series: 'dxy-synthetic', atMs: at(6, 0) + 0 + minute * 60_000, value, observedAtMs: at(6, minute) })
    target.append([point(-120, 100), point(-60, 101), point(-45, 101.5), point(0, 102)])
    const now = at(6, 0)
    expect(macroMarketReturn(target, 'dxy-synthetic', '1h', now)).toEqual({ state: 'available', percent: (102 / 101 - 1) * 100 })
    // 15m needs the bar at -15m, which was never stored: "insufficient", never the change since -45m.
    expect(macroMarketReturn(target, 'dxy-synthetic', '15m', now)).toEqual({ state: 'unavailable', reason: 'insufficient' })
    expect(macroMarketReturn(target, 'missing-series', '1h', now)).toEqual({ state: 'unavailable', reason: 'missing' })
    target.close()
  })
})
