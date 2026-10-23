import { describe, expect, it } from 'vitest'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { goldLivePolicy } from '../goldLivePolicy'
import { createMacroMarketSnapshotQuery } from '../macroMarketSnapshotQuery'
import type { MacroMarketStore } from '../macroMarketStore'
import { registerMacroMarketIpc } from './registerMacroMarketIpc'

const now = Date.parse('2026-09-14T12:00:00.000Z')
const intervalMs = 15 * 60_000
/** One point per bar over the last day, so every window the table shows has an answer. */
function series(points = 97): { atMs: number; value: number }[] {
  return Array.from({ length: points }, (_, index) => ({ atMs: now - (points - 1 - index) * intervalMs, value: 100 + index / 10 }))
}
function store(fixtures: Record<string, { atMs: number; value: number }[]>): MacroMarketStore {
  return {
    latest: (seriesId: string) => fixtures[seriesId]?.at(-1),
    series: (seriesId: string, fromMs: number, toMs: number) => (fixtures[seriesId] ?? []).filter(point => point.atMs >= fromMs && point.atMs <= toMs),
    readNote: () => undefined
  } as unknown as MacroMarketStore
}
function registered(
  fixtures: Record<string, { atMs: number; value: number }[]>,
  readiness: () => Promise<{ enabled: boolean; hasCredential: boolean }> = async () => ({ enabled: true, hasCredential: true }),
  live?: () => { state: 'disabled' | 'connecting' | 'live' | 'stale' | 'unavailable'; tick?: { price: string | number; atMs: number } }
) {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const register: ProductIpcRegistrar = (productId, method, handler) => { handlers.set(`${productId}:${method}`, handler) }
  const query = createMacroMarketSnapshotQuery({ store: store(fixtures), now: () => now, ...(live ? { live } : {}) })
  registerMacroMarketIpc(register, { snapshot: query.snapshot, readiness })
  return handlers.get(`market-intelligence:${macroMarketSnapshotPublicPolicy.method}`)!
}

/** The shape of a reading as it actually crosses to the renderer, for assertions on the live leg. */
type WireReading = { seriesId: string; level: number; atMs: number; returns: Record<string, number>; live?: { state: string; price: string; atMs: number } }
const goldReading = (result: unknown): WireReading =>
  (result as { readings: WireReading[] }).readings.find(reading => reading.seriesId === 'xau-usd')!

