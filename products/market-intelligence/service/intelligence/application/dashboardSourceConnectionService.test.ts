import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: platformFetch }))

import { createDashboardSourceConnectionService } from './dashboardSourceConnectionService'

describe('dashboardSourceConnectionService', () => {
  it('makes exactly one fixed Alternative.me request and returns only the compact success state', async () => {
    const body = '{"name":"Fear and Greed Index","data":[{"value":"46","value_classification":"Fear","timestamp":"1787097600"}],"metadata":{"error":null}}'
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('alternative-fear-greed')).resolves.toEqual({ state: 'succeeded' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('https://api.alternative.me/fng/?limit=1', expect.objectContaining({ method: 'GET', redirect: 'error' }))
  })

  it('probes the fixed DeFiLlama endpoint only when the core USDT and USDC structure parses', async () => {
    const body = JSON.stringify(stablecoinPayload())
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('defillama-stablecoins')).resolves.toEqual({ state: 'succeeded' })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('https://stablecoins.llama.fi/stablecoins', expect.objectContaining({ method: 'GET', redirect: 'error' }))
  })

  it('fails closed for DeFiLlama core identity drift without invoking a collector path', async () => {
    const body = JSON.stringify(stablecoinPayload({ symbol: 'USDTX' }))
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('defillama-stablecoins')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(request).toHaveBeenCalledOnce()
  })

  it('fails closed without transport for foreign or extension-bearing source input', async () => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)
    const service = createDashboardSourceConnectionService()

    await expect(service.testConnection('foreign-source')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    await expect(service.testConnection({ sourceId: 'alternative-fear-greed', extra: true })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ['Binance', 'binance-futures-positioning', '[]', 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'],
    ['Alternative.me malformed container', 'alternative-fear-greed', '{}', 'https://api.alternative.me/fng/?limit=1']
  ])('uses the fixed %s request and accepts only its minimum response container', async (_label, sourceId, body, url) => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    const result = await createDashboardSourceConnectionService().testConnection(sourceId)

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET', redirect: 'error' }))
    expect(result).toEqual(body === '[]' ? { state: 'succeeded' } : { state: 'failed', failureCode: 'response-unavailable' })
  })

  it.each([
    ['missing data', '{}'],
    ['non-array data', '{"data":{}}'],
    ['invalid JSON', '{"data":']
  ])('rejects Alternative.me %s envelope without parsing index values', async (_label, body) => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('alternative-fear-greed')).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([
    ['redirect', 302],
    ['non-success', 503]
  ])('maps a %s Dashboard response to the fixed unavailable result without retrying', async (_label, status) => {
    const text = vi.fn()
    const request = vi.fn().mockResolvedValue({ status, headers: new Headers(), text })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('binance-futures-positioning')).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(request).toHaveBeenCalledOnce()
    expect(text).not.toHaveBeenCalled()
  })

  it('rejects an oversized Dashboard response without a follow-up request', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': '1500001' }),
      text: vi.fn()
    })
    platformFetch.mockReturnValue(request)

    await expect(createDashboardSourceConnectionService().testConnection('alternative-fear-greed')).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.results[0]?.value).toBeTruthy()
  })

  it('maps transport and body-read failures to their fixed redacted results', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('dns unavailable'))
    platformFetch.mockReturnValue(transport)
    await expect(createDashboardSourceConnectionService().testConnection('alternative-fear-greed')).resolves.toEqual({
      state: 'failed', failureCode: 'transport-unavailable'
    })
    expect(transport).toHaveBeenCalledOnce()

    const response = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), text: vi.fn().mockRejectedValue(new Error('body unavailable')) })
    platformFetch.mockReturnValue(response)
    await expect(createDashboardSourceConnectionService().testConnection('binance-futures-positioning')).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(response).toHaveBeenCalledOnce()
  })

  it('maps the bounded Dashboard deadline to request-timeout without retrying', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn((_: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
      platformFetch.mockReturnValue(request)
      const result = createDashboardSourceConnectionService().testConnection('binance-futures-positioning')

      await vi.advanceTimersByTimeAsync(15_000)
      await expect(result).resolves.toEqual({ state: 'failed', failureCode: 'request-timeout' })
      expect(request).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reuse the generic health-writing source probe', async () => {
    const body = '{"data":[]}'
    platformFetch.mockReturnValue(vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')) }),
      text: vi.fn().mockResolvedValue(body)
    }))
    const genericProbe = vi.fn()

    await createDashboardSourceConnectionService().testConnection('alternative-fear-greed')

    expect(genericProbe).not.toHaveBeenCalled()
  })
})

function stablecoinPayload(usdtOverrides: Record<string, unknown> = {}) {
  return {
    peggedAssets: [
      { id: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 200 }, circulatingPrevDay: { peggedUSD: 190 }, circulatingPrevWeek: { peggedUSD: 190 }, circulatingPrevMonth: { peggedUSD: 180 }, ...usdtOverrides },
      { id: '2', symbol: 'USDC', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 110 }, circulatingPrevDay: { peggedUSD: 110 }, circulatingPrevWeek: { peggedUSD: 110 }, circulatingPrevMonth: { peggedUSD: 100 } }
    ]
  }
}
