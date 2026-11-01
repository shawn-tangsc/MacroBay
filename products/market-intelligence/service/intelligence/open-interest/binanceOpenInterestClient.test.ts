import { describe, expect, it, vi } from 'vitest'

import { openInterestHistoryPolicy } from '../../../contracts/openInterestHistory'
import { createBinanceOpenInterestClient } from './binanceOpenInterestClient'

const nowMs = Date.UTC(2026, 9, 29, 0, 0)

function oiRows(symbol: string, count: number, startMs = nowMs - (count - 1) * 900_000) {
  return Array.from({ length: count }, (_, index) => ({
    symbol,
    sumOpenInterest: '12345.678',
    sumOpenInterestValue: '8750000000.12345678',
    timestamp: startMs + index * 900_000
  }))
}

function klineRows(count: number, startMs = nowMs - (count - 1) * 900_000) {
  return Array.from({ length: count }, (_, index) => {
    const openTime = startMs + index * 900_000
    return [openTime, '79000', '80000', '78000', '79500.5', '1234.5', openTime + 900_000 - 1, '0', 1, '0', '0', '0']
  })
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

describe('Binance open interest client', () => {
  it('asks for the 15m window exactly, through platformFetch, one symbol per request', async () => {
    const platformFetch = vi.fn(async () => json(oiRows('BTCUSDT', 2)))
    const client = createBinanceOpenInterestClient({ platformFetch })

    await expect(client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 2 })).resolves.toHaveLength(2)
    expect(platformFetch).toHaveBeenCalledWith(
      `${openInterestHistoryPolicy.endpoint}?symbol=BTCUSDT&period=15m&limit=2`,
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    )
  })

  it('passes endTime for the second cold-start segment', async () => {
    const platformFetch = vi.fn(async () => json(oiRows('BTCUSDT', 2)))
    const client = createBinanceOpenInterestClient({ platformFetch })
    await client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 172, endTime: 1_790_000_000_000 })
    expect(platformFetch.mock.calls[0]![0]).toContain('&endTime=1790000000000')
  })

  it('normalises notional open interest and sorts ascending', async () => {
    const platformFetch = vi.fn(async () => json([...oiRows('BTCUSDT', 3)].reverse()))
    const client = createBinanceOpenInterestClient({ platformFetch })
    const rows = await client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 3 })
    expect(rows).toEqual([
      { asset: 'btc', observedMs: nowMs - 1_800_000, notionalUsd: 8750000000.12345678 },
      { asset: 'btc', observedMs: nowMs - 900_000, notionalUsd: 8750000000.12345678 },
      { asset: 'btc', observedMs: nowMs, notionalUsd: 8750000000.12345678 }
    ])
  })

  it.each([
    ['a non-array body', { symbol: 'BTCUSDT' }],
    ['an empty array', []],
    ['a foreign symbol', oiRows('ETHUSDT', 2)],
    ['a duplicate timestamp', [oiRows('BTCUSDT', 1)[0], oiRows('BTCUSDT', 1)[0]]],
    ['a missing value', [{ symbol: 'BTCUSDT', timestamp: 1 }]],
    ['a scientific-notation value', [{ symbol: 'BTCUSDT', sumOpenInterestValue: '8.7e9', timestamp: 1 }]],
    ['a negative value', [{ symbol: 'BTCUSDT', sumOpenInterestValue: '-1', timestamp: 1 }]],
    ['a non-integer timestamp', [{ symbol: 'BTCUSDT', sumOpenInterestValue: '1', timestamp: 1.5 }]]
  ])('fails closed on %s', async (_name, payload) => {
    const client = createBinanceOpenInterestClient({ platformFetch: vi.fn(async () => json(payload)) })
    await expect(client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 2 })).resolves.toBeUndefined()
  })

  it('drops the kline row that is still forming', async () => {
    const platformFetch = vi.fn(async () => json([
      [nowMs - 1_800_000, '1', '1', '1', '79000', '100', nowMs - 900_000 - 1, '0', 1, '0', '0', '0'],
      [nowMs - 900_000, '1', '1', '1', '79100', '200', nowMs - 1, '0', 1, '0', '0', '0'],
      [nowMs, '1', '1', '1', '79200', '50', nowMs + 899_999, '0', 1, '0', '0', '0']
    ]))
    const client = createBinanceOpenInterestClient({ platformFetch })
    const rows = await client.requestKlines({ asset: 'btc', symbol: 'BTCUSDT', limit: 3, nowMs })
    expect(rows).toHaveLength(2)
    expect(rows!.at(-1)).toEqual({ asset: 'btc', observedMs: nowMs - 900_000, volumeBase: 200, closePrice: 79100 })
  })

  it.each([
    ['a 500', () => new Response('nope', { status: 500, headers: { 'content-type': 'application/json' } })],
    ['an html page', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['a redirect', () => Object.assign(json(oiRows('BTCUSDT', 1)), { redirected: true })]
  ])('fails closed on %s', async (_name, respond) => {
    const client = createBinanceOpenInterestClient({ platformFetch: vi.fn(async () => respond()) })
    await expect(client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 1 })).resolves.toBeUndefined()
  })

  it('fails closed when the body exceeds the byte budget', async () => {
    const huge = 'x'.repeat(openInterestHistoryPolicy.maximumResponseBytes + 1)
    const client = createBinanceOpenInterestClient({ platformFetch: vi.fn(async () => new Response(huge, { status: 200, headers: { 'content-type': 'application/json' } })) })
    await expect(client.requestOpenInterest({ asset: 'btc', symbol: 'BTCUSDT', limit: 1 })).resolves.toBeUndefined()
  })

  it('fails closed when the transport throws', async () => {
    const client = createBinanceOpenInterestClient({ platformFetch: vi.fn(async () => { throw new Error('offline') }) })
    await expect(client.requestKlines({ asset: 'eth', symbol: 'ETHUSDT', limit: 2, nowMs })).resolves.toBeUndefined()
  })
})
