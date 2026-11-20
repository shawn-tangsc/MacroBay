import { describe, expect, it, vi } from 'vitest'

import { createCryptoEtfFlowClient, type CryptoEtfBodyResult } from './cryptoEtfFlowClient'

function fundsBody(symbol: 'BTC' | 'ETH', asset: 'bitcoin' | 'ethereum', days: readonly { date: string; totalUsdM: number; funds: readonly { ticker: string; issuer: string; netFlowUsdM: number }[] }[]) {
  return JSON.stringify({ symbol, asset, windowDays: 30, days, updatedAt: '2026-11-12T20:14:31.376Z' })
}

const settledFunds = [
  { date: '2026-11-10', totalUsdM: -95, funds: [{ ticker: 'IBIT', issuer: 'BlackRock', netFlowUsdM: -95 }] },
  { date: '2026-11-11', totalUsdM: -299.8, funds: [{ ticker: 'IBIT', issuer: 'BlackRock', netFlowUsdM: -299.8 }] }
]

function fetchReturning(bodyText: string, status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(bodyText, { status, headers: { 'x-plan': 'free', 'x-ratelimit-remaining': '59' } }))
}

function fetchFailing(message: string) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => { throw new Error(message) })
}

describe('createCryptoEtfFlowClient readSettledWindow', () => {
  it('reads both assets from the settled funds endpoint and reports the latest trading day', async () => {
    const requestBody = vi.fn(async (url: string): Promise<CryptoEtfBodyResult> => ({
      state: 'ok',
      body: url.includes('/btc') ? fundsBody('BTC', 'bitcoin', settledFunds) : fundsBody('ETH', 'ethereum', settledFunds),
      status: 200,
      headers: {}
    }))
    const client = createCryptoEtfFlowClient({ requestBody })

    const result = await client.readSettledWindow('k')

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.btc.state).toBe('available')
    expect(result.eth.state).toBe('available')
    if (result.btc.state !== 'available') return
    expect(result.btc.audit.latestTradingDate).toBe('2026-11-11')
    expect(result.btc.days.map((row) => row.netFlowUsd)).toEqual([-95_000_000, -299_800_000])
    expect(requestBody.mock.calls.map(([url]) => url)).toEqual([
      'https://api.cryptoetf.today/api/v1/flows/btc/funds',
      'https://api.cryptoetf.today/api/v1/flows/eth/funds'
    ])
  })

  it('returns partial when only one asset answers, and never invents the other', async () => {
    const requestBody = vi.fn(async (url: string): Promise<CryptoEtfBodyResult> => url.includes('/btc')
      ? { state: 'ok', body: fundsBody('BTC', 'bitcoin', settledFunds), status: 200, headers: {} }
      : { state: 'failed', failureCode: 'credential-invalid' })
    const result = await createCryptoEtfFlowClient({ requestBody }).readSettledWindow('k')

    expect(result).toMatchObject({ state: 'partial' })
    expect(result).not.toHaveProperty('eth')
  })

  it('does not call the network with an empty key', async () => {
    const requestBody = vi.fn()
    const result = await createCryptoEtfFlowClient({ requestBody }).readSettledWindow('   ')

    expect(result).toEqual({ state: 'unavailable', failureCode: 'credential-invalid' })
    expect(requestBody).not.toHaveBeenCalled()
  })
})

describe('createCryptoEtfFlowClient testConnection', () => {
  it('probes the settled funds endpoint through the injected platform fetch', async () => {
    const platformFetch = fetchReturning(fundsBody('BTC', 'bitcoin', settledFunds))

    const result = await createCryptoEtfFlowClient({ platformFetch }).testConnection('secret-key')

    expect(result).toMatchObject({
      state: 'succeeded',
      settled: { tradingDate: '2026-11-11', settledRows: 2, placeholderOrNonTradingRows: 0 },
      plan: 'free',
      rateLimitRemaining: '59'
    })
    expect(platformFetch).toHaveBeenCalledTimes(1)
    expect(platformFetch.mock.calls[0]![0]).toBe('https://api.cryptoetf.today/api/v1/flows/btc/funds')
    expect(platformFetch.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer secret-key' } })
  })

  it.each([
    [401, 'credential-invalid'],
    [403, 'plan-restricted'],
    [429, 'rate-limited'],
    [500, 'response-unavailable']
  ] as const)('maps HTTP %s to %s without retrying', async (status, failureCode) => {
    const platformFetch = fetchReturning('{"message":"no"}', status)
    const result = await createCryptoEtfFlowClient({ platformFetch }).testConnection('secret-key')

    expect(result).toEqual({ state: 'failed', failureCode })
    expect(platformFetch).toHaveBeenCalledTimes(1)
  })

  it('separates a timeout from a transport failure', async () => {
    await expect(createCryptoEtfFlowClient({ platformFetch: fetchFailing('Request timed out after 15000ms.') }).testConnection('k'))
      .resolves.toEqual({ state: 'failed', failureCode: 'request-timeout' })
    await expect(createCryptoEtfFlowClient({ platformFetch: fetchFailing('fetch failed') }).testConnection('k'))
      .resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
  })

  it('fails on a 200 whose structure is wrong and never treats it as success', async () => {
    const platformFetch = fetchReturning(JSON.stringify({ symbol: 'BTC', asset: 'bitcoin', windowDays: 30, days: [] }))

    await expect(createCryptoEtfFlowClient({ platformFetch }).testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
    expect(platformFetch).toHaveBeenCalledTimes(1)
  })

  it('does not invent a fifth visible state when the answer holds no settled day', async () => {
    const platformFetch = fetchReturning(fundsBody('BTC', 'bitcoin', [{ date: '2026-11-11', totalUsdM: 0, funds: [] }]))

    await expect(createCryptoEtfFlowClient({ platformFetch }).testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
  })
})
