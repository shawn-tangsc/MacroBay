import { beforeEach, describe, expect, it, vi } from 'vitest'

import { intelligenceHttpRequest } from '../adapters/intelligenceHttpClient'
import { createCryptoEtfFlowClient, type CryptoEtfBodyResult } from './cryptoEtfFlowClient'

vi.mock('../adapters/intelligenceHttpClient', () => ({ intelligenceHttpRequest: vi.fn() }))

const mockedRequest = vi.mocked(intelligenceHttpRequest)

function fundsBody(symbol: 'BTC' | 'ETH', asset: 'bitcoin' | 'ethereum', days: readonly { date: string; totalUsdM: number; funds: readonly { ticker: string; issuer: string; netFlowUsdM: number }[] }[]) {
  return JSON.stringify({ symbol, asset, windowDays: 30, days, updatedAt: '2026-11-12T20:14:31.376Z' })
}

const settledFunds = [
  { date: '2026-11-10', totalUsdM: -95, funds: [{ ticker: 'IBIT', issuer: 'BlackRock', netFlowUsdM: -95 }] },
  { date: '2026-11-11', totalUsdM: -299.8, funds: [{ ticker: 'IBIT', issuer: 'BlackRock', netFlowUsdM: -299.8 }] }
]

function response(bodyText: string, status = 200) {
  return { status, headers: { 'x-plan': 'free', 'x-ratelimit-remaining': '59' }, bodyText, byteSize: bodyText.length }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

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
  it('probes the settled funds endpoint and reports what it found', async () => {
    mockedRequest.mockResolvedValueOnce(response(fundsBody('BTC', 'bitcoin', settledFunds)))

    const result = await createCryptoEtfFlowClient().testConnection('secret-key')

    expect(result).toMatchObject({
      state: 'succeeded',
      settled: { tradingDate: '2026-11-11', settledRows: 2, placeholderOrNonTradingRows: 0 },
      plan: 'free',
      rateLimitRemaining: '59'
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest.mock.calls[0]![0].url).toBe('https://api.cryptoetf.today/api/v1/flows/btc/funds')
    expect(mockedRequest.mock.calls[0]![0].headers).toMatchObject({ Authorization: 'Bearer secret-key' })
  })

  it.each([
    [401, 'credential-invalid'],
    [403, 'plan-restricted'],
    [429, 'rate-limited'],
    [500, 'response-unavailable']
  ] as const)('maps HTTP %s to %s without retrying', async (status, failureCode) => {
    mockedRequest.mockResolvedValue(response('{"message":"no"}', status))
    const result = await createCryptoEtfFlowClient().testConnection('secret-key')

    expect(result).toEqual({ state: 'failed', failureCode })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest.mock.calls[0]![0].headers).toMatchObject({ Authorization: 'Bearer secret-key' })
  })

  it('separates a timeout from a transport failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('Request timed out after 15000ms.'))
    await expect(createCryptoEtfFlowClient().testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'request-timeout' })

    mockedRequest.mockRejectedValueOnce(new Error('fetch failed'))
    await expect(createCryptoEtfFlowClient().testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
  })

  it('fails on a 200 whose structure is wrong and never treats it as success', async () => {
    mockedRequest.mockResolvedValueOnce(response(JSON.stringify({ symbol: 'BTC', asset: 'bitcoin', windowDays: 30, days: [] })))

    await expect(createCryptoEtfFlowClient().testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('does not invent a fifth visible state when the answer holds no settled day', async () => {
    mockedRequest.mockResolvedValueOnce(response(fundsBody('BTC', 'bitcoin', [{ date: '2026-11-11', totalUsdM: 0, funds: [] }])))

    await expect(createCryptoEtfFlowClient().testConnection('k')).resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
  })
})
