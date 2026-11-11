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
    expect(await client.query({ range: '24h', url: 'forbidden' } as never)).toEqual({ state: 'unavailable', cause: 'query' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('names an unreadable snapshot as a contract mismatch, not as a failed query', async () => {
    // A main process from before the contract change still sends the retired `observationKey`.
    // The renderer cannot parse it, and that must not read like "the source did not answer": the
    // reader would retry forever. The outcome says which side is out of step.
    const invoke = vi.fn(async () => ({ state: 'unavailable', observationKey: { indexBtc: 'up', ethBtc: 'flat' } }))
    const client = createCrossAssetObservationClient(invoke)
    const outcome = await client.query({ range: '24h' })
    expect('cause' in outcome && outcome.cause).toBe('contract')
    // 拒在哪一字段要带出来（这次的洞里，服务真产出被拒在 `keys`）。
    expect('cause' in outcome ? outcome.field : undefined).toBeDefined()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('treats a plain unavailable answer as a failed read, not as a version mismatch', async () => {
    // 主进程回的就是 `{state:'unavailable'}`（读失败 / 无效请求）：界面只能说「行情暂不可用 + 再试一次」，
    // 不许说「版本不一致，重启应用」——那是同一版代码，重启治不了它。
    const client = createCrossAssetObservationClient(vi.fn(async () => ({ state: 'unavailable' })))
    expect(await client.query({ range: '24h' })).toEqual({ state: 'unavailable', cause: 'query' })
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
