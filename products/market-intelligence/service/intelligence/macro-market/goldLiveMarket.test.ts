import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseMacroMarketSnapshot } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { createMacroMarketSnapshotQuery } from './macroMarketSnapshotQuery'
import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'
import { macroMarketPolicy } from './macroMarketPolicy'
import { goldLivePolicy } from './goldLivePolicy'
import { createMacroMarketLive } from './macroMarketLive'
import { createGoldLiveRuntime, type GoldLiveRuntime } from './goldLiveRuntime'
import { createGoldLiveStream } from './goldLiveStream'
import {
  fakeSocketFactory, goldRealPrice, goldRealPriceFrame, goldRealPriceFrameAtMs, goldTick, testClock
} from './goldLiveTestKit'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
/** The provider tick's own seconds timestamp: 1647950462 → 2022-03-22T11:21:02Z. */
const tickAt = 1647950462_000

function market() {
  const directory = mkdtempSync(join(tmpdir(), 'macro-live-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

/** One closed bar every fifteen minutes for the last day, so every window has a closed answer. */
function seed(store: MacroMarketStore, endMs: number): void {
  const intervalMs = macroMarketPolicy.intervalMs
  const points = Array.from({ length: 97 }, (_, index) => ({
    series: macroMarketPolicy.series.gold, atMs: endMs - (96 - index) * intervalMs, value: 1900 + index, observedAtMs: endMs
  }))
  store.append(points)
}

/** `null` means "the store holds no key", which has to be distinct from an omitted option. */
function runtime(overrides: { sockets?: ReturnType<typeof fakeSocketFactory>; clock?: ReturnType<typeof testClock>; enabled?: boolean; apiKey?: string | null } = {}) {
  const sockets = overrides.sockets ?? fakeSocketFactory()
  const clock = overrides.clock ?? testClock(tickAt)
  const key = overrides.apiKey === undefined ? 'test-key' : overrides.apiKey
  const gold = createGoldLiveRuntime({
    resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: overrides.enabled ?? true }),
    getCredential: async () => key ?? undefined,
    createStream: input => createGoldLiveStream({ platformWebSocket: sockets.constructor, ...input }),
    now: clock.now, scheduler: clock.scheduler, random: () => 0
  })
  return { gold, sockets, clock }
}

describe('the gold stream and the closed bars', () => {
  const snapshotOf = (store: MacroMarketStore, live: GoldLiveRuntime, atMs: number) =>
    createMacroMarketSnapshotQuery({ store, now: () => atMs, live: live.snapshot }).snapshot()

  it('carries the live tick beside the gold level without moving a single window return', async () => {
    const store = market()
    const endMs = tickAt
    seed(store, endMs)
    const { gold, sockets } = runtime()
    const before = snapshotOf(store, gold, endMs)
    const goldBefore = before.readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    // The wire carries the producer's own ladder — 15m/1h/4h/24h — while the table prints four of
    // those windows. 7d is a real absence, not a gap in the fixture: this store holds hours of data,
    // so there is no seven-day-old bar to difference against and the window stays unanswered.
    expect(Object.keys(goldBefore.returns).sort()).toEqual(['15m', '1h', '24h', '4h'])
    expect(goldBefore.live).toBeUndefined()

    await gold.reconcile()
    sockets.socket().open()
    // A tick far away from the last close: if it leaked into a window, 15m would move by percent.
    sockets.socket().message(goldTick({ price: 2100 }))
    const after = snapshotOf(store, gold, endMs)
    const goldAfter = after.readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    expect(goldAfter.live).toEqual({ state: 'live', price: '2100', atMs: tickAt })
    // The level and every window return are byte-for-byte what the store answered before the tick.
    expect(goldAfter.returns).toEqual(goldBefore.returns)
    expect(goldAfter.level).toBe(goldBefore.level)
    expect(goldAfter.atMs).toBe(goldBefore.atMs)
    // And the store itself is untouched: the live module holds no store reference at all.
    expect(store.latest(macroMarketPolicy.series.gold)).toEqual({ atMs: endMs, value: 1996 })
    expect(store.count(macroMarketPolicy.series.gold)).toBe(97)
    await gold.dispose()
    store.close()
  })

  it('carries the real provider frame from the socket into the snapshot the contract admits', async () => {
    // The whole chain the 最新 cell reads, driven by the frame a real key produced: socket → stream →
    // runtime → snapshot query → product boundary. The clock is the frame's own arrival, one second
    // after the instant it stamps, so the tick is fresh rather than clamped or delayed.
    const store = market()
    seed(store, goldRealPriceFrameAtMs)
    const { gold, sockets, clock } = runtime({ clock: testClock(goldRealPriceFrameAtMs + 1_000) })
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldRealPriceFrame)

    const snapshot = snapshotOf(store, gold, clock.now())
    const goldReading = snapshot.readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    expect(goldReading.live).toEqual({ state: 'live', price: goldRealPrice, atMs: goldRealPriceFrameAtMs })
    expect(typeof goldReading.live?.price).toBe('string')
    // The contract that crosses to the renderer admits it as it stands: nothing about the wire shape
    // had to change for a numeric provider price, because normalisation happened before this point.
    const view = parseMacroMarketSnapshot({ ...snapshot, source: { enabled: true, hasCredential: true } })
    expect(view && 'readings' in view && view.readings.find(reading => reading.seriesId === 'xau-usd')?.live)
      .toEqual({ state: 'live', price: goldRealPrice, atMs: goldRealPriceFrameAtMs })
    await gold.dispose()
    store.close()
  })

  it('gives the live field to gold and to no other series', async () => {
    const store = market()
    const endMs = tickAt
    seed(store, endMs)
    for (const series of [macroMarketPolicy.series.dollarIndex, macroMarketPolicy.series.offshoreYuan, macroMarketPolicy.series.stablecoinPeg]) {
      store.append([{ series, atMs: endMs, value: 100, observedAtMs: endMs }])
    }
    const { gold, sockets } = runtime()
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick({ price: 2100 }))
    const snapshot = snapshotOf(store, gold, endMs)
    const withLive = snapshot.readings.filter(reading => reading.live).map(reading => reading.seriesId)
    expect(withLive).toEqual([macroMarketPolicy.series.gold])
    expect(snapshot.readings).toHaveLength(4)
    await gold.dispose()
    store.close()
  })

  it('reports a delayed tick as stale without touching the windows, and reports nothing when disabled', async () => {
    const store = market()
    const endMs = tickAt
    seed(store, endMs)
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick({ price: 2100 }))
    const live = snapshotOf(store, gold, endMs).readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    await clock.advance(tickAt + macroMarketPolicy.intervalMs)
    const stale = snapshotOf(store, gold, clock.now()).readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    expect(stale.live).toMatchObject({ state: 'stale', price: '2100' })
    expect(stale.returns).toEqual(live.returns)
    await gold.dispose()
    // A disposed stream says disabled and offers no tick: no figure survives the socket that produced it.
    const gone = snapshotOf(store, gold, clock.now()).readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    expect(gone.live).toBeUndefined()
    store.close()
  })

  it('omits the live field entirely when no stream is wired', () => {
    const store = market()
    seed(store, tickAt)
    const snapshot = createMacroMarketSnapshotQuery({ store, now: () => tickAt }).snapshot()
    expect(snapshot.readings.every(reading => reading.live === undefined)).toBe(true)
    store.close()
  })

  it('drops a tick that fails the wire contract rather than repairing it', async () => {
    const store = market()
    seed(store, tickAt)
    const live = () => ({ state: 'live' as const, tick: { price: '0', atMs: tickAt } })
    const snapshot = createMacroMarketSnapshotQuery({ store, now: () => tickAt, live }).snapshot()
    const reading = snapshot.readings.find(item => item.seriesId === macroMarketPolicy.series.gold)!
    expect(reading.live).toBeUndefined()
    expect(reading.level).toBe(1996)
    store.close()
  })
})

