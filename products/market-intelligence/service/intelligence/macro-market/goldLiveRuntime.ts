import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import {
  createGoldLiveStream, systemGoldLiveScheduler,
  type GoldLiveScheduler, type GoldLiveStream, type GoldLiveStreamState
} from './goldLiveStream'
import { goldLivePolicy, type GoldLiveFailureCode } from './goldLivePolicy'

/** The timing seam is defined beside the socket that uses it; the runtime shares the one contract. */
export type { GoldLiveScheduler } from './goldLiveStream'

/** The five states the dashboard can be told about. Only the last two are the socket's own. */
export type GoldLiveState = 'disabled' | 'connecting' | 'live' | 'stale' | 'unavailable'

export type GoldLiveSnapshot = Readonly<{
  /** `unavailable` with no failure code means no connection has been attempted yet. */
  state: GoldLiveState
  failureCode?: GoldLiveFailureCode
  tick?: Readonly<{ price: string; atMs: number }>
  /** The one credential fact that may be published: whether a key was found. Never the key. */
  hasCredential: boolean
}>

export type GoldLiveRuntime = Readonly<{
  snapshot: () => GoldLiveSnapshot
  reconcile: () => Promise<void>
  dispose: () => Promise<void>
}>

/**
 * The lifecycle around the gold socket: whether to be connected at all, what to say when the
 * connection dies, and when to try again.
 *
 * The credential is read from the caller on every attempt and kept in a private variable — the key
 * is never placed in a snapshot, a log line or a renderer payload. A source the reader has not
 * enabled, or one with no stored key, is never connected to: the state is `disabled` and no socket
 * is created, which is the same word the collector uses for "switched off".
 *
 * Timing is injected (clock and scheduler) so a reconnect can be asserted without waiting for one.
 */
export function createGoldLiveRuntime(deps: Readonly<{
  resolveProfile: () => Promise<Readonly<{ credentialRef?: string | null; enabled?: boolean }>>
  getCredential: () => Promise<string | undefined>
  createStream: (input: Readonly<{
    apiKey: string
    now: () => number
    onState: (state: GoldLiveStreamState, failureCode?: GoldLiveFailureCode) => void
    /** Always supplied: the stream's keepalive rides the same clock as the reconnect. */
    scheduler: GoldLiveScheduler
  }>) => GoldLiveStream
  now?: () => number
  scheduler?: GoldLiveScheduler
  random?: () => number
  onError?: (error: unknown) => void
}>): GoldLiveRuntime {
  const now = deps.now ?? Date.now
  const schedule = deps.scheduler ?? systemGoldLiveScheduler
  let state: GoldLiveState = 'unavailable'
  let failureCode: GoldLiveFailureCode | undefined
  let socket: GoldLiveStream | undefined
  let apiKey: string | undefined
  let enabled = false
  let readFailed = false
  let lastLoggedSignature = ''
  let disposed = false
  let checking = false
  let attempt = 0
  let reconnectDueAt = 0
  let reconnectHandle: unknown
  let timer: unknown

  const clearReconnect = (): void => {
    if (reconnectHandle !== undefined) { schedule.clearTimeout(reconnectHandle); reconnectHandle = undefined }
    reconnectDueAt = 0
  }
  const stopSocket = (): void => { socket?.close(); socket = undefined }

  /** One readiness read decides both facts, so the switch and the key can never disagree. */
  async function readReadiness(): Promise<boolean> {
    const profile = await deps.resolveProfile()
    enabled = profile.enabled === true
    // The key is fetched through the profile's own `credentialRef` and lives only in this closure;
    // it is never returned, logged or placed in a snapshot.
    if (!enabled || !profile.credentialRef) { apiKey = undefined; return false }
    try { apiKey = await deps.getCredential() ?? undefined } catch { apiKey = undefined }
    return Boolean(apiKey)
  }

  function scheduleReconnect(): void {
    if (disposed || !enabled || !apiKey || reconnectHandle !== undefined) return
    const delays = goldLivePolicy.reconnect.delaysMs
    const base = delays[Math.min(attempt++, delays.length - 1)]
    const jitter = 1 + (deps.random ?? Math.random)() * goldLivePolicy.reconnect.jitterRatio
    const delay = Math.round(base * jitter)
    reconnectDueAt = now() + delay
    reconnectHandle = schedule.setTimeout(() => { reconnectHandle = undefined; void reconcile() }, delay)
  }

  function connect(): void {
    if (disposed || !enabled || !apiKey) return
    state = 'connecting'
    failureCode = undefined
    const key = apiKey
    socket = deps.createStream({
      apiKey: key,
      now,
      scheduler: schedule,
      onState: (next, failure) => {
        if (disposed || !socket) return
        if (next === 'connecting') return
        failureCode = failure
        if (next === 'live' || next === 'stale') { state = next; attempt = 0; return }
        // Every refusal and every close collapses to one retry path: the socket is dropped, the state
        // stops claiming live data, and the backoff owns the next attempt.
        stopSocket()
        state = next
        scheduleReconnect()
      }
    })
  }

  async function reconcile(): Promise<void> {
    if (disposed || checking) return
    checking = true
    try {
      const ready = await readReadiness()
      if (disposed) return
      // A failed read is answered before the switch: "we could not read the switch" is a different
      // statement from "the reader switched it off", and only the second one is `disabled`.
      readFailed = false
      if (!ready) { clearReconnect(); stopSocket(); attempt = 0; state = 'disabled'; return }
      if (!timer) timer = schedule.setTimeout(() => { void reconcile() }, goldLivePolicy.profileCheckMs)
      if (socket) {
        const current = socket.snapshot()
        state = current.state
        failureCode = current.failureCode ?? failureCode
        return
      }
      if (reconnectHandle !== undefined || reconnectDueAt > now()) return
      connect()
    } catch (error) {
      // A failed readiness read must not take the reconciliation loop down with it.
      readFailed = true
      deps.onError?.(error)
      if (!disposed) { state = 'unavailable'; failureCode = 'transport-unavailable' }
    } finally { checking = false }
  }

  const runtime: GoldLiveRuntime = {
    snapshot() {
      // Whether the source is switched on is decided from the readiness we already hold; the tick's
      // own freshness is recomputed by the socket on every read rather than latched here.
      const switchedOff = disposed || (!readFailed && (!enabled || !apiKey))
      const current = socket?.snapshot()
      const resolved: GoldLiveState = switchedOff ? 'disabled' : current?.state ?? state
      const tick = current?.tick
      const code = current?.failureCode ?? failureCode
      // One line per state change, because a live stream that fails silently is a live stream nobody
      // can debug: the reader watched a gold price that never moved while the terminal said nothing
      // at all. It prints only on a change, so a five-second poll cannot flood the log.
      const signature = `${resolved}|${code ?? ''}|${Boolean(apiKey)}`
      if (signature !== lastLoggedSignature) {
        lastLoggedSignature = signature
        console.log(JSON.stringify({
          marker: 'MI_GOLD_LIVE', state: resolved, hasCredential: Boolean(apiKey),
          hasSocket: socket !== undefined, ...(code ? { failureCode: code } : {})
        }))
      }
      return Object.freeze({
        state: resolved, hasCredential: Boolean(apiKey),
        ...(tick ? { tick } : {}), ...(code ? { failureCode: code } : {})
      })
    },
    reconcile,
    async dispose() {
      if (disposed) return
      disposed = true
      clearReconnect()
      if (timer !== undefined) { schedule.clearTimeout(timer); timer = undefined }
      stopSocket()
      state = 'unavailable'
      apiKey = undefined
      await Promise.resolve()
    }
  }
  return runtime
}
