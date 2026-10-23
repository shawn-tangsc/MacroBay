import type { BinanceAsset, ClosedBar } from './binanceCrossAssetClient'
import { crossAssetPolicy as policy } from './crossAssetPolicy'

export const crossAssetBackfillPolicy = Object.freeze({ recheckBars: 12 })

export function createCrossAssetBackfill(deps: {
  store: { queryAt: (input: { symbol: ClosedBar['symbol']; fromMs: number; toMs: number; asOfMs: number }) => readonly ClosedBar[] }
  client: { fetchClosedBars: (input: { asset: BinanceAsset; endMs: number; limit: number }, control?: { signal?: AbortSignal }) => Promise<readonly ClosedBar[]> }
}) {
  return {
    async *collect(input: { asset: BinanceAsset; endMs: number; asOfMs: number }, control?: { signal?: AbortSignal }): AsyncGenerator<readonly ClosedBar[]> {
      if (control?.signal?.aborted) return
      const step = policy.intervalMs
      if (!Object.hasOwn(policy.binanceAssets, input.asset) || !Number.isSafeInteger(input.endMs) || input.endMs <= 0 ||
        input.endMs % step !== 0 || !Number.isSafeInteger(input.asOfMs) || input.asOfMs < input.endMs) throw new Error('invalid-backfill')
      const symbol = policy.binanceAssets[input.asset]
      const fromMs = Math.max(0, input.endMs - policy.historyMaxPoints * step)
      const known = new Set(deps.store.queryAt({ symbol, fromMs, toMs: input.endMs - step, asOfMs: input.asOfMs })
        .filter(bar => bar.symbol === symbol && bar.barEndMs === bar.barOpenMs + step && bar.barEndMs <= input.endMs)
        .map(bar => bar.barOpenMs))
      // Partition the bounded window before trimming each request, so sparse gaps cannot create unbounded REST calls.
      for (let page = 0; page < policy.historyMaxPages; page++) {
        if (control?.signal?.aborted) return
        const bucketEnd = input.endMs - page * policy.maxLimit * step
        const bucketStart = Math.max(fromMs, bucketEnd - policy.maxLimit * step)
        const needed: number[] = []
        for (let at = bucketStart; at < bucketEnd; at += step) {
          if (!known.has(at) || at >= input.endMs - crossAssetBackfillPolicy.recheckBars * step) needed.push(at)
        }
        if (!needed.length) continue
        const start = needed[0]
        const endMs = needed[needed.length - 1] + step
        const bars = await deps.client.fetchClosedBars({ asset: input.asset, endMs, limit: (endMs - start) / step }, control)
        if (control?.signal?.aborted) return
        const requested = new Set(needed)
        const selected = bars.filter(bar => bar.symbol === symbol && requested.has(bar.barOpenMs))
        if (selected.length) yield selected
      }
    }
  }
}