describe('macro market snapshot IPC', () => {
  it('answers the empty request with the sanitised dollar and gold readings', async () => {
    const result = await registered({ 'dxy-synthetic': series(), 'xau-usd': series() })({})
    expect(result).toMatchObject({ state: 'available', asOf: new Date(now).toISOString(), source: { enabled: true, hasCredential: true } })
    const readings = (result as { readings: { seriesId: string; synthetic?: true; returns: Record<string, number> }[] }).readings
    expect(readings.map(reading => reading.seriesId)).toEqual(['dxy-synthetic', 'xau-usd'])
    expect(readings[0].synthetic).toBe(true)
    // The wire carries the producer's ladder in its own order; 7d is honestly absent because the
    // seeded series is shorter than a week and has no anchor bar to difference against.
    expect(Object.keys(readings[0].returns)).toEqual(['15m', '1h', '4h', '24h'])
  })

  it('leaves both macro rows without data when the store has no points', async () => {
    expect(await registered({})({})).toEqual({
      state: 'empty', asOf: new Date(now).toISOString(), source: { enabled: true, hasCredential: true },
      readings: [], caveats: ['provider-time-series']
    })
  })

  it('carries the source switch and credential so the strip can name why a row is empty', async () => {
    const snapshot = await registered({}, async () => ({ enabled: false, hasCredential: true }))({})
    expect(snapshot).toMatchObject({ state: 'empty', source: { enabled: false, hasCredential: true } })
    const unkeyed = await registered({}, async () => ({ enabled: true, hasCredential: false }))({})
    expect(unkeyed).toMatchObject({ state: 'empty', source: { enabled: true, hasCredential: false } })
  })

  it.each([undefined, null, { asOf: '2026-09-14T12:00:00.000Z' }, { range: '24h' }, [], 'query'])(
    'rejects the non-empty request %o without touching the store', async payload => {
      expect(await registered({ 'dxy-synthetic': series() })(payload)).toEqual({ state: 'unavailable' })
    })

  it('collapses a failing query to unavailable rather than inventing a reading', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroMarketIpc(((productId, method, handler) => { handlers.set(`${productId}:${method}`, handler) }) as ProductIpcRegistrar,
      { snapshot: () => { throw new Error('store-unavailable') }, readiness: async () => ({ enabled: true, hasCredential: true }) })
    expect(await handlers.get(`market-intelligence:${macroMarketSnapshotPublicPolicy.method}`)!({})).toEqual({ state: 'unavailable' })
  })

  it('collapses a failing readiness read to unavailable as well', async () => {
    const handler = registered({ 'dxy-synthetic': series() }, async () => { throw new Error('profile-unavailable') })
    expect(await handler({})).toEqual({ state: 'unavailable' })
  })

  describe('the live gold tick on the wire', () => {
    const tick = { price: '3413.90', atMs: now - 1_000 }

    it('reaches the renderer as its own field on the gold reading, and on no other row', async () => {
      const result = await registered({ 'dxy-synthetic': series(), 'xau-usd': series() }, undefined, () => ({ state: 'live', tick }))({})
      const gold = goldReading(result)
      expect(gold.live).toEqual({ state: 'live', price: '3413.90', atMs: tick.atMs })
      // The window returns are the closed-bar figures; the tick moved none of them.
      expect(Object.keys(gold.returns)).toEqual(['15m', '1h', '4h', '24h'])
      const dollar = (result as { readings: WireReading[] }).readings[0]
      expect(dollar.live).toBeUndefined()
      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain('apikey')
      expect(serialised).not.toContain('apiKey')
    })

    it('stays absent when the stream has no tick, whatever state it is in', async () => {
      for (const state of ['disabled', 'connecting', 'stale', 'unavailable'] as const) {
        const result = await registered({ 'xau-usd': series() }, undefined, () => ({ state }))({})
        expect(goldReading(result).live).toBeUndefined()
        expect(goldReading(result).level).toBe(series().at(-1)!.value)
      }
    })

    it('keeps a delayed tick and labels it, rather than either hiding it or calling it live', async () => {
      const result = await registered({ 'xau-usd': series() }, undefined, () => ({ state: 'stale', tick }))({})
      expect(goldReading(result).live).toEqual({ state: 'stale', price: '3413.90', atMs: tick.atMs })
    })

    it('normalises the provider\'s numeric price into the string the wire carries', async () => {
      // The price socket really sends `"price":4144.04708` as a JSON number. The contract admits a
      // decimal string and only a string, so the number has to become one *before* this boundary —
      // and the snapshot the renderer reads still carries a string, so no renderer contract changed.
      const result = await registered({ 'xau-usd': series() }, undefined,
        () => ({ state: 'live', tick: { price: 4144.04708, atMs: now - 1_000 } }))({})
      const gold = goldReading(result)
      expect(gold.live).toEqual({ state: 'live', price: '4144.04708', atMs: now - 1_000 })
      expect(typeof gold.live?.price).toBe('string')
      // The number never reaches the wire as a number: the JSON the renderer parses holds a string.
      expect(JSON.stringify(result)).toContain('"price":"4144.04708"')
    })

    it.each([
      ['a zero price', { state: 'live' as const, tick: { price: '0', atMs: now } }],
      ['a numeric zero price', { state: 'live' as const, tick: { price: 0, atMs: now } }],
      ['a negative price', { state: 'live' as const, tick: { price: '-1', atMs: now } }],
      ['a numeric negative price', { state: 'live' as const, tick: { price: -1, atMs: now } }],
      ['a non-finite numeric price', { state: 'live' as const, tick: { price: Number.NaN, atMs: now } }],
      ['an infinite numeric price', { state: 'live' as const, tick: { price: Number.POSITIVE_INFINITY, atMs: now } }],
      ['an exponent price', { state: 'live' as const, tick: { price: '1.9e3', atMs: now } }],
      ['a non-decimal price', { state: 'live' as const, tick: { price: 'three thousand', atMs: now } }],
      ['an oversized price', { state: 'live' as const, tick: { price: `1${'0'.repeat(goldLivePolicy.maxPriceLength)}`, atMs: now } }],
      ['a missing price', { state: 'live' as const, tick: { atMs: now } as never }],
      ['a boolean price', { state: 'live' as const, tick: { price: true, atMs: now } as never }],
      ['a fractional instant', { state: 'live' as const, tick: { price: '3413.9', atMs: now + 0.5 } }],
      ['a missing instant', { state: 'live' as const, tick: { price: '3413.9', atMs: undefined as never } }]
    ])('drops %s before the wire, keeping the stored level', async (_label, source) => {
      const result = await registered({ 'xau-usd': series() }, undefined, () => source)({})
      // The malformed tick is dropped in the main process; the contract would have refused the whole
      // snapshot, and 未接入 is a worse answer than the stored level without a live badge.
      expect(result).not.toEqual({ state: 'unavailable' })
      const gold = goldReading(result)
      expect(gold.live).toBeUndefined()
      expect(gold.level).toBe(series().at(-1)!.value)
      // 7d is absent on purpose, not missing from this assertion: the seeded series is far shorter
      // than seven days, so the window has no bar to compare against and stays a stated gap. A
      // seven-day figure computed from two days of data is the one thing this row must never print.
      expect(Object.keys(gold.returns)).toEqual(['15m', '1h', '4h', '24h'])
    })
  })
})
