import { describe, expect, it, vi } from 'vitest'

import { createEtfCurrentStateRefreshService } from './etfCurrentStateRefreshService'
import { createEtfCurrentStateStore, createInMemoryEtfCurrentStateStorage } from '../store/etfCurrentStateStore'

describe('ETF current-state refresh service', () => {
  it('makes zero network requests and zero writes when the source is disabled or has no credential', async () => {
    for (const gate of [
      { enabled: false, credential: true },
      { enabled: true, credential: false }
    ]) {
      const requestWindow = vi.fn()
      const replace = vi.fn()
      const service = createEtfCurrentStateRefreshService({
        isEnabled: async () => gate.enabled,
        hasCredential: async () => gate.credential,
        requestWindow,
        store: { replace },
        now: () => '2026-09-01T12:00:00.000Z'
      })

      await expect(service.refresh()).resolves.toEqual({ state: 'unavailable' })
      expect(requestWindow).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
    }
  })

  it('atomically writes an authorized common UTC window while excluding the current UTC day', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const requestWindow = vi.fn(async () => ({
      state: 'available' as const,
      btc: rows('BTC'),
      eth: rows('ETH')
    }))
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow,
      store,
      now: () => '2026-09-01T12:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(store.readAvailable({ asOf: '2026-09-01T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      window: {
        windowEnd: '2026-08-31',
        btc: expect.not.arrayContaining([expect.objectContaining({ tradingDate: '2026-09-01' })]),
        eth: expect.not.arrayContaining([expect.objectContaining({ tradingDate: '2026-09-01' })])
      }
    })
  })

  it('fails closed without a write when fewer than five common complete UTC dates remain', async () => {
    const replace = vi.fn()
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow: async () => ({ state: 'available' as const, btc: rows('BTC').slice(0, 4), eth: rows('ETH').slice(0, 4) }),
      store: { replace },
      now: () => '2026-09-01T12:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('fails closed without a write for a future or non-common asset date', async () => {
    const replace = vi.fn()
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow: async () => ({
        state: 'available' as const,
        btc: rows('BTC'),
        eth: [...rows('ETH').slice(0, -1), { ...rows('ETH').at(-1)!, date: Date.parse('2026-09-02T00:00:00.000Z') }]
      }),
      store: { replace },
      now: () => '2026-09-01T12:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'unavailable' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps only the latest common complete date set when the source histories differ', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow: async () => ({
        state: 'available' as const,
        btc: [...rows('BTC'), { ...rows('BTC').at(0)!, date: Date.parse('2026-08-26T00:00:00.000Z') }],
        eth: [...rows('ETH'), { ...rows('ETH').at(0)!, date: Date.parse('2026-08-25T00:00:00.000Z') }]
      }),
      store,
      now: () => '2026-09-01T12:00:00.000Z'
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(store.readAvailable({ asOf: '2026-09-01T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      window: {
        btc: expect.arrayContaining([expect.objectContaining({ tradingDate: '2026-08-27' })]),
        eth: expect.arrayContaining([expect.objectContaining({ tradingDate: '2026-08-27' })])
      }
    })
  })

  it('merges a partial provider response with the last stored window instead of discarding prior dates', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const requestWindow = vi.fn()
      .mockResolvedValueOnce({ state: 'available' as const, btc: rows('BTC'), eth: rows('ETH') })
      .mockResolvedValueOnce({ state: 'partial' as const, btc: windowRows('BTC', ['2026-08-28', '2026-08-29', '2026-08-30', '2026-09-01']), eth: undefined })
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow,
      store,
      now: vi.fn().mockReturnValueOnce('2026-09-01T12:00:00.000Z').mockReturnValueOnce('2026-09-02T12:00:00.000Z')
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(store.readAvailable({ asOf: '2026-09-02T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available', window: {
        windowEnd: '2026-08-31',
        btc: expect.arrayContaining([expect.objectContaining({ tradingDate: '2026-08-27' })]),
        eth: expect.arrayContaining([expect.objectContaining({ tradingDate: '2026-08-27' })])
      }
    })
  })

  it('replaces a rolling complete window when BTC has no update marker and ETH has one', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const requestWindow = vi.fn()
      .mockResolvedValueOnce({
        state: 'available' as const,
        btc: windowRows('BTC', ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01']),
        eth: windowRows('ETH', ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'], true)
      })
      .mockResolvedValueOnce({
        state: 'available' as const,
        btc: windowRows('BTC', ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'], false, 10),
        eth: windowRows('ETH', ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'], true, 10)
      })
    const now = vi.fn()
      .mockReturnValueOnce('2026-09-01T12:00:00.000Z')
      .mockReturnValueOnce('2026-09-02T12:00:00.000Z')
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow,
      store,
      now
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(store.readAvailable({ asOf: '2026-09-02T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      window: { windowEnd: '2026-09-01' }
    })
  })

  it('renews an unchanged marker-mixed provider window at its later operational time', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const requestWindow = vi.fn(async () => ({
      state: 'available' as const,
      btc: windowRows('BTC', ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01']),
      eth: windowRows('ETH', ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'], true)
    }))
    const now = vi.fn()
      .mockReturnValueOnce('2026-09-01T12:00:00.000Z')
      .mockReturnValueOnce('2026-09-01T13:00:00.000Z')
    const service = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow,
      store,
      now
    })

    await expect(service.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(service.refresh()).resolves.toEqual({ state: 'unchanged' })
    await expect(store.readAvailable({ asOf: '2026-09-03T13:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      verifiedAt: '2026-09-01T13:00:00.000Z'
    })
  })
})

function rows(asset: 'BTC' | 'ETH') {
  return ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((tradingDate, index) => ({
    asset,
    date: Date.parse(`${tradingDate}T00:00:00.000Z`),
    change: index + 1,
    changeUsd: asset === 'BTC' ? index + 1 : -(index + 1),
    list: [{ name: 'example', ticker: `${asset}-EXAMPLE` }]
  }))
}

function windowRows(asset: 'BTC' | 'ETH', tradingDates: readonly string[], includeUpdateTime = false, valueOffset = 0) {
  return tradingDates.map((tradingDate, index) => ({
    asset,
    date: Date.parse(`${tradingDate}T00:00:00.000Z`),
    change: valueOffset + index + 1,
    changeUsd: asset === 'BTC' ? valueOffset + index + 1 : -(valueOffset + index + 1),
    list: [{ name: 'example', ticker: `${asset}-EXAMPLE` }],
    ...(includeUpdateTime ? { updateTime: String(valueOffset + index + 1) } : {})
  }))
}
