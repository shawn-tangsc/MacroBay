import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { probeZeroXRouterEtfFlowHistory } from './zeroXRouterEtfFlowHistoryProbe'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

describe('probeZeroXRouterEtfFlowHistory', () => {
  it('uses the shared queue and admits only the observed success envelope as a transient terminal result', async () => {
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    platformFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, msg: 'redacted', data: [{
      date: 1_700_000_000_000, change: 1, changeUsd: 1, list: [{ name: 'example', ticker: 'BTC' }]
    }] }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=UTF-8' }
    }))

    await expect(probeZeroXRouterEtfFlowHistory({
      asset: 'bitcoin', apiKey: 'router-probe-key', requestGovernanceQueue: queue
    })).resolves.toEqual({ asset: 'bitcoin', state: 'succeeded' })
    expect(platformFetch).toHaveBeenCalledWith(
      zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.bitcoin,
      expect.objectContaining({
        method: 'GET', headers: { 'X-My-Token': 'router-probe-key' }, redirect: 'error'
      })
    )
  })

  it.each([
    ['non-2xx HTML', new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } })],
    ['successful HTML', new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['malformed envelope', new Response(JSON.stringify({ code: 200, data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['missing observed envelope message', new Response(JSON.stringify({ code: 200, data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['malformed observed row', new Response(JSON.stringify({ code: 200, msg: 'redacted', data: [{ date: 1, change: 1, list: [] }] }), { status: 200, headers: { 'content-type': 'application/json' } })],
    ['over the ETF-specific body cap', new Response(new Uint8Array(600_734), {
      status: 200, headers: { 'content-type': 'application/json' }
    })]
  ])('fails closed for %s without exposing history data', async (_name, response) => {
    platformFetch.mockResolvedValueOnce(response)
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })

    await expect(probeZeroXRouterEtfFlowHistory({
      asset: 'ethereum', apiKey: 'router-probe-key', requestGovernanceQueue: queue
    })).resolves.toEqual({ asset: 'ethereum', state: 'failed', failureCode: 'response-unavailable' })
  })

  it('does not request flow history for a missing or unsafe credential', async () => {
    platformFetch.mockClear()
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })

    await expect(probeZeroXRouterEtfFlowHistory({
      asset: 'bitcoin', apiKey: 'router\nprobe-key', requestGovernanceQueue: queue
    })).resolves.toEqual({ asset: 'bitcoin', state: 'failed', failureCode: 'response-unavailable' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('waits behind the same API-key FIFO scope instead of bypassing the queue', async () => {
    platformFetch.mockClear()
    const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const blockers = Array.from({ length: 10 }, () => deferred<void>())
    blockers.forEach((blocker) => void queue.enqueue({
      sourceId: zeroXRouterSourcePolicy.sourceId,
      policy: zeroXRouterSourcePolicy.requestGovernance,
      apiKey: 'router-probe-key',
      intent: 'user',
      run: () => blocker.promise
    }))

    const pending = probeZeroXRouterEtfFlowHistory({
      asset: 'bitcoin', apiKey: 'router-probe-key', requestGovernanceQueue: queue
    })
    await vi.waitFor(() => expect(queue.pendingCount()).toBe(1))
    expect(platformFetch).not.toHaveBeenCalled()

    queue.close()
    await expect(pending).resolves.toEqual({ asset: 'bitcoin', state: 'failed', failureCode: 'response-unavailable' })
  })

  it.each([
    ['bitcoin', 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history'],
    ['ethereum', 'https://0xrouter.app/cexdata/etf/ethereum/flow-history']
  ] as const)('settles %s flow history at the fixed deadline when platformFetch ignores abort', async (asset, url) => {
    vi.useFakeTimers()
    try {
      let requestSignal: AbortSignal | undefined
      platformFetch.mockImplementationOnce((_url: string, options: RequestInit) => {
        requestSignal = options.signal ?? undefined
        return new Promise<Response>(() => undefined)
      })
      const queue = createSourceRequestGovernanceQueue({ now: () => Date.now() })

      const result = probeZeroXRouterEtfFlowHistory({ asset, apiKey: 'router-probe-key', requestGovernanceQueue: queue })
      await vi.advanceTimersByTimeAsync(zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.requestTimeoutMs)

      await expect(result).resolves.toEqual({ asset, state: 'failed', failureCode: 'request-timeout' })
      expect(requestSignal?.aborted).toBe(true)
      expect(platformFetch).toHaveBeenCalledWith(url, expect.objectContaining({
        method: 'GET', headers: { 'X-My-Token': 'router-probe-key' }, redirect: 'error'
      }))
    } finally {
      vi.useRealTimers()
    }
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}
