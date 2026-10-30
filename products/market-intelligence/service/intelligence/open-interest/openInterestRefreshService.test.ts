import { describe, expect, it, vi } from 'vitest'

import { createOpenInterestRefreshService, openInterestCollectionPolicy } from './openInterestRefreshService'

const now = '2026-10-29T00:00:00.000Z'
const nowMs = Date.parse(now)
const bucket = (minutesAgo: number) => nowMs - minutesAgo * 60_000

function client(overrides: Partial<Record<'oi' | 'kl', unknown>> = {}) {
  return {
    requestOpenInterest: vi.fn(async () => (overrides.oi === undefined
      ? [{ asset: 'btc' as const, observedMs: bucket(15), notionalUsd: 8e9 }]
      : overrides.oi)) as never,
    requestKlines: vi.fn(async () => (overrides.kl === undefined
      ? [{ asset: 'btc' as const, observedMs: bucket(15), volumeBase: 1_200, closePrice: 79_500 }]
      : overrides.kl)) as never
  }
}

function store(newest: number | undefined = undefined) {
  return {
    upsert: vi.fn(async () => ({ state: 'updated' as const })),
    upsertVolume: vi.fn(async () => ({ state: 'updated' as const })),
    readNewestMs: vi.fn(async () => newest)
  }
}

const service = (deps: { client: ReturnType<typeof client>; store: ReturnType<typeof store>; enabled?: boolean }) =>
  createOpenInterestRefreshService({
    isEnabled: async () => deps.enabled ?? true,
    client: deps.client,
    store: deps.store,
    now: () => now
  })

describe('open interest refresh', () => {
  it('spends no request when the source is disabled', async () => {
    const c = client(), s = store()
    expect(await service({ client: c, store: s, enabled: false }).refresh()).toEqual({ state: 'unavailable' })
    expect(c.requestOpenInterest).not.toHaveBeenCalled()
    expect(s.upsert).not.toHaveBeenCalled()
  })

  it('fills a cold start in two segments, the second one ending just before the oldest row', async () => {
    const c = client({ oi: [{ asset: 'btc' as const, observedMs: bucket(15), notionalUsd: 8e9 }] })
    const s = store(undefined)
    await service({ client: c, store: s }).refresh()

    const calls = (c.requestOpenInterest as unknown as { mock: { calls: Array<[{ limit: number; endTime?: number }]> } }).mock.calls
    expect(calls[0]![0].limit).toBe(500)
    expect(calls[0]![0].endTime).toBeUndefined()
    expect(calls[1]![0].limit).toBe(172)
    expect(calls[1]![0].endTime).toBe(bucket(15) - 1)
    // Two assets, so four requests in total.
    expect(calls).toHaveLength(4)
    expect(s.upsert).toHaveBeenCalledTimes(4)
  })

  it('asks only for the gap on the steady state', async () => {
    const c = client()
    const s = store(bucket(45))
    await service({ client: c, store: s }).refresh()
    const calls = (c.requestOpenInterest as unknown as { mock: { calls: Array<[{ limit: number }]> } }).mock.calls
    // 45 minutes behind = 3 buckets, plus 2 of overlap.
    expect(calls[0]![0].limit).toBe(5)
  })

  it('writes the open interest even when the K-line leg fails, and remembers that volume is missing', async () => {
    const c = client({ kl: undefined })
    c.requestKlines = vi.fn(async () => undefined) as never
    const s = store(bucket(15))
    expect(await service({ client: c, store: s }).refresh()).toEqual({ state: 'updated' })
    expect(s.upsert).toHaveBeenCalled()
    expect(s.upsertVolume).not.toHaveBeenCalled()
  })

  it('reports unavailable only when both assets fail', async () => {
    const c = client()
    c.requestOpenInterest = vi.fn(async () => undefined) as never
    const s = store(bucket(15))
    expect(await service({ client: c, store: s }).refresh()).toEqual({ state: 'unavailable' })
  })

  it('treats unchanged writes as unchanged, not as a failure', async () => {
    const c = client()
    const s = store(bucket(15))
    s.upsert = vi.fn(async () => ({ state: 'unchanged' as const })) as never
    s.upsertVolume = vi.fn(async () => ({ state: 'unchanged' as const })) as never
    expect(await service({ client: c, store: s }).refresh()).toEqual({ state: 'unchanged' })
  })

  it('refuses a clock that is not canonical UTC', async () => {
    const c = client(), s = store()
    const svc = createOpenInterestRefreshService({ isEnabled: async () => true, client: c, store: s, now: () => '2026-10-29 00:00' })
    expect(await svc.refresh()).toEqual({ state: 'unavailable' })
  })

  it('covers both assets with fixed symbols', () => {
    expect(openInterestCollectionPolicy.assets.btc.symbol).toBe('BTCUSDT')
    expect(openInterestCollectionPolicy.assets.eth.symbol).toBe('ETHUSDT')
    expect(openInterestCollectionPolicy.bucketMs).toBe(900_000)
  })
})
