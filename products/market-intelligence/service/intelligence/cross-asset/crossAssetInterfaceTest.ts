import { CrossAssetClientError, type BinanceAsset, type ClosedBar } from './binanceCrossAssetClient'
import type { createBinanceCrossAssetStream } from './binanceCrossAssetStream'
import { crossAssetPolicy, type CrossAssetRow } from './crossAssetPolicy'

type Stream = ReturnType<typeof createBinanceCrossAssetStream>

/** The capability result the reader's test button renders: one REST leg and one stream leg per row. */
export type CrossAssetInterfaceTestResult = Readonly<{
  state: 'passed' | 'partial' | 'failed'
  assets: Record<CrossAssetRow, { rest: boolean; ws: boolean }>
  testedAt: number
}>

/**
 * The interface test, kept beside the policy it exercises rather than inside the runtime's lifecycle.
 *
 * Each row is exercised through the Binance contract behind it — for the index row that is the
 * tokenised proxy, whose REST and stream are what keep the row answerable when the licensed index
 * cannot. The result is keyed by row because that is what the panel and the contract name.
 *
 * Rate limiting and banning are reported back to the caller rather than handled here: they change the
 * runtime's own backoff state, and a test must not decide how long production stops collecting.
 */
export function createCrossAssetInterfaceTest(deps: Readonly<{
  now: () => number
  fetchClosedBars: (
    input: { asset: BinanceAsset; endMs: number; limit: number },
    control: { signal: AbortSignal; intent: 'user' }
  ) => Promise<readonly ClosedBar[]>
  sampling: Stream
  onRateLimited: (retryAfterMs?: number) => void
  onBanned: () => void
}>) {
  const policy = crossAssetPolicy.interfaceTest
  const rows = Object.keys(crossAssetPolicy.assets) as CrossAssetRow[]
  const liveAsset = (row: CrossAssetRow) => crossAssetPolicy.liveQuoteAssets[row] as BinanceAsset

  return {
    async run(signal: AbortSignal): Promise<CrossAssetInterfaceTestResult> {
      const assets = Object.fromEntries(rows.map(row => [row, { rest: false, ws: false }])) as Record<CrossAssetRow, { rest: boolean; ws: boolean }>
      const endMs = Math.floor(deps.now() / crossAssetPolicy.intervalMs) * crossAssetPolicy.intervalMs
      for (const row of rows) {
        if (signal.aborted) break
        try {
          const bars = await deps.fetchClosedBars({ asset: liveAsset(row), endMs, limit: policy.historyLimit },
            { signal, intent: crossAssetPolicy.interfaceTestIntent })
          assets[row].rest = bars.length > 0
        } catch (error) {
          if (error instanceof CrossAssetClientError && error.code === 'rate-limited') { deps.onRateLimited(error.retryAfterMs); break }
          if (error instanceof CrossAssetClientError && error.code === 'request-banned') { deps.onBanned(); break }
        }
      }
      if (!signal.aborted) {
        await new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const finish = () => {
            if (timer) clearTimeout(timer)
            signal.removeEventListener('abort', finish)
            removeObserver?.()
            resolve()
          }
          let removeObserver: (() => void) | undefined
          signal.addEventListener('abort', finish, { once: true })
          removeObserver = deps.sampling.observeKlines(asset => {
            const row = rows.find(candidate => liveAsset(candidate) === asset)
            if (row) assets[row].ws = true
            if (rows.every(candidate => assets[candidate].ws)) finish()
          })
          // The sample window is bounded: a socket that stays silent must not hold the button open.
          timer = setTimeout(finish, policy.streamSampleMs)
        })
      }
      const values = Object.values(assets)
      return Object.freeze({
        state: values.every(result => result.rest && result.ws) ? 'passed' as const
          : values.some(result => result.rest || result.ws) ? 'partial' as const : 'failed' as const,
        assets, testedAt: deps.now()
      })
    }
  }
}
