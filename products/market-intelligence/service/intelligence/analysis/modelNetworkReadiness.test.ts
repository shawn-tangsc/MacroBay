import { afterEach, describe, expect, it, vi } from 'vitest'

import { createModelNetworkReadinessGate, modelNetworkReadinessPolicy } from './modelNetworkReadiness'

const providerState = {
  providers: [{
    id: 'provider-1', name: 'provider', enabled: true, baseUrl: 'https://api.example.test',
    apiKey: 'key', endpoints: [], customHeaders: [],
    models: [{ id: 'model-1', name: 'model', capabilities: { chat: true } }]
  }]
}

function dnsError(): Error {
  const error = new Error('fetch failed') as Error & { cause?: { code: string } }
  error.cause = { code: 'ENOTFOUND' }
  return error
}

describe('startup network readiness gate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats any HTTP answer as reachable: 400 / 401 / 403 / 404 / 405 / 500 all count', async () => {
    for (const status of [400, 401, 403, 404, 405, 500]) {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const fetchMock = vi.fn(async () => ({ status, body: null }) as unknown as Response)
      const gate = createModelNetworkReadinessGate({
        getProviderState: async () => providerState as never,
        fetch: fetchMock as never
      })
      gate.start()
      await vi.advanceTimersByTimeAsync(0)

      await expect(gate.wait(), `status ${status}`).resolves.toBe('ready')
      expect(fetchMock, `status ${status}`).toHaveBeenCalledOnce()
      expect(gate.state()).toMatchObject({ status: 'ready', httpStatus: status })
      expect(gate.networkReadyAt()).toBeTypeOf('string')
    }
  })

  it('keeps backing off on transport failures, 500 ms doubling, and stops at 20 s as network-not-ready', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const attemptsAt: number[] = []
    const fetchMock = vi.fn(async () => {
      attemptsAt.push(Date.now())
      throw dnsError()
    })
    const gate = createModelNetworkReadinessGate({
      getProviderState: async () => providerState as never,
      fetch: fetchMock as never
    })
    gate.start()
    await vi.advanceTimersByTimeAsync(modelNetworkReadinessPolicy.budgetMs + 1_000)

    await expect(gate.wait()).resolves.toBe('not-ready')
    expect(gate.state()).toMatchObject({ status: 'not-ready', lastTransportErrorKind: 'dns' })
    expect(gate.networkReadyAt()).toBeUndefined()
    // 500 → 1000 → 2000 → 4000 → 8000，最后一次等到 20 秒预算耗尽；不是每个失败都立刻放弃。
    expect(attemptsAt).toEqual([0, 500, 1_500, 3_500, 7_500, 15_500, 20_000])
  })

  it('waits nobody when it never started: outside the startup window it is not in charge', async () => {
    const gate = createModelNetworkReadinessGate({
      getProviderState: async () => providerState as never,
      fetch: vi.fn() as never
    })
    await expect(gate.wait()).resolves.toBe('ready')
    expect(gate.state()).toEqual({ status: 'idle' })
  })

  it('judges ready when there is no provider worth probing, leaving that case to model-not-ready', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    const gate = createModelNetworkReadinessGate({
      getProviderState: async () => ({ providers: [] }),
      fetch: fetchMock as never
    })
    gate.start()
    await vi.advanceTimersByTimeAsync(0)
    await expect(gate.wait()).resolves.toBe('ready')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
