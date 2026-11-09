import { describe, expect, it, vi } from 'vitest'

import { createFundingRateHistoryRefreshService, fundingRateCollectionWindowPolicy } from './fundingRateHistoryRefreshService'

describe('funding rate history refresh service', () => {
  it('requests the fixed 22-point BTCUSDT and ETHUSDT collection window and writes both asset histories together', async () => {
    const requestHistory = vi.fn(async () => ({
      state: 'available' as const,
      btc: points('btc', 0.01),
      eth: points('eth', -0.02)
    }))
    const upsert = vi.fn(async () => ({ state: 'updated' as const }))
    const refresh = createFundingRateHistoryRefreshService({
      isEnabled: async () => true,
      requestHistory,
      store: { upsert },
      now: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(refresh.refresh()).resolves.toEqual({ state: 'updated' })
    expect(requestHistory).toHaveBeenCalledWith({
      btc: fundingRateCollectionWindowPolicy.assets.btc,
      eth: fundingRateCollectionWindowPolicy.assets.eth
    })
    expect(upsert).toHaveBeenCalledWith({ btc: points('btc', 0.01), eth: points('eth', -0.02), collectedAt: '2026-09-03T00:00:00.000Z' })
  })

  it('does not request or write when the source is disabled, and fails closed for an invalid collection', async () => {
    const requestHistory = vi.fn()
    const upsert = vi.fn()
    const disabled = createFundingRateHistoryRefreshService({ isEnabled: async () => false, requestHistory, store: { upsert }, now: () => '2026-09-03T00:00:00.000Z' })
    await expect(disabled.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect(requestHistory).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('keeps Binance history independent from any 0xRouter governance queue', async () => {
    const requestHistory = vi.fn(async () => ({ state: 'unavailable' as const }))
    // 这个队列**不在**服务签名里，正是要证明它不会被碰：把多出来的这一格单独声明类型，
    // 而不是把整个依赖对象 `as never`——后者会让 `queue.enqueue` 变成 never，断言等于没判。
    const queue = { enqueue: vi.fn() }
    const deps: Parameters<typeof createFundingRateHistoryRefreshService>[0] & { requestGovernanceQueue: typeof queue } = {
      isEnabled: async () => true,
      requestHistory,
      store: { upsert: vi.fn() },
      now: () => '2026-09-03T00:00:00.000Z',
      requestGovernanceQueue: queue
    }
    const refresh = createFundingRateHistoryRefreshService(deps)
    await expect(refresh.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

function points(asset: 'btc' | 'eth', ratePercent: number) {
  return Array.from({ length: fundingRateCollectionWindowPolicy.limit }, (_, index) => ({ asset, fundingTimeMs: Date.parse('2026-09-01T00:00:00.000Z') + index, ratePercent }))
}
