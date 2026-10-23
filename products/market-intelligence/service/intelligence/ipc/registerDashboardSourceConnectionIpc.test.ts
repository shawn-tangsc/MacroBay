import { describe, expect, it, vi } from 'vitest'

import { registerDashboardSourceConnectionIpc } from './registerDashboardSourceConnectionIpc'

describe('registerDashboardSourceConnectionIpc', () => {
  it('registers one Dashboard-only connection IPC and rebuilds an exact result', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const service = { testConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerDashboardSourceConnectionIpc((_productId, method, handler) => handlers.set(method, handler), service)

    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.({ sourceId: 'binance-futures-positioning' })).resolves.toEqual({ state: 'succeeded' })
    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.({ sourceId: 'binance-futures-positioning', extra: true })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(service.testConnection).toHaveBeenCalledTimes(1)
  })

  it('allows only the exact fixed DeFiLlama probe input', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const service = { testConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerDashboardSourceConnectionIpc((_productId, method, handler) => handlers.set(method, handler), service)

    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.({ sourceId: 'defillama-stablecoins' })).resolves.toEqual({ state: 'succeeded' })
    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.({ sourceId: 'defillama-stablecoins', extra: true })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(service.testConnection).toHaveBeenCalledOnce()
  })

  it('rejects a non-plain input before calling the Dashboard connection service', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const service = { testConnection: vi.fn(async () => ({ state: 'succeeded' })) }
    registerDashboardSourceConnectionIpc((_productId, method, handler) => handlers.set(method, handler), service)
    const payload = Object.assign(Object.create({ inherited: 'foreign' }), { sourceId: 'alternative-fear-greed' })

    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.(payload)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(service.testConnection).not.toHaveBeenCalled()
  })

  it.each([
    { state: 'succeeded', url: 'https://secret.example.test' },
    { state: 'failed', failureCode: 'request-timeout', exception: 'secret' },
    new Proxy({}, { ownKeys() { throw new Error('hostile') } })
  ])('fails closed for hostile service results', async (result) => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const service = { testConnection: vi.fn(async () => result) }
    registerDashboardSourceConnectionIpc((_productId, method, handler) => handlers.set(method, handler), service)

    await expect(handlers.get('intelligence.dashboardSourceConnection.test')?.({ sourceId: 'alternative-fear-greed' })).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
  })
})
