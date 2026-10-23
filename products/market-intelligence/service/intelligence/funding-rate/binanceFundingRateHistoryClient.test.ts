import { describe, expect, it, vi } from 'vitest'

import { createBinanceFundingRateHistoryClient, fundingRateCollectionWindowPolicy } from './binanceFundingRateHistoryClient'

describe('Binance funding rate history client', () => {
  it('uses platformFetch for the exact fixed BTCUSDT and ETHUSDT limit=22 URLs and normalizes 22 points per asset', async () => {
    const platformFetch = vi.fn(async (url: string) => new Response(JSON.stringify(points(url.includes('BTCUSDT') ? 'BTCUSDT' : 'ETHUSDT')), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createBinanceFundingRateHistoryClient({ platformFetch })

    await expect(client.requestHistory({ btc: fundingRateCollectionWindowPolicy.assets.btc, eth: fundingRateCollectionWindowPolicy.assets.eth })).resolves.toMatchObject({ state: 'available', btc: { length: 22 }, eth: { length: 22 } })
    expect(platformFetch).toHaveBeenNthCalledWith(1, 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=22', expect.objectContaining({ method: 'GET', redirect: 'error' }))
    expect(platformFetch).toHaveBeenNthCalledWith(2, 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=22', expect.objectContaining({ method: 'GET', redirect: 'error' }))
  })

  it('projects the funding fields when Binance includes an optional mark price', async () => {
    const platformFetch = vi.fn(async (url: string) => new Response(JSON.stringify(
      points(url.includes('BTCUSDT') ? 'BTCUSDT' : 'ETHUSDT').map((row) => ({ ...row, markPrice: '100000.0' }))
    ), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createBinanceFundingRateHistoryClient({ platformFetch })

    const result = await client.requestHistory({ btc: fundingRateCollectionWindowPolicy.assets.btc, eth: fundingRateCollectionWindowPolicy.assets.eth })

    expect(result).toMatchObject({ state: 'available' })
    if (result.state === 'available') {
      expect(result.btc[0]).toEqual({ asset: 'btc', fundingTimeMs: Date.parse('2026-09-01T00:00:00.000Z'), ratePercent: 0.01 })
      expect(result.eth[0]).toEqual({ asset: 'eth', fundingTimeMs: Date.parse('2026-09-01T00:00:00.000Z'), ratePercent: 0.01 })
    }
  })

  it.each([
    ['missing points', [{ symbol: 'BTCUSDT', fundingRate: '0.0001', fundingTime: 1 }]],
    ['wrong symbol', points('ETHUSDT')],
    ['duplicate time', [...points('BTCUSDT').slice(0, 21), { ...points('BTCUSDT')[20], fundingRate: '0.0002' }]],
    ['non-finite rate', [{ symbol: 'BTCUSDT', fundingRate: 'NaN', fundingTime: 1 }]]
  ])('fails closed for %s without returning a partial history', async (_name, payload) => {
    const platformFetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createBinanceFundingRateHistoryClient({ platformFetch })
    await expect(client.requestHistory({ btc: fundingRateCollectionWindowPolicy.assets.btc, eth: fundingRateCollectionWindowPolicy.assets.eth })).resolves.toEqual({ state: 'unavailable' })
  })
})

function points(symbol: 'BTCUSDT' | 'ETHUSDT') {
  return Array.from({ length: fundingRateCollectionWindowPolicy.limit }, (_, index) => ({ symbol, fundingRate: '0.0001', fundingTime: Date.parse('2026-09-01T00:00:00.000Z') + index }))
}
