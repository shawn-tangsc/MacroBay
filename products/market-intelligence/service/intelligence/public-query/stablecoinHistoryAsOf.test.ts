import { describe, expect, it, vi } from 'vitest'

import {
  capitalConditionsTransportPolicy,
  createCapitalConditionsHttpClient
} from '../capital-conditions/capitalConditionsHttpClient'
import {
  createStablecoinHistoryAsOf,
  stablecoinHistoryAsOfPolicy
} from './stablecoinHistoryAsOf'

/** 08:00 Asia/Shanghai on 30 Oct 2026. */
const cutoff = '2026-10-30T00:00:00.000Z'
const later = '2026-10-30T04:48:00.000Z'

type Row = Readonly<{ date: string; supply: number }>

function assetPayload(assetId: '1' | '2', symbol: 'USDT' | 'USDC', rows: readonly Row[]): string {
  return JSON.stringify({
    id: assetId,
    symbol,
    pegType: 'peggedUSD',
    pegMechanism: 'fiat-backed',
    chainBalances: { Ethereum: { tokens: rows } },
    tokens: rows.map((row) => ({
      date: Date.parse(`${row.date}T00:00:00.000Z`) / 1_000,
      circulating: { peggedUSD: row.supply }
    }))
  })
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

const USDT_ROWS: readonly Row[] = [
  { date: '2026-10-27', supply: 100_000_000_000 },
  { date: '2026-10-29', supply: 180_000_000_000 },
  // The cutoff's own day is still moving and must never be admitted.
  { date: '2026-10-30', supply: 181_000_000_000 }
]
const USDC_ROWS: readonly Row[] = [
  { date: '2026-10-27', supply: 60_000_000_000 },
  { date: '2026-10-29', supply: 71_995_000_000 },
  { date: '2026-10-30', supply: 72_500_000_000 }
]

/** A platform fetch that serves each asset its own payload, keyed by the real endpoint. */
function platformFetchFor(
  usdt: string | Response = assetPayload('1', 'USDT', USDT_ROWS),
  usdc: string | Response = assetPayload('2', 'USDC', USDC_ROWS)
) {
  return vi.fn(async (endpoint: string) => {
    const answer = endpoint.endsWith('/1') ? usdt : usdc
    return answer instanceof Response ? answer : jsonResponse(answer)
  })
}

function readerWith(platformFetch: ReturnType<typeof vi.fn>) {
  return createStablecoinHistoryAsOf({
    requestAssetHistory: createCapitalConditionsHttpClient({ platformFetch: platformFetch as never })
      .requestStablecoinAssetHistoryPayload,
    now: () => Date.parse(later)
  })
}

describe('core stablecoin history as of an instant', () => {
  it('sums both per-asset histories, through the bounded proxy-aware client, and reports each endpoint', async () => {
    const platformFetch = platformFetchFor()
    const reader = readerWith(platformFetch)

    const result = await reader.read({ asOf: cutoff })

    expect(result).toMatchObject({
      state: 'available',
      asOf: cutoff,
      value: 251_995_000_000,
      observedAt: '2026-10-30T00:00:00.000Z',
      sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1',
      method: 'historical-api'
    })
    expect(result.state === 'available' ? result.components : []).toEqual([
      {
        assetId: '1', symbol: 'USDT', value: 180_000_000_000, tradingDate: '2026-10-29',
        observedAt: '2026-10-30T00:00:00.000Z', sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1'
      },
      {
        assetId: '2', symbol: 'USDC', value: 71_995_000_000, tradingDate: '2026-10-29',
        observedAt: '2026-10-30T00:00:00.000Z', sourceUrl: 'https://stablecoins.llama.fi/stablecoin/2'
      }
    ])

    // Both requests go through the existing capital client: the injected platform fetch (the one
    // that honours proxy settings in production), never a bare fetch.
    expect(platformFetch).toHaveBeenNthCalledWith(
      1,
      'https://stablecoins.llama.fi/stablecoin/1',
      capitalConditionsTransportPolicy.requestInit
    )
    expect(platformFetch).toHaveBeenNthCalledWith(
      2,
      'https://stablecoins.llama.fi/stablecoin/2',
      capitalConditionsTransportPolicy.requestInit
    )
  })

  it('uses the completed day before the instant, not the still-moving row for the cutoff day', async () => {
    const reader = readerWith(platformFetchFor())
    // 22:00Z on the 29th: neither the 29th nor the 30th has ended, so both assets answer the 27th.
    const result = await reader.read({ asOf: '2026-10-29T22:00:00.000Z' })
    expect(result).toMatchObject({
      state: 'available',
      value: 160_000_000_000,
      observedAt: '2026-10-28T00:00:00.000Z'
    })
  })

  it('returns no value at all when one asset is missing', async () => {
    const reader = readerWith(platformFetchFor(
      assetPayload('1', 'USDT', USDT_ROWS),
      jsonResponse('', 503)
    ))
    const result = await reader.read({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in result).toBe(false)
    expect(result.state === 'unavailable' ? result.detail : '').toMatch(/USDC/)
  })

  it('returns no value when one asset has no completed point', async () => {
    const reader = readerWith(platformFetchFor(
      assetPayload('1', 'USDT', USDT_ROWS),
      assetPayload('2', 'USDC', [{ date: '2026-10-30', supply: 72_500_000_000 }])
    ))
    const result = await reader.read({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in result).toBe(false)
    expect(result.state === 'unavailable' ? result.detail : '').toMatch(/USDC/)
  })

  it('never fills a missing asset with zero or with the other asset alone', async () => {
    const reader = readerWith(platformFetchFor(
      assetPayload('1', 'USDT', USDT_ROWS),
      assetPayload('2', 'USDC', [])
    ))
    const result = await reader.read({ asOf: cutoff })
    expect(result.state).toBe('unavailable')
    expect('value' in result).toBe(false)
  })

  it('does not touch the network for a future or unreadable instant', async () => {
    const platformFetch = platformFetchFor()
    const reader = readerWith(platformFetch)

    await expect(reader.read({ asOf: '2026-10-30T04:48:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    await expect(reader.read({ asOf: '2026-10-30' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'invalid-as-of' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('answers historical-api-unavailable when the source is off or no interface is wired', async () => {
    const off = createStablecoinHistoryAsOf({
      requestAssetHistory: async () => Object.freeze({ state: 'not-configured' as const }),
      now: () => Date.parse(later)
    })
    const offResult = await off.read({ asOf: cutoff })
    expect(offResult).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in offResult).toBe(false)

    const unwired = createStablecoinHistoryAsOf({ now: () => Date.parse(later) })
    await expect(unwired.read({ asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
  })

  it('rejects a payload that identifies a different asset', async () => {
    const reader = readerWith(platformFetchFor(
      assetPayload('1', 'USDT', USDT_ROWS),
      assetPayload('1', 'USDT', USDT_ROWS)
    ))
    const result = await reader.read({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('rejects an over-cap per-asset response instead of loading it without a limit', async () => {
    const cancel = vi.fn()
    const oversized = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(capitalConditionsTransportPolicy.stablecoinAssetHistoryMaximumResponseBytes + 1)
      }
    })
    const reader = readerWith(platformFetchFor(assetPayload('1', 'USDT', USDT_ROWS), oversized))
    const result = await reader.read({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect(capitalConditionsTransportPolicy.stablecoinAssetHistoryMaximumResponseBytes)
      .toBeGreaterThan(23_468_256)
  })

  it('caches each successful per-asset series and retries a failed one', async () => {
    let usdcAttempts = 0
    const platformFetch = vi.fn(async (endpoint: string) => {
      if (endpoint.endsWith('/1')) return jsonResponse(assetPayload('1', 'USDT', USDT_ROWS))
      usdcAttempts += 1
      return usdcAttempts === 1
        ? jsonResponse('', 503)
        : jsonResponse(assetPayload('2', 'USDC', USDC_ROWS))
    })
    const reader = readerWith(platformFetch)

    // First read: USDT succeeds and is kept, USDC is refused.
    await expect(reader.read({ asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    // Second read: USDT is not downloaded again; the failed USDC request is retried.
    const result = await reader.read({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'available', value: 251_995_000_000 })
    expect(platformFetch).toHaveBeenCalledTimes(3)

    // A third read at another instant reuses both cached series.
    await reader.read({ asOf: '2026-10-29T22:00:00.000Z' })
    expect(platformFetch).toHaveBeenCalledTimes(3)
  })

  it('names both real endpoints and the read path in one place', () => {
    expect(stablecoinHistoryAsOfPolicy.assets.map((asset) => asset.sourceUrl)).toEqual([
      'https://stablecoins.llama.fi/stablecoin/1',
      'https://stablecoins.llama.fi/stablecoin/2'
    ])
    expect(stablecoinHistoryAsOfPolicy.assets.map((asset) => asset.symbol)).toEqual(['USDT', 'USDC'])
    expect(stablecoinHistoryAsOfPolicy.method).toBe('historical-api')
    expect(stablecoinHistoryAsOfPolicy.sourceUrl.startsWith('https://stablecoins.llama.fi/stablecoin/')).toBe(true)
  })
})
