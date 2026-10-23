import { describe, expect, it, vi } from 'vitest'

import { createCapitalConditionsRefreshService } from './capitalConditionsRefreshService'
import { parseStablecoinDailyHistory } from './stablecoinCapitalParser'
import { createInMemoryCapitalConditionsStateStorage, createCapitalConditionsCurrentStateStore } from './stablecoinCapitalCurrentStateStore'

function validPayload() {
  return {
    peggedAssets: [
      { id: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 200 }, circulatingPrevDay: { peggedUSD: 190 }, circulatingPrevWeek: { peggedUSD: 190 }, circulatingPrevMonth: { peggedUSD: 180 } },
      { id: '2', symbol: 'USDC', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 110 }, circulatingPrevDay: { peggedUSD: 110 }, circulatingPrevWeek: { peggedUSD: 110 }, circulatingPrevMonth: { peggedUSD: 100 } }
    ]
  }
}

describe('capital conditions refresh service', () => {
  it('does not request or write when the source profile is disabled', async () => {
    const request = vi.fn()
    const write = vi.fn(async () => undefined)
    const service = createCapitalConditionsRefreshService({
      isEnabled: async () => false,
      http: { requestStablecoinPayload: request },
      store: createCapitalConditionsCurrentStateStore({ storage: { read: async () => null, write } }),
      now: () => '2026-08-18T00:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect(request).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps invalid source data at zero snapshot writes', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const service = createCapitalConditionsRefreshService({
      isEnabled: async () => true,
      http: { requestStablecoinPayload: vi.fn(async () => ({ state: 'available', payload: { peggedAssets: [] }, acceptedBytes: 20 })) },
      store: createCapitalConditionsCurrentStateStore({ storage }),
      now: () => '2026-08-18T00:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect((await storage.read())?.snapshot).toBeUndefined()
  })

  it('writes a valid current snapshot and returns unchanged for an identical poll', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const service = createCapitalConditionsRefreshService({
      isEnabled: async () => true,
      http: { requestStablecoinPayload: vi.fn(async () => ({ state: 'available', payload: validPayload(), acceptedBytes: 200 })) },
      store: createCapitalConditionsCurrentStateStore({ storage }),
      now: () => '2026-08-18T00:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(service.refresh()).resolves.toEqual({ state: 'unchanged' })
    expect((await storage.read())?.snapshot?.coreCurrentUsd).toBe(310)
  })

  it('atomically persists a compact completed-day history alongside the current snapshot', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    expect(parseStablecoinDailyHistory(historyPayload(), '2026-08-18T12:00:00.000Z')).toHaveLength(6)
    const service = createCapitalConditionsRefreshService({
      isEnabled: async () => true,
      http: {
        requestStablecoinPayload: vi.fn(async () => ({ state: 'available' as const, payload: validPayload(), acceptedBytes: 200 })),
        requestStablecoinHistoryPayload: vi.fn(async () => ({ state: 'available' as const, payload: historyPayload(), acceptedBytes: 200 }))
      },
      store: createCapitalConditionsCurrentStateStore({ storage }),
      now: () => '2026-08-18T12:00:00.000Z'
    })
    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    expect((await storage.read())?.snapshot?.dailyFlows).toEqual([
      { tradingDate: '2026-08-12', netFlowUsd: 0 },
      { tradingDate: '2026-08-13', netFlowUsd: 1 },
      { tradingDate: '2026-08-14', netFlowUsd: 1 },
      { tradingDate: '2026-08-15', netFlowUsd: 1 },
      { tradingDate: '2026-08-16', netFlowUsd: 1 },
      { tradingDate: '2026-08-17', netFlowUsd: 1 }
    ])
  })

  it('only validates the transport and parser during a connection probe', async () => {
    const write = vi.fn(async () => undefined)
    const service = createCapitalConditionsRefreshService({
      isEnabled: async () => true,
      http: { requestStablecoinPayload: vi.fn(async () => ({ state: 'available', payload: validPayload(), acceptedBytes: 200 })) },
      store: createCapitalConditionsCurrentStateStore({ storage: { read: async () => null, write } }),
      now: () => '2026-08-18T00:00:00.000Z'
    })

    await expect(service.probe()).resolves.toEqual({ state: 'available' })
    expect(write).not.toHaveBeenCalled()
  })
})

function historyPayload() {
  return ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map((tradingDate, index) => ({
    date: String(Date.parse(`${tradingDate}T00:00:00.000Z`) / 1_000),
    totalCirculating: { peggedUSD: 100 + index },
    totalCirculatingUSD: { peggedUSD: 100 + index }
  }))
}
