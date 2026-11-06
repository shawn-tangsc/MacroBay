import { describe, expect, it, vi } from 'vitest'

import type { ClosedBar } from '../cross-asset/binanceCrossAssetClient'
import { briefingBarBackfillPolicy, ensureBriefingBars, type BriefingBarBackfill } from './dailyBriefMarketBackfill'

/**
 * The quotes the edition needs are fetched once, only when missing, and never by a second collector.
 *
 * Before this, nothing asked the collector at generation time: the 07:00 bar that arrived at 07:21 was
 * picked up by the live connection's own next pass, so the run waited out its budget and published
 * without BTC or ETH.
 */
const AT = Date.parse('2026-11-03T23:00:00.000Z')
const DAY_BEFORE = AT - 24 * 60 * 60_000
const asOfMs = AT + 21 * 60_000

function bar(atMs: number): ClosedBar {
  return { symbol: 'BTCUSDT', barOpenMs: atMs, barEndMs: atMs + 5 * 60_000, open: '1', high: '1', low: '1', close: '1', volume: '1' } as ClosedBar
}

function backfillWith(stored: Set<number>): BriefingBarBackfill & { collect: ReturnType<typeof vi.fn>; appended: ClosedBar[] } {
  const appended: ClosedBar[] = []
  const collect = vi.fn(async function* (input: { asset: string; endMs: number }) {
    // The collector would return the missing bars; this fake returns the two this edition needs.
    yield [bar(input.endMs), bar(DAY_BEFORE)]
  })
  return {
    appended,
    collect: collect as never,
    hasBar: ({ atMs }) => stored.has(atMs),
    append: (bars) => {
      appended.push(...bars)
      for (const entry of bars) stored.add(entry.barOpenMs)
    }
  }
}

describe('the edition fetches its own bars, once', () => {
  it('sends no request at all when both bars are already stored', async () => {
    const stored = new Set([AT, DAY_BEFORE])
    const backfill = backfillWith(stored)
    const outcome = await ensureBriefingBars(backfill, { atMs: AT, dayBeforeMs: DAY_BEFORE, asOfMs })

    expect(outcome).toEqual({ attempted: false, filled: true })
    expect(backfill.collect).not.toHaveBeenCalled()
  })

  it('fetches the missing window and stores what comes back', async () => {
    const stored = new Set<number>()
    const backfill = backfillWith(stored)
    const outcome = await ensureBriefingBars(backfill, { atMs: AT, dayBeforeMs: DAY_BEFORE, asOfMs })

    expect(outcome).toEqual({ attempted: true, filled: true })
    expect(backfill.collect).toHaveBeenCalledTimes(2) // one per asset, not one per missing bar
    expect(backfill.collect.mock.calls[0]![0]).toMatchObject({ asset: 'btc', endMs: AT, asOfMs })
    expect(backfill.appended.length).toBeGreaterThan(0)
  })

  it('reports what is still missing instead of pretending it filled', async () => {
    const stored = new Set<number>()
    const backfill: BriefingBarBackfill = {
      hasBar: ({ atMs }) => stored.has(atMs),
      collect: async function* () { yield [] },
      append: () => undefined
    }
    const outcome = await ensureBriefingBars(backfill, { atMs: AT, dayBeforeMs: DAY_BEFORE, asOfMs })

    expect(outcome).toEqual({ attempted: true, filled: false })
  })

  it('stops after a couple of pages rather than walking a day of history', async () => {
    const stored = new Set<number>()
    let pages = 0
    const backfill: BriefingBarBackfill = {
      hasBar: () => false,
      collect: async function* () {
        for (let page = 0; page < 50; page += 1) { pages += 1; yield [] }
      },
      append: () => undefined
    }
    await ensureBriefingBars(backfill, { atMs: AT, dayBeforeMs: DAY_BEFORE, asOfMs })

    // Two assets, each capped at the policy's page count.
    expect(pages).toBeLessThanOrEqual(briefingBarBackfillPolicy.maxPages * 2)
  })
})
