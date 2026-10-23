import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMacroMarketSnapshotQuery } from './macroMarketSnapshotQuery'
import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'
import { macroMarketPolicy } from './macroMarketPolicy'
import { goldLivePolicy } from './goldLivePolicy'
import { createMacroMarketLive } from './macroMarketLive'
import { createGoldLiveRuntime, type GoldLiveRuntime } from './goldLiveRuntime'
import { createGoldLiveStream } from './goldLiveStream'
import { fakeSocketFactory, goldTick, testClock } from './goldLiveTestKit'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
/** The provider tick's own seconds timestamp: 1647950462 → 2022-03-22T11:21:02Z. */
const tickAt = 1647950462_000
const minute = 60_000

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
function runtime(overrides: {
  sockets?: ReturnType<typeof fakeSocketFactory>
  clock?: ReturnType<typeof testClock>
  enabled?: boolean
  credentialRef?: string | null
  apiKey?: string | null
} = {}) {
  const sockets = overrides.sockets ?? fakeSocketFactory()
  const clock = overrides.clock ?? testClock(tickAt)
  const key = overrides.apiKey === undefined ? 'test-key' : overrides.apiKey
  const gold = createGoldLiveRuntime({
    resolveProfile: async () => ({ credentialRef: overrides.credentialRef === undefined ? 'twelve-data-market' : overrides.credentialRef, enabled: overrides.enabled ?? true }),
    getCredential: async () => key ?? undefined,
    createStream: input => createGoldLiveStream({ platformWebSocket: sockets.constructor, ...input }),
    now: clock.now,
    scheduler: clock.scheduler,
    random: () => 0
  })
  return { gold, sockets, clock }
}

/**
 * The retry that is armed next. The readiness re-check is also on the clock, so a test that took the
 * first scheduled entry would assert against the poll rather than against the backoff.
 */
function nextRetry(clock: ReturnType<typeof testClock>) {
  const retry = clock.pending()[0]
  if (!retry) throw new Error('no retry was armed')
  return retry
}

describe('the gold live runtime', () => {
  it('never connects while the source is switched off, and says so instead of "no credential"', async () => {
    const { gold, sockets } = runtime({ enabled: false })
    await gold.reconcile()
    expect(sockets.created).toHaveLength(0)
    expect(gold.snapshot()).toEqual({ state: 'disabled', hasCredential: false })
    await gold.dispose()
  })

  it('never connects without a stored key, and does not connect on the next input either', async () => {
    const { gold, sockets } = runtime({ apiKey: null })
    await gold.reconcile()
    expect(sockets.created).toHaveLength(0)
    expect(gold.snapshot()).toEqual({ state: 'disabled', hasCredential: false })
    await gold.reconcile()
    expect(sockets.created).toHaveLength(0)
    await gold.dispose()
  })

  it('connects when enabled and keyed, reporting connecting until a tick lands', async () => {
    const { gold, sockets } = runtime()
    await gold.reconcile()
    expect(sockets.created).toHaveLength(1)
    expect(gold.snapshot().state).toBe('connecting')
    expect(gold.snapshot()).toMatchObject({ state: 'connecting', hasCredential: true })
    sockets.socket().open()
    sockets.socket().message(goldTick())
    expect(gold.snapshot()).toMatchObject({ state: 'live', tick: { price: '1925.18', atMs: tickAt } })
    await gold.dispose()
  })

  it('drops the socket and retries on an exponential, jittered delay after a disconnect', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    const first = sockets.socket()
    first.open()
    first.message(goldTick())
    expect(gold.snapshot().state).toBe('live')

    first.dead()
    expect(gold.snapshot().state).toBe('unavailable')
    expect(first.closed).toBe(1)
    // First retry: the first rung of the policy ladder, with zero jitter under the injected source.
    expect(nextRetry(clock).at - clock.now()).toBe(goldLivePolicy.reconnect.delaysMs[0])

    await clock.runNext()
    expect(sockets.created).toHaveLength(2)
    expect(gold.snapshot().state).toBe('connecting')
    sockets.latest().dead()
    // Second failure: the ladder steps up rather than hammering the provider.
    expect(nextRetry(clock).at - clock.now()).toBe(goldLivePolicy.reconnect.delaysMs[1])
    await clock.runNext()
    expect(sockets.created).toHaveLength(3)
    await gold.dispose()
  })

  it('reuses the connection across reconciles, and closes it when the reader switches the source off', async () => {
    let enabled = true
    const sockets = fakeSocketFactory()
    const clock = testClock(tickAt)
    const gold = createGoldLiveRuntime({
      resolveProfile: async () => ({ credentialRef: 'twelve-data-market', enabled }),
      getCredential: async () => 'test-key',
      createStream: input => createGoldLiveStream({ platformWebSocket: sockets.constructor, ...input }),
      now: clock.now, scheduler: clock.scheduler, random: () => 0
    })
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    await gold.reconcile()
    expect(sockets.created).toHaveLength(1)
    expect(gold.snapshot().state).toBe('live')

    enabled = false
    await gold.reconcile()
    expect(sockets.socket().closed).toBe(1)
    expect(sockets.created).toHaveLength(1)
    expect(gold.snapshot().state).toBe('disabled')
    await gold.dispose()
  })

  it('closes the socket and cancels every pending timer on dispose', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    const socket = sockets.socket()
    socket.dead()
    expect(clock.pending().length).toBeGreaterThan(0)
    await gold.dispose()
    expect(socket.closed).toBe(1)
    // Nothing may fire after disposal: a retry armed before shutdown must be cancelled, not raced.
    await clock.advance(clock.now() + 10 * minute)
    expect(sockets.created).toHaveLength(1)
    expect(gold.snapshot().state).toBe('disabled')
  })

  it('keeps the retrying state stable while a retry is already armed', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    sockets.socket().dead()
    const armed = nextRetry(clock)
    await gold.reconcile()
    await gold.reconcile()
    // Still one physical socket and the same armed retry: a reconcile must not stack up connections.
    expect(sockets.created).toHaveLength(1)
    expect(nextRetry(clock)).toBe(armed)
    expect(gold.snapshot().state).toBe('unavailable')
    await gold.dispose()
  })

  it('reports a refused subscription and retries it rather than pretending to be live', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(JSON.stringify({ event: 'subscribe-status', status: 'error', code: 'plan-restricted' }))
    expect(gold.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'plan-restricted' })
    // A refusal that would repeat forever still backs off, and the socket it refused is gone.
    expect(sockets.socket().closed).toBe(1)
    expect(nextRetry(clock).at - clock.now()).toBe(goldLivePolicy.reconnect.delaysMs[0])
    await gold.dispose()
  })

  it('names the stream unavailable, not disabled, while a connection is still being attempted', async () => {
    const sockets = fakeSocketFactory()
    const clock = testClock(tickAt)
    const gold = createGoldLiveRuntime({
      resolveProfile: async () => { throw new Error('profile store offline') },
      getCredential: async () => undefined,
      createStream: input => createGoldLiveStream({ platformWebSocket: sockets.constructor, ...input }),
      now: clock.now, scheduler: clock.scheduler, onError: () => undefined
    })
    await gold.reconcile()
    expect(sockets.created).toHaveLength(0)
    expect(gold.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'transport-unavailable' })
    await gold.dispose()
  })
})

