import { describe, expect, it, vi } from 'vitest'

import { capitalConditionsTransportPolicy, createCapitalConditionsHttpClient } from '../capital-conditions/capitalConditionsHttpClient'
import { createStablecoinHistoryAsOf, stablecoinHistoryAsOfPolicy } from './stablecoinHistoryAsOf'

const asOf = '2026-10-30T00:00:00.000Z'

function historyPayload(rows: readonly { date: string; supply: number }[]): string {
  return JSON.stringify(rows.map((row) => ({
    date: row.date,
    totalCirculating: { peggedUSD: row.supply },
    totalCirculatingUSD: { peggedUSD: row.supply }
  })))
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

describe('stablecoin history as of an instant', () => {
  it('takes the newest DefiLlama point at or before the instant, through the proxy-aware client', async () => {
    const platformFetch = vi.fn(async () => jsonResponse(historyPayload([
      { date: String(Date.parse('2026-10-27T00:00:00.000Z') / 1_000), supply: 305_000_000_000 },
      { date: String(Date.parse('2026-10-29T00:00:00.000Z') / 1_000), supply: 310_808_397_120 },
      { date: String(Date.parse('2026-10-30T00:00:00.000Z') / 1_000), supply: 311_000_000_000 }
    ])))
    const reader = createStablecoinHistoryAsOf({
      requestHistory: createCapitalConditionsHttpClient({ platformFetch }).requestStablecoinHistoryPayload,
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })

    await expect(reader.read({ asOf })).resolves.toEqual({
      state: 'available',
      asOf,
      value: 310_808_397_120,
      observedAt: '2026-10-29T00:00:00.000Z',
      sourceUrl: 'https://stablecoins.llama.fi/stablecoincharts/all',
      method: 'historical-api'
    })
    // The transport is the platform fetch the refresh already uses, never a bare fetch.
    expect(platformFetch).toHaveBeenCalledWith(
      capitalConditionsTransportPolicy.stablecoinHistoryEndpoint,
      capitalConditionsTransportPolicy.requestInit
    )
    expect(platformFetch).toHaveBeenCalledTimes(1)
  })

  it('does not touch the network for a future or unreadable instant', async () => {
    const platformFetch = vi.fn(async () => jsonResponse('[]'))
    const reader = createStablecoinHistoryAsOf({
      requestHistory: createCapitalConditionsHttpClient({ platformFetch }).requestStablecoinHistoryPayload,
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })

    await expect(reader.read({ asOf: '2026-10-30T04:48:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    await expect(reader.read({ asOf: '2026-10-30' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'invalid-as-of' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('names the gap when the public series holds no point at or before the instant', async () => {
    const platformFetch = vi.fn(async () => jsonResponse(historyPayload([
      { date: String(Date.parse('2026-10-30T00:00:00.000Z') / 1_000), supply: 311_000_000_000 }
    ])))
    const reader = createStablecoinHistoryAsOf({
      requestHistory: createCapitalConditionsHttpClient({ platformFetch }).requestStablecoinHistoryPayload,
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })

    const result = await reader.read({ asOf: '2026-10-29T12:00:00.000Z' })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('admits an empty public series as a gap, never as zero supply', async () => {
    const reader = createStablecoinHistoryAsOf({
      requestHistory: async () => Object.freeze({ state: 'available' as const, payload: [], acceptedBytes: 2 }),
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })
    const empty = await reader.read({ asOf })
    expect(empty).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in empty).toBe(false)

    const notTheSeries = createStablecoinHistoryAsOf({
      requestHistory: async () => Object.freeze({ state: 'available' as const, payload: { rows: [] }, acceptedBytes: 14 }),
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })
    await expect(notTheSeries.read({ asOf })).resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
  })

  it('keeps the gap when the request is refused or the payload is malformed', async () => {
    const refused = createStablecoinHistoryAsOf({
      requestHistory: async () => Object.freeze({ state: 'unavailable' as const, reason: 'response-unavailable' as const }),
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })
    const refusedResult = await refused.read({ asOf })
    expect(refusedResult).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect('value' in refusedResult).toBe(false)

    const malformed = createStablecoinHistoryAsOf({
      requestHistory: async () => Object.freeze({ state: 'available' as const, payload: [{ date: 'later', totalCirculatingUSD: { peggedUSD: 1 } }], acceptedBytes: 40 }),
      now: () => Date.parse('2026-10-30T04:48:00.000Z')
    })
    await expect(malformed.read({ asOf })).resolves.toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
  })

  it('answers historical-api-unavailable when no history client is wired', async () => {
    const reader = createStablecoinHistoryAsOf({ now: () => Date.parse('2026-10-30T04:48:00.000Z') })
    const result = await reader.read({ asOf })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('keeps the series and the read path named in one place', () => {
    expect(stablecoinHistoryAsOfPolicy.sourceUrl).toBe('https://stablecoins.llama.fi/stablecoincharts/all')
    expect(stablecoinHistoryAsOfPolicy.method).toBe('historical-api')
  })
})
