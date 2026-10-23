// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { dashboardSourceConnectionClient } from './dashboardSourceConnectionClient'

describe('dashboardSourceConnectionClient', () => {
  it('uses the sole Dashboard source-test IPC method with the selected fixed source', async () => {
    const invoke = vi.fn(async () => ({ state: 'succeeded' }))
    window.platform = { products: { invoke } } as never

    await expect(dashboardSourceConnectionClient.testConnection('alternative-fear-greed')).resolves.toEqual({ state: 'succeeded' })
    const result = await dashboardSourceConnectionClient.testConnection('alternative-fear-greed')
    expect(Object.isFrozen(result)).toBe(true)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dashboardSourceConnection.test', { sourceId: 'alternative-fear-greed' })
    expect(invoke).not.toHaveBeenCalledWith('market-intelligence', 'intelligenceSources.testConnection', expect.anything())
  })

  it('allows the fixed DeFiLlama stablecoin probe through the same safe IPC boundary', async () => {
    const invoke = vi.fn(async () => ({ state: 'succeeded' }))
    window.platform = { products: { invoke } } as never

    await expect(dashboardSourceConnectionClient.testConnection('defillama-stablecoins')).resolves.toEqual({ state: 'succeeded' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dashboardSourceConnection.test', { sourceId: 'defillama-stablecoins' })
  })

  it.each([
    ['binance-futures-positioning', { state: 'failed', failureCode: 'request-timeout' }, { state: 'failed', failureCode: 'request-timeout' }],
    ['alternative-fear-greed', { state: 'failed', failureCode: 'credential-not-configured' }, { state: 'failed', failureCode: 'response-unavailable' }],
    ['alternative-fear-greed', { state: 'succeeded', exception: 'secret' }, { state: 'failed', failureCode: 'response-unavailable' }],
    ['alternative-fear-greed', new Proxy({}, { getPrototypeOf: () => { throw new Error('untrusted') } }), { state: 'failed', failureCode: 'response-unavailable' }]
  ])('fails closed for unsafe result', async (sourceId, response, expected) => {
    window.platform = { products: { invoke: vi.fn(async () => response) } } as never

    await expect(dashboardSourceConnectionClient.testConnection(sourceId)).resolves.toEqual(expected)
  })

  it('rejects a foreign source before IPC', async () => {
    const invoke = vi.fn()
    window.platform = { products: { invoke } } as never

    await expect(dashboardSourceConnectionClient.testConnection('macro-calendar-fed' as never)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['accessor', () => Object.defineProperty({}, 'state', { enumerable: true, get: () => { throw new Error('untrusted') } })],
    ['symbol', () => Object.assign({ state: 'succeeded' }, { [Symbol('extension')]: true })],
    ['cyclic extension', () => { const result: Record<string, unknown> = { state: 'succeeded' }; result.self = result; return result }],
    ['throwing proxy', () => new Proxy({}, { getPrototypeOf: () => { throw new Error('untrusted') } })]
  ])('fails closed for a hostile %s result', async (_name, createResult) => {
    window.platform = { products: { invoke: vi.fn(async () => createResult()) } } as never

    await expect(dashboardSourceConnectionClient.testConnection('alternative-fear-greed')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
  })

  it('maps a rejected bridge request to the fixed unavailable result', async () => {
    window.platform = { products: { invoke: vi.fn(async () => { throw new Error('untrusted') }) } } as never

    const result = await dashboardSourceConnectionClient.testConnection('alternative-fear-greed')
    expect(result).toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(Object.isFrozen(result)).toBe(true)
  })
})
