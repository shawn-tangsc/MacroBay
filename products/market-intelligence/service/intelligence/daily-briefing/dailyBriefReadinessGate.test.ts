import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefReadinessGate, crossAssetQuotesReady } from './dailyBriefReadinessGate'

/**
 * The 07:00 run waited for nothing and published three dashes. These are the three cells the
 * architect named, plus the one that decides whether waiting is even allowed to start.
 *
 * Waiting is polled, never a fixed delay: a fixed delay guesses how long a cold start takes, and a
 * guess is wrong in both directions. The budget is the only bound.
 */
const snapshot = (btc: string, eth: string, index = 'unavailable') => ({
  closedReturns: {
    btc: { '24h': { state: btc } },
    eth: { '24h': { state: eth } },
    index: { '24h': { state: index } }
  }
})

describe('readiness is the consumer’s own question', () => {
  it('needs BTC and ETH priced, and does not wait for the index, which is often late', () => {
    expect(crossAssetQuotesReady(snapshot('available', 'available'))).toBe(true)
    // The cell that would otherwise waste fifteen minutes every morning.
    expect(crossAssetQuotesReady(snapshot('available', 'available', 'unavailable'))).toBe(true)
    expect(crossAssetQuotesReady(snapshot('unavailable', 'available'))).toBe(false)
    expect(crossAssetQuotesReady(undefined)).toBe(false)
  })
})

describe('waiting for the market', () => {
  it('continues as soon as the second poll is readable', async () => {
    const ready = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const sleep = vi.fn(async () => undefined)
    const outcome = await createDailyBriefReadinessGate({ ready, sleep, pollMs: 30_000, budgetMs: 900_000 }).wait()

    expect(outcome).toMatchObject({ ready: true, polls: 2 })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(30_000)
  })

  it('gives up at the budget instead of waiting forever', async () => {
    let clock = 0
    const outcome = await createDailyBriefReadinessGate({
      ready: async () => false,
      sleep: async (ms) => { clock += ms },
      now: () => clock,
      pollMs: 30_000,
      budgetMs: 90_000
    }).wait()

    expect(outcome.ready).toBe(false)
    expect(outcome.waitedMs).toBeLessThanOrEqual(90_000)
  })

  it('does not sleep at all when the market is already readable', async () => {
    const sleep = vi.fn(async () => undefined)
    const outcome = await createDailyBriefReadinessGate({ ready: async () => true, sleep }).wait()
    expect(outcome).toMatchObject({ ready: true, polls: 1 })
    expect(sleep).not.toHaveBeenCalled()
  })
})
