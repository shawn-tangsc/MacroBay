import type { JobRuntime } from '@platform/jobs'
import type { RealMarketApiFailureCode } from '../macro-market/realMarketApiPolicy'
import { realMarketApiCandleUrl } from '../macro-market/realMarketApiTimeSeries'
import { createRealMarketApiTransport } from '../macro-market/realMarketApiTransport'
import type { ClosedBar } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'
import { crossAssetIndexBars } from './crossAssetIndexFeed'
import { registerCrossAssetIndexJob } from './crossAssetIndexJob'
import type { CrossAssetIndexFeedState } from './crossAssetIndexSource'

type Profile = Readonly<{ credentialRef?: string | null; enabled?: boolean }>
type Credential = Readonly<{ apiKey?: string }>

/** `disabled` and `credential-missing` are outcomes of *this* source, not provider error codes. */
export type CrossAssetIndexFailureCode = RealMarketApiFailureCode | 'disabled' | 'credential-missing'

export type CrossAssetIndexRunResult =
  | Readonly<{ state: 'stored' | 'unchanged'; added: number; offGrid: number; forming: number }>
  | Readonly<{ state: 'idle' }>
  | Readonly<{ state: 'unavailable'; failureCode: CrossAssetIndexFailureCode }>

export type CrossAssetIndexRuntime = Readonly<{
  run: (atMs?: number) => Promise<CrossAssetIndexRunResult>
  /** What the snapshot layer reads to decide whether the real index can answer the row. */
  state: () => Readonly<{ state: CrossAssetIndexFeedState; failureCode?: CrossAssetIndexFailureCode }>
  /** After disposal no tick may spend a request: the store it writes to is already closed. */
  dispose: () => void
}>

/**
 * The real Nasdaq 100 index, collected into the cross-asset store.
 *
 * The credential is read exactly the way the real dollar index reads it — the source profile's
 * `credentialRef` and then the encrypted store — so one key serves both instruments and the key never
 * reaches the renderer. The URL is credential material and is never logged, thrown or stored: a
 * failure leaves this function as a code.
 *
 * `state()` answers one question and only one: **could the real source answer at all?** A closed
 * session is a successful tick — the provider still returns the session's bars — so the state stays
 * `ready` and the row keeps its real instrument. Only a missing key, a switched-off source, a failed
 * request or a page with no usable bar makes it `unavailable`, which is what lets the proxy answer.
 */
export function createCrossAssetIndexRuntime(deps: Readonly<{
  jobRuntime: JobRuntime
  store: Readonly<{ append: (input: { bars: readonly ClosedBar[]; observedAtMs: number; origin: 'rest' | 'ws' }) => { state: string; added: number } }>
  resolveProfile: (sourceId: string) => Promise<Profile>
  getCredential: (credentialRef: string) => Promise<Credential | null>
  fetchImpl?: typeof fetch
  now?: () => number
  onError?: (error: unknown, sourceId: string) => void
}>): CrossAssetIndexRuntime {
  const now = deps.now ?? Date.now
  const policy = crossAssetPolicy.index
  const transport = createRealMarketApiTransport(deps.fetchImpl)
  let state: CrossAssetIndexFeedState = 'pending'
  let failureCode: CrossAssetIndexFailureCode | undefined
  let running = false
  let disposed = false

  /** Every failure is recorded the same way: a code in memory, a code in the log, never a URL. */
  function fail(code: CrossAssetIndexFailureCode): CrossAssetIndexRunResult {
    state = 'unavailable'; failureCode = code
    deps.onError?.(new Error(`cross-asset-index ${code}`), policy.sourceId)
    return Object.freeze({ state: 'unavailable' as const, failureCode: code })
  }

  async function run(atMs: number = now()): Promise<CrossAssetIndexRunResult> {
    // One tick at a time: the interval trigger and the startup tick can overlap on a slow request,
    // and two appends of the same page would spend the request twice for one answer.
    if (running || disposed) return Object.freeze({ state: 'idle' as const })
    running = true
    try {
      const profile = await deps.resolveProfile(policy.sourceId)
      if (profile.enabled !== true) return fail('disabled')
      if (!profile.credentialRef) return fail('credential-missing')
      const apiKey = (await deps.getCredential(profile.credentialRef))?.apiKey
      if (!apiKey) return fail('credential-missing')
      const response = await transport(realMarketApiCandleUrl(apiKey, policy.symbol, policy.timeFrame, policy.candleLimit))
      if (response.state === 'unavailable') return fail(response.failureCode)
      const read = crossAssetIndexBars(response.body, response.status, atMs)
      if (read.state === 'unavailable') return fail(read.failureCode)
      const appended = deps.store.append({ bars: read.bars, observedAtMs: atMs, origin: 'rest' })
      // A full store is not a broken source: the bars this row needs are already on disk, so the row
      // keeps answering from them rather than flipping to the proxy because a write was refused.
      if (appended.state === 'unavailable' || appended.state === 'invalid-input') return fail('response-invalid')
      state = 'ready'; failureCode = undefined
      return Object.freeze({
        state: appended.state === 'updated' ? 'stored' as const : 'unchanged' as const,
        added: appended.added, offGrid: read.offGrid, forming: read.forming
      })
    } catch {
      return fail('transport-unavailable')
    } finally { running = false }
  }

  registerCrossAssetIndexJob(deps.jobRuntime, () => run())
  return Object.freeze({
    run,
    state: () => Object.freeze(failureCode === undefined ? { state } : { state, failureCode }),
    dispose: () => { disposed = true }
  })
}
