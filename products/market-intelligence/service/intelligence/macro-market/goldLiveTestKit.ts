import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import { goldLiveHeartbeat } from './goldLivePolicy'
import type { GoldLiveScheduler } from './goldLiveRuntime'

/**
 * Let every already-queued microtask run. A timer handler starts an async reconcile, and the state
 * it produces is only observable after that chain settles; this yields the macrotask queue, which
 * microtasks always drain ahead of, so a test asserts the *settled* result instead of a half-run one.
 */
const settle = (): Promise<void> => new Promise<void>(resolve => setImmediate(resolve))

/**
 * Deterministic timing for the gold stream. The real code schedules a reconnect with `setTimeout`;
 * a test must not wait for one. The clock and its microtask queue are stepped by hand, so a test
 * asserts *when* a retry was armed rather than sleeping until it happens.
 */
export function testClock(startMs = 1_000_000) {
  let current = startMs
  let sequence = 0
  let scheduled: { at: number; order: number; handler: () => void }[] = []
  const scheduler: GoldLiveScheduler = {
    setTimeout: (handler, delayMs) => {
      const entry = { at: current + Math.max(0, delayMs), order: sequence++, handler }
      scheduled.push(entry)
      return entry
    },
    clearTimeout: handle => { scheduled = scheduled.filter(entry => entry !== handle) }
  }
  return {
    now: () => current,
    scheduler,
    /** Timers still armed, in firing order. */
    pending: () => [...scheduled].sort((left, right) => left.at - right.at || left.order - right.order),
    /** Arm exactly one timer: the next retry's delay is assertable as a single number. */
    async runNext(): Promise<void> {
      const next = this.pending()[0]
      if (!next) throw new Error('no scheduled work to run')
      scheduled = scheduled.filter(entry => entry !== next)
      current = Math.max(current, next.at)
      next.handler()
      await settle()
    },
    /** Run everything due at or before `targetMs`, including work armed while draining. */
    async advance(targetMs: number): Promise<void> {
      if (targetMs < current) throw new Error('clock cannot move backwards')
      current = targetMs
      for (let guard = 0; guard < 100; guard++) {
        const next = this.pending().find(entry => entry.at <= targetMs)
        if (!next) return
        scheduled = scheduled.filter(entry => entry !== next)
        next.handler()
        await settle()
      }
      throw new Error('timer drain did not settle')
    },
    /**
     * Step one interval at a time, `times` times. A periodic timer is due exactly once per stop, so a
     * test counts the beats it expects instead of jumping the clock past work that would then be
     * skipped — and each stop drains the handlers of anything else scheduled at or before it.
     */
    async stepBy(intervalMs: number, times = 1): Promise<void> {
      for (let index = 0; index < times; index++) await this.advance(current + intervalMs)
    }
  }
}

export type FakeSocketMessage = { data: unknown }

/** A scripted stand-in for the platform socket: it records every message the stream sends. */
export function fakeSocketFactory() {
  const created: FakeSocket[] = []
  class FakeSocket {
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: FakeSocketMessage) => void) | null = null
    readonly sent: string[] = []
    closed = 0
    constructor(readonly url: string) { created.push(this) }
    send(data: string): void { this.sent.push(data) }
    close(): void { this.closed++ }
    open(): void { this.onopen?.() }
    message(data: unknown): void { this.onmessage?.({ data }) }
    fail(): void { this.onerror?.(); this.onclose?.() }
    dead(): void { this.onclose?.() }
    /**
     * The keepalives this socket actually sent. Equality with the policy frame, not a prefix match:
     * a beat that carried an extra field or a credential would not be counted here.
     */
    heartbeats(): string[] { return this.sent.filter(frame => frame === goldLiveHeartbeat()) }
  }
  return {
    created,
    /** The one socket the stream actually opened. A second instance would be a second connection. */
    socket: (): FakeSocket => {
      if (created.length !== 1) throw new Error(`expected exactly one socket, saw ${created.length}`)
      return created[0]
    },
    /** For the reconnect tests, where a second connection is the whole point. */
    latest: (): FakeSocket => {
      const socket = created.at(-1)
      if (!socket) throw new Error('no socket was opened')
      return socket
    },
    constructor: FakeSocket as unknown as PlatformWebSocketConstructor
  }
}

export const goldTick = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  event: 'price', symbol: 'XAU/USD', currency: 'USD', type: 'Physical Currency',
  timestamp: 1647950462, price: 1925.18, ...overrides
})

/**
 * One price frame exactly as Twelve Data's socket sent it for XAU/USD on 2026-10-14, captured with a
 * real key. It is kept verbatim because of what it settles: the provider writes `price` as a JSON
 * **number** (4144.04708), not as the string the wire contract carries, and the timestamp is UNIX
 * seconds. A fixture written to the shape we wished for would not have settled it; this one is the
 * shape that actually arrives.
 */
export const goldRealPriceFrame =
  '{"event":"price","symbol":"XAU/USD","currency":"USD","currency_base":"Gold Spot","currency_quote":"US Dollar","exchange":"COMMODITY","mic_code":"COMMODITY","type":"Precious Metal","timestamp":1791967560,"price":4144.04708}'

/** The frame's own instant: 1791967560 UNIX seconds → 2026-10-14T08:46:00.000Z. */
export const goldRealPriceFrameAtMs = 1_791_967_560_000

/** The canonical decimal string for the number the real frame carried. */
export const goldRealPrice = '4144.04708'