/**
 * The keepalive as the runtime sees it: it rides the runtime's injected scheduler, it survives a
 * reconcile, and it never outlives the connection that owns it.
 */
describe('the gold live keepalive through the runtime', () => {
  const interval = goldLivePolicy.heartbeat.intervalMs

  it('keeps the connection alive on the policy interval, and leave the tick alone', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    expect(gold.snapshot()).toMatchObject({ state: 'live', tick: { price: '1925.18', atMs: tickAt } })

    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(1)
    // A beat is not a tick: it must not move the price or disturb the state.
    expect(gold.snapshot()).toMatchObject({ state: 'live', tick: { price: '1925.18', atMs: tickAt } })
    await gold.dispose()
  })

  it('holds exactly one heartbeat timer across repeated reconciles', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    await gold.reconcile()
    await gold.reconcile()

    // One interval, one beat. Two armed keepalives would put two frames on the wire in one step,
    // which is what a reconcile that re-armed the timer behind the first would look like.
    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(1)
    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(2)
    // Still the one connection, so the one keepalive is the connection's, not a reconcile's.
    expect(sockets.created).toHaveLength(1)
    await gold.dispose()
  })

  it('moves the keepalive to the new connection on a reconnect and abandons the old one', async () => {
    const { gold, sockets, clock } = runtime()
    await gold.reconcile()
    const first = sockets.socket()
    first.open()
    first.message(goldTick())
    await clock.stepBy(interval)
    expect(first.heartbeats()).toHaveLength(1)

    first.dead()
    const beatsWhenClosed = first.heartbeats().length
    // The keepalive that was armed one interval out is gone, so nothing can fire at a closed socket;
    // what remains is the retry the close armed, at the first rung of the policy ladder.
    expect(clock.pending().some(entry => entry.at - clock.now() === interval)).toBe(false)
    expect(nextRetry(clock).at - clock.now()).toBe(goldLivePolicy.reconnect.delaysMs[0])
    await clock.runNext()
    expect(sockets.created).toHaveLength(2)
    const second = sockets.latest()
    second.open()
    for (const expected of [1, 2, 3]) {
      await clock.stepBy(interval)
      expect(second.heartbeats()).toHaveLength(expected)
    }
    // The socket that died has heard nothing since: a reconnect must not inherit its keepalive.
    expect(first.heartbeats()).toHaveLength(beatsWhenClosed)
    await gold.dispose()
  })
})
