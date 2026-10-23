import { describe, expect, it, vi } from 'vitest'
import { createCrossAssetSnapshotQuery } from './crossAssetSnapshotQuery'

// Aligned to the product's own five-minute grid, exactly as `analysisEnd` is in production:
// an unaligned instant would put the read boundaries between bars and make this fixture disagree
// with the store it stands in for.
const now = 1_789_387_200_000 // 2026-09-14T12:00:00.000Z, exactly on the product's five-minute grid
const STEP = 300_000
/** The horizon the featured 7d window needs: its endpoint and the bar seven days before it. */
const SEVEN_DAY_BARS = 2018

/**
 * A faithful stand-in for the real store: it answers **only the range it is asked for**, and it
 * refuses a request wider than the product's own single-read cap. That is what makes this file able
 * to tell "the window has no data" apart from "the window was never read" — the bug this file exists
 * for was the second one, wearing the first one's clothes.
 */
function rangedStore() {
  const bars = (symbol: string) => Array.from({ length: SEVEN_DAY_BARS }, (_, index) => ({
    symbol,
    // The oldest bar ends exactly seven days behind `now` — the far end of the admitted horizon,
    // which is inclusive — and the newest ends one interval behind it, as the real store publishes
    // (the main process reads up to `end`, so the newest closed bar always sits one interval back).
    barOpenMs: now - (SEVEN_DAY_BARS - 1 - index) * STEP,
    barEndMs: now - (SEVEN_DAY_BARS - 1 - index) * STEP,
    open: '100', high: '110', low: '90', close: String(100 + index / 100), volume: '1'
  }))
  const queryAt = vi.fn((input: { symbol: string; fromMs: number; toMs: number; asOfMs: number }) => {
    if (input.toMs - input.fromMs >= 2017 * STEP) throw new Error('invalid-query')
    return bars(input.symbol).filter(bar => bar.barEndMs >= input.fromMs && bar.barEndMs <= input.toMs && bar.barEndMs <= input.asOfMs)
  })
  return { queryAt, query: createCrossAssetSnapshotQuery({
    now: () => now,
    store: { revision: 1, queryAt },
    live: () => ({ state: 'live', quotes: { index: { state: 'missing' }, btc: { state: 'missing' }, eth: { state: 'missing' } } })
  }) }
}

describe('the seven-day window reads seven days of history, not the selected range', () => {
  it('answers 7d for the cross-asset rows while the chart is still on its default 24h range', () => {
    const { query } = rangedStore()
    const metric = query.query({ range: '24h' }).closedReturns.btc['7d']
    expect(metric.state).toBe('available')
    // The newest close over the close of the bar exactly seven days back — a real ratio of two
    // stored closes (index 2017 is also the far end of the admitted horizon, inclusive).
    expect(metric.state === 'available' ? metric.value : Number.NaN).toBeCloseTo(100 * (120.17 / 100 - 1), 6)
  })

  it('answers the same 7d figure on every range, because the window is not the chart range', () => {
    const { query } = rangedStore()
    const twentyFour = query.query({ range: '24h' }).closedReturns.btc['7d']
    const oneHour = query.query({ range: '1h' }).closedReturns.btc['7d']
    const sevenDay = query.query({ range: '7d' }).closedReturns.btc['7d']
    expect(oneHour.state).toBe('available')
    expect(oneHour).toEqual(sevenDay)
    expect(oneHour).toEqual(twentyFour)
  })

  it('keeps every individual store read inside the product cap while covering both window ends', () => {
    const { queryAt, query } = rangedStore()
    query.query({ range: '24h' })
    const reads = queryAt.mock.calls.map(([request]) => request)
    // Three reads per stored symbol: one read cannot reach from the horizon's newest bar back to the
    // bar that anchors its far end, so the span is tiled by slices that each stay under the cap.
    expect(reads.length).toBe(12)
    for (const request of reads) expect(request.toMs - request.fromMs).toBeLessThan(2017 * STEP)
    // And the union of those reads must still reach the oldest bar the 7d window divides against.
    expect(Math.min(...reads.map(request => request.fromMs))).toBeLessThanOrEqual(now - 2017 * STEP)
    expect(Math.max(...reads.map(request => request.toMs))).toBeGreaterThanOrEqual(now)
  })
})
