import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { createZeroXRouterEtfFlowHistoryClient, type ZeroXRouterEtfFlowHistoryDiagnostic } from './zeroXRouterEtfFlowHistoryClient'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

describe('0xRouter ETF flow-history client', () => {
  it('uses the one shared API-key queue for the two fixed asset requests and returns only parsed rows', async () => {
    platformFetch.mockResolvedValueOnce(response('BTC')).mockResolvedValueOnce(response('ETH'))
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const client = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue: queue })

    await expect(client.requestWindow('safe-router-key')).resolves.toMatchObject({
      state: 'available',
      btc: [expect.objectContaining({ changeUsd: 1 })],
      eth: [expect.objectContaining({ changeUsd: -1 })]
    })
    expect(platformFetch).toHaveBeenCalledTimes(2)
    expect(platformFetch).toHaveBeenCalledWith(
      zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.bitcoin,
      expect.objectContaining({ method: 'GET', headers: { 'X-My-Token': 'safe-router-key' }, redirect: 'error' })
    )
    expect(platformFetch).toHaveBeenCalledWith(
      zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.ethereum,
      expect.objectContaining({ method: 'GET', headers: { 'X-My-Token': 'safe-router-key' }, redirect: 'error' })
    )
  })

  it('makes no request for an unsafe credential and preserves the usable asset when the other response is malformed', async () => {
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const client = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue: queue })

    platformFetch.mockClear()
    await expect(client.requestWindow('unsafe\nrouter-key')).resolves.toEqual({ state: 'unavailable' })
    expect(platformFetch).not.toHaveBeenCalled()

    platformFetch.mockResolvedValueOnce(response('BTC')).mockResolvedValueOnce(new Response('{"code":200,"msg":"redacted","data":[{"date":1}]}', {
      status: 200, headers: { 'content-type': 'application/json' }
    }))
    await expect(client.requestWindow('safe-router-key')).resolves.toMatchObject({
      state: 'partial', btc: [expect.objectContaining({ changeUsd: 1 })]
    })
  })

  it('reports only safe per-asset transport and parser terminal classifications', async () => {
    platformFetch
      .mockResolvedValueOnce(new Response('', { status: 403, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, msg: 'redacted', data: [{ date: 1 }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const client = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue: queue })
    const diagnostics: ZeroXRouterEtfFlowHistoryDiagnostic[] = []

    await expect(client.requestWindow('safe-router-key', (diagnostic) => diagnostics.push(diagnostic))).resolves.toEqual({ state: 'unavailable' })
    expect(diagnostics).toEqual([
      { asset: 'bitcoin', transportStage: 'response-status', parser: 'not-invoked' },
      { asset: 'ethereum', transportStage: 'response-envelope', parser: 'unavailable' }
    ])
    expect(diagnostics.every((diagnostic) => Object.keys(diagnostic).sort().join(',') === 'asset,parser,transportStage')).toBe(true)
  })

  it('reports transport-succeeded only after parser accepts a safe response', async () => {
    platformFetch.mockResolvedValueOnce(response('BTC')).mockResolvedValueOnce(response('ETH'))
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const client = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue: queue })
    const diagnostics: ZeroXRouterEtfFlowHistoryDiagnostic[] = []

    await expect(client.requestWindow('safe-router-key', (diagnostic) => diagnostics.push(diagnostic))).resolves.toMatchObject({ state: 'available' })
    expect(diagnostics).toEqual([
      { asset: 'bitcoin', transportStage: 'transport-succeeded', parser: 'available' },
      { asset: 'ethereum', transportStage: 'transport-succeeded', parser: 'available' }
    ])
  })
})

function response(asset: 'BTC' | 'ETH') {
  return new Response(JSON.stringify({
    code: 200,
    msg: 'redacted',
    data: [{
      date: 1_700_000_000_000,
      change: asset === 'BTC' ? 1 : -1,
      changeUsd: asset === 'BTC' ? 1 : -1,
      list: [{ name: 'example', ticker: asset }]
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
