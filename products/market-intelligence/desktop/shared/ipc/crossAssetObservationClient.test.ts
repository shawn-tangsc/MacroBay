// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createCrossAssetObservationClient } from './crossAssetObservationClient'
import { crossAssetMethods } from '../../../contracts/crossAssetObservationContracts'

describe('cross-asset renderer product client', () => {
  it('uses only this product IPC and rejects unsafe inputs before invoking', async () => {
    const invoke = vi.fn(async () => ({ state: 'active', leaseId: 'opaque-id', expiresAt: Date.now() + 30_000 }))
    const client = createCrossAssetObservationClient(invoke)
    expect(await client.acquire()).toMatchObject({ state: 'active', leaseId: 'opaque-id' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', crossAssetMethods.acquire, {})
    invoke.mockClear()
    expect(await client.query({ range: '24h', url: 'forbidden' } as never)).toEqual({ state: 'unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not forward extended command objects, raw errors or unknown states', async () => {
    const invoke = vi.fn(async () => ({ state: 'configured', enabled: true, credential: 'private' }))
    const client = createCrossAssetObservationClient(invoke)
    expect(await client.getSourceConfiguration()).toEqual({ state: 'unavailable' })
    invoke.mockRejectedValue(new Error('private'))
    expect(await client.acquire()).toEqual({ state: 'unavailable' })
  })

  it('tests and cancels from the source drawer without a lease or alternate settings write', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => method === crossAssetMethods.cancelInterfaceTest ? { state: 'cancelled' } : { state: 'busy' })
    const client = createCrossAssetObservationClient(invoke)
    expect(await client.testInterface()).toEqual({ state: 'busy' })
    expect(await client.cancelInterfaceTest()).toEqual({ state: 'cancelled' })
    expect(invoke.mock.calls).toEqual([
      ['market-intelligence', crossAssetMethods.testInterface, {}], ['market-intelligence', crossAssetMethods.cancelInterfaceTest, {}]
    ])
    expect(client).not.toHaveProperty('setEnabled')
  })
})
