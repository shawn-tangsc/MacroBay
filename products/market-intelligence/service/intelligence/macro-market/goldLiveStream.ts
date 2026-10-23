import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import { goldLiveHeartbeat, goldLivePolicy, goldLivePriceOf, goldLiveSubscription, goldLiveUrl, type GoldLiveFailureCode } from './goldLivePolicy'

/** The socket's own vocabulary. `disabled` and `unavailable` belong to the runtime, not the socket. */
export type GoldLiveStreamState = 'connecting' | 'live' | 'stale' | 'unavailable'

/**
 * The one timing seam either gold module uses. It is injected so a test can step a heartbeat instead
 * of waiting for one, and so the keepalive and the runtime's reconnect share a single clock.
 */
export type GoldLiveScheduler = Readonly<{
  setTimeout: (handler: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}>

export const systemGoldLiveScheduler: GoldLiveScheduler = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export type GoldLiveTick = Readonly<{ price: string; atMs: number }>

export type GoldLiveStreamSnapshot = Readonly<{
  state: GoldLiveStreamState
  tick?: GoldLiveTick
  failureCode?: GoldLiveFailureCode
}>

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/**
 * Which failure a refusal names. The code is a word (`plan-restricted`, `rate-limited`) or the HTTP
 * status (429). Nothing is trusted beyond its class: an unreadable code is never read as success, and
 * a refused subscription — where the provider always names a reason — is reported as the credential
 * or plan problem it almost always is rather than as an anonymous bad response.
 */
const failureOf = (payload: Record<string, unknown>, refusedSubscription: boolean): GoldLiveFailureCode => {
  const code = payload[goldLivePolicy.errorCodeField]
  if (code === goldLivePolicy.rateLimitedCode || code === 'rate-limited') return 'rate-limited'
  if (code === 'plan-restricted') return 'plan-restricted'
  if (code === 'invalid-api-key' || code === 'unauthorized') return 'credential-rejected'
  return refusedSubscription ? 'credential-rejected' : 'response-invalid'
}

/**
 * One socket to Twelve Data's price stream, subscribing to gold only.
 *
 * Everything this module can be wrong about is injected: the socket factory (so it is the proxy-aware
 * platform one in the app and a scripted one in a test), the clock, the scheduler, and the jitter
 * source. That is what lets a test drive a close and a reconnect without sleeping.
 *
 * The provider closes a price socket that stays silent for about ten seconds, so an accepted
 * subscription with no keepalive is a connection that never delivers a tick: the stream therefore
 * starts a heartbeat as soon as the subscription is on the wire, on the policy interval, and stops it
 * the moment the connection is over. One stream owns at most one heartbeat timer.
 *
 * A tick updates the latest state and nothing else. This module has no store reference at all, so
 * there is no path by which an unclosed value could reach a window return.
 */
export function createGoldLiveStream(deps: Readonly<{
  platformWebSocket: PlatformWebSocketConstructor
  apiKey: string
  now: () => number
  onState: (state: GoldLiveStreamState, failureCode?: GoldLiveFailureCode) => void
  scheduler?: GoldLiveScheduler
}>) {
  if (!deps.platformWebSocket) throw new Error('dependency-unavailable')
  const schedule = deps.scheduler ?? systemGoldLiveScheduler
  // The constructor is named in the log because a wrapper that is not the platform adapter
  // constructs fine and then does nothing at all: no open, no error, no timeout — which is exactly
  // the shape of the failure this line exists to rule out.
  console.log(JSON.stringify({ marker: 'MI_GOLD_LIVE_CONNECT',
    factoryType: typeof deps.platformWebSocket, factoryName: deps.platformWebSocket?.name ?? null,
    url: goldLiveUrl(deps.apiKey).replace(/apikey=[^&]*/, 'apikey=***') }))
  const socket = new deps.platformWebSocket(goldLiveUrl(deps.apiKey))
  let state: GoldLiveStreamState = 'connecting'
  let tick: GoldLiveTick | undefined
  let failureCode: GoldLiveFailureCode | undefined
  let disposed = false
  let heartbeat: unknown

  const transition = (next: GoldLiveStreamState, failure?: GoldLiveFailureCode): void => {
    if (disposed) return
    state = next
    failureCode = failure
    try { deps.onState(next, failure) } catch { /* An observer cannot interrupt the stream. */ }
  }

  /** The one place a keepalive timer dies, so no path can leave one armed behind. */
  const clearHeartbeat = (): void => {
    if (heartbeat === undefined) return
    schedule.clearTimeout(heartbeat)
    heartbeat = undefined
  }

  /**
   * One beat at a time. The next timer is armed only after a frame has gone out and only while the
   * connection is still open, and the handle is cleared before the send, so a stream can never hold
   * two: re-opening the socket, or a reconcile that reuses this connection, cannot stack a second.
   */
  const armHeartbeat = (): void => {
    if (disposed || heartbeat !== undefined) return
    heartbeat = schedule.setTimeout(() => {
      heartbeat = undefined
      // Silence is only correct while a connection is open and has not already failed.
      if (disposed || state === 'unavailable') return
      try { socket.send(goldLiveHeartbeat()) } catch {
        // A keepalive that cannot be sent is a dead transport, not an idle stream: it takes the
        // existing failure path — unavailable, and the runtime drops the socket and retries.
        fail('transport-unavailable')
        return
      }
      armHeartbeat()
    }, goldLivePolicy.heartbeat.intervalMs)
  }

  const fail = (code: GoldLiveFailureCode): void => {
    if (disposed) return
    clearHeartbeat()
    transition('unavailable', code)
  }

  socket.onopen = () => {
    if (disposed) return
    state = 'connecting'
    try {
      socket.send(goldLiveSubscription())
      // Subscribed: the keepalive starts from here, without waiting for the acknowledgement, because
      // the provider's idle clock starts with the connection rather than with the subscription.
      armHeartbeat()
    } catch { /* The close that follows schedules the retry. */ }
  }
  // A socket error is always followed by the transport's close, which is where the retry is armed;
  // reporting the failure twice would double-count a single outage. A close *after* a tick is an
  // outage even when the socket never raised an error — a live stream that stops is not a quiet one.
  socket.onerror = () => fail(failureCode && state !== 'live' ? failureCode : 'transport-unavailable')
  socket.onclose = () => fail(failureCode && state !== 'live' ? failureCode : 'transport-unavailable')
  // Every frame is counted, and the first few are reported: "connected but nothing arrives" and
  // "arrives but is rejected" look identical from the outside — both leave the state at connecting —
  // and only this line separates them.
  let frames = 0
  const reportFrame = (summary: Record<string, unknown>): void => {
    if (frames > 3 && frames % 20 !== 0) return
    console.log(JSON.stringify({ marker: 'MI_GOLD_LIVE_FRAME', frames, ...summary }))
  }
  socket.onmessage = event => {
    if (disposed || state === 'unavailable') return
    const text = event.data
    frames += 1
    reportFrame(typeof text === 'string' ? { bytes: text.length } : { bytes: -1 })
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > goldLivePolicy.maxMessageBytes) return
    let payload: unknown
    try { payload = JSON.parse(text) } catch { return }
    if (!object(payload)) return
    // The provider answers a subscription with its own status frame; anything but `ok` is a refusal,
    // and a refused subscription is not a quiet stream.
    if (payload.event === goldLivePolicy.acknowledgeEvent) {
      if (payload.status !== goldLivePolicy.successStatus) fail(failureOf(payload, true))
      return
    }
    // A frame carrying an error code is a failure notice, not a tick, even when it names the symbol.
    if (Object.hasOwn(payload, goldLivePolicy.errorCodeField)) { fail(failureOf(payload, false)); return }
    if (payload.symbol !== goldLivePolicy.symbol) return
    // The price frame is the only frame that carries a price; a status or notice frame that happens
    // to mention the symbol is not a tick.
    if (payload.event !== undefined && payload.event !== goldLivePolicy.priceEvent) return
    const now = deps.now()
    // `timestamp` is UNIX seconds. A frame with no stamp is stamped with our own read time, and a
    // stamp ahead of our clock is clamped to it: a tick can be late — freshness decides its badge —
    // but it can never be fresher than the moment we received it.
    const stamped = typeof payload.timestamp === 'number' ? Math.round(payload.timestamp * 1_000) : now
    if (!Number.isSafeInteger(stamped) || stamped < 0) return
    const atMs = Math.min(stamped, now)
    // The provider's price frame names the figure as a JSON number, so the policy's normaliser — not
    // a string test — is what decides whether this frame carries a price at all. What it returns is
    // the canonical decimal string the snapshot and the wire contract carry.
    const price = goldLivePriceOf(payload.price)
    // A malformed tick is dropped, not repaired and not fatal: the last good price stands, and the
    // next frame is one second away. Only a protocol-level refusal takes the connection down.
    if (price === undefined) return
    tick = Object.freeze({ price, atMs })
    transition('live')
  }

  return {
    snapshot(): GoldLiveStreamSnapshot {
      if (disposed) return Object.freeze({ state: 'unavailable', ...(failureCode ? { failureCode } : {}) })
      // Freshness is recomputed per read rather than latched at the last tick: a socket that stays
      // open while the provider goes quiet is exactly the case the 延迟 badge exists for. A live
      // state always has a tick, so the subtraction is total.
      const stale = state === 'live' && tick !== undefined && deps.now() - tick.atMs > goldLivePolicy.freshnessMs
      return Object.freeze({
        state: stale ? 'stale' : state,
        ...(tick ? { tick } : {}),
        ...(failureCode ? { failureCode } : {})
      })
    },
    close(): void {
      if (disposed) return
      disposed = true
      // The keepalive dies with the connection: a timer left armed here would fire at a closed socket.
      clearHeartbeat()
      state = 'unavailable'
      socket.onopen = null; socket.onclose = null; socket.onerror = null; socket.onmessage = null
      try { socket.close() } catch { /* Closing an already-dead socket is not an error worth reporting. */ }
      tick = undefined
    }
  }
}

export type GoldLiveStream = ReturnType<typeof createGoldLiveStream>
