import { describe, expect, it, vi } from 'vitest'
import { createProductIpcRegistry } from '../../../../../platform/desktop/ipc/productIpcRegistry'
import { registerCrossAssetIpc } from './registerCrossAssetIpc'
import { crossAssetMethods } from '../../../contracts/crossAssetObservationContracts'

describe('cross-asset product IPC registration', () => {
  it('registers exactly eight methods, validates before invocation, and normalizes private failures', async () => {
    const registry = createProductIpcRegistry()
    const runtime = { acquire: vi.fn(async () => ({ state: 'active', leaseId: 'test-id', expiresAt: 1000 })),
      renew: vi.fn(), release: vi.fn(), refresh: vi.fn(), cancelInterfaceTest: vi.fn(async () => ({ state: 'cancelled' })), testInterface: vi.fn(async () => ({ state: 'busy' })) }
    const query = { query: vi.fn(() => { throw new Error('private payload or path') }) }
    const configuration = { read: vi.fn(async () => ({ state: 'configured', enabled: true })) }
    registerCrossAssetIpc(registry.register, { runtime: runtime as never, query: query as never, configuration: configuration as never, now: () => 100 })
    expect(registry.seal().map(item => item.method)).toEqual(Object.values(crossAssetMethods))
    const invoke = (method: string, payload: unknown) => registry.invoke('market-intelligence', method, payload)
    expect(await invoke(crossAssetMethods.acquire, { url: 'forbidden' })).toEqual({ state: 'invalid-request' })
    expect(runtime.acquire).not.toHaveBeenCalled()
    expect(await invoke(crossAssetMethods.acquire, {})).toEqual({ state: 'active', leaseId: 'test-id', expiresAt: 1000 })
    expect(await invoke(crossAssetMethods.query, { range: '24h' })).toEqual({ state: 'unavailable' })
    expect(await invoke(crossAssetMethods.getSourceConfiguration, {})).toEqual({ state: 'configured', enabled: true })
    expect(await invoke(crossAssetMethods.testInterface, { leaseId: 'test-id' })).toEqual({ state: 'invalid-request' })
    expect(runtime.testInterface).not.toHaveBeenCalled()
    expect(await invoke(crossAssetMethods.testInterface, {})).toEqual({ state: 'busy' })
    expect(await invoke(crossAssetMethods.cancelInterfaceTest, {})).toEqual({ state: 'cancelled' })
    expect(runtime.refresh).not.toHaveBeenCalled()
  })

  it('rejects invalid dependency outputs rather than forwarding internal objects', async () => {
    const registry = createProductIpcRegistry()
    registerCrossAssetIpc(registry.register, { now: () => 100, runtime: { acquire: async () => ({ state: 'active', leaseId: 'test-id', expiresAt: 1000, key: 'private' }) } as never,
      query: {} as never, configuration: {} as never })
    registry.seal()
    expect(await registry.invoke('market-intelligence', crossAssetMethods.acquire, {})).toEqual({ state: 'unavailable' })
  })
})
