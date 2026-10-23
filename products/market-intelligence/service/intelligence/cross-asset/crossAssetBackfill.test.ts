import { describe, expect, it } from 'vitest'
import { createCrossAssetBackfill } from './crossAssetBackfill'
import type { ClosedBar } from './binanceCrossAssetClient'

// Derived closed-history contracts; no network or admission evidence.
const step = 300_000
const endMs = Date.parse('2026-09-14T12:00:00.000Z')
const bars: ClosedBar[] = Array.from({ length: 2017 }, (_, index) => ({
  symbol: 'BTCUSDT', barOpenMs: endMs - (2017 - index) * step, barEndMs: endMs - (2016 - index) * step,
  open: '100', high: '101', low: '99', close: '100', volume: '1'
}))
function setup(existing: readonly ClosedBar[]) {
  const requests: { asset: string; endMs: number; limit: number }[] = []
  const backfill = createCrossAssetBackfill({
    store: { queryAt: () => existing },
    client: { fetchClosedBars: async input => {
      requests.push(input)
      return bars.filter(bar => bar.barEndMs <= input.endMs).slice(-input.limit)
    } }
  })
  const run = async (signal?: AbortSignal) => {
    const output: ClosedBar[] = []
    for await (const page of backfill.collect({ asset: 'btc', endMs, asOfMs: endMs }, { signal })) output.push(...page)
    return output
  }
  return { requests, run }
}

describe('cross-asset missing-window backfill', () => {
  it('seeds an empty store with at most three bounded pages and 2017 closed bars', async () => {
    const { requests, run } = setup([])
    expect(await run()).toHaveLength(2017)
    expect(requests.map(request => request.limit)).toEqual([1000, 1000, 17])
  })

  it('rechecks only the trailing twelve bars when the current seven-day window is complete', async () => {
    const { requests, run } = setup(bars)
    expect(await run()).toEqual(bars.slice(-12))
    expect(requests).toEqual([{ asset: 'btc', endMs, limit: 12 }])
  })

  it('keeps a bounded request budget for scattered gaps and emits only gaps plus the trailing recheck', async () => {
    const absent = new Set([1, 20, 600, 1100, 1500])
    const { requests, run } = setup(bars.filter((_, index) => !absent.has(index)))
    const output = await run()
    expect(output.map(bar => bar.barOpenMs).sort()).toEqual(bars.filter((_, index) => absent.has(index) || index >= 2005).map(bar => bar.barOpenMs).sort())
    expect(requests.length).toBeLessThanOrEqual(3)
    expect(requests.every(request => request.limit <= 1000 && request.endMs <= endMs)).toBe(true)
  })

  it('does not treat another symbol or future observations as coverage and cancels before any request', async () => {
    const { run, requests } = setup(bars.map(bar => ({ ...bar, symbol: 'ETHUSDT' })))
    const controller = new AbortController()
    controller.abort()
    expect(await run(controller.signal)).toEqual([])
    expect(requests).toEqual([])
    expect(await run()).toHaveLength(2017)
  })
})