describe('the macro-market live composition', () => {
  it('reads the key through the profile credentialRef and never exposes it', async () => {
    const sockets = fakeSocketFactory()
    const getCredential = vi.fn(async () => ({ apiKey: 'secret-key' }))
    const gold = createMacroMarketLive({
      source: { resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: true }), getCredential },
      createWebSocket: () => sockets.constructor,
      now: () => tickAt, random: () => 0, scheduler: testClock(tickAt).scheduler
    })
    await gold.reconcile()
    expect(getCredential).toHaveBeenCalledWith('twelve-data-market')
    expect(sockets.socket().url).toContain('secret-key')
    // The snapshot never carries the credential, and neither does the request the renderer receives.
    expect(JSON.stringify(gold.snapshot())).not.toContain('secret-key')
    expect(Object.keys(gold.snapshot())).not.toContain('apiKey')
    await gold.dispose()
  })

  it('does not read the credential store at all when the source is switched off', async () => {
    const getCredential = vi.fn(async () => ({ apiKey: 'secret-key' }))
    const gold = createMacroMarketLive({
      source: { resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: false }), getCredential },
      createWebSocket: () => fakeSocketFactory().constructor,
      now: () => tickAt, random: () => 0, scheduler: testClock(tickAt).scheduler
    })
    await gold.reconcile()
    expect(getCredential).not.toHaveBeenCalled()
    expect(gold.snapshot().state).toBe('disabled')
    await gold.dispose()
  })

  it('refuses to build a stream when the platform socket was never handed over', async () => {
    const errors: unknown[] = []
    const gold = createMacroMarketLive({
      source: { resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: true }), getCredential: async () => ({ apiKey: 'k' }) },
      now: () => tickAt, random: () => 0, scheduler: testClock(tickAt).scheduler,
      onError: error => errors.push(error)
    })
    await gold.reconcile()
    expect(errors).toHaveLength(1)
    expect(gold.snapshot().state).toBe('unavailable')
    await gold.dispose()
  })

  it('carries the keepalive through the real composition on the injected scheduler', async () => {
    const clock = testClock(tickAt)
    const sockets = fakeSocketFactory()
    const gold = createMacroMarketLive({
      source: {
        resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled: true }),
        getCredential: async () => ({ apiKey: 'secret-key' })
      },
      createWebSocket: () => sockets.constructor,
      now: clock.now, scheduler: clock.scheduler, random: () => 0
    })
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick({ price: 2100 }))

    // Two injected intervals, two beats. With a real timer this would send nothing at all, so the
    // count is the proof that the scheduler is threaded from this composition to the socket.
    await clock.stepBy(goldLivePolicy.heartbeat.intervalMs, 2)
    expect(sockets.socket().heartbeats()).toHaveLength(2)
    expect(sockets.socket().sent[0]).toBe(JSON.stringify({ action: 'subscribe', params: { symbols: 'XAU/USD' } }))
    // And the tick is untouched by any of it.
    expect(gold.snapshot()).toMatchObject({ state: 'live', tick: { price: '2100', atMs: tickAt } })
    await gold.dispose()
    expect(clock.pending()).toEqual([])
  })
})
