import { describe, expect, it, vi } from 'vitest'

import { createDeribitOptionsClient } from './deribitOptionsClient'

const NOW_MS = Date.parse('2026-11-22T07:00:00.000Z')

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

const INSTRUMENTS = {
  jsonrpc: '2.0',
  result: [
    { instrument_name: 'BTC-19DEC26-90000-C', expiration_timestamp: 1_800_000_000_000, strike: 90000, option_type: 'call' },
    { instrument_name: 'BTC-19DEC26-80000-P', expiration_timestamp: 1_800_000_000_000, strike: 80000, option_type: 'put' }
  ]
}

const SUMMARIES = {
  jsonrpc: '2.0',
  result: [
    { instrument_name: 'BTC-19DEC26-90000-C', mark_iv: 51.7, bid_price: 0.01, ask_price: 0.02, open_interest: 12, underlying_price: 90000 },
    { instrument_name: 'BTC-19DEC26-80000-P', mark_iv: 58.4, bid_price: 0.01, ask_price: 0.03, open_interest: 7, underlying_price: 90000 }
  ]
}

/** Stubs answer by URL so the two requests cannot be confused (and the probe is countable). */
function stubFetch(responses: { instruments?: () => Response | Promise<Response>; summaries?: () => Response | Promise<Response>; index?: () => Response | Promise<Response> }) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url)
    if (url.includes('get_instruments')) return responses.instruments ? responses.instruments() : jsonResponse(INSTRUMENTS)
    if (url.includes('get_book_summary_by_currency')) return responses.summaries ? responses.summaries() : jsonResponse(SUMMARIES)
    if (url.includes('get_index_price')) return responses.index ? responses.index() : jsonResponse({ result: { index_price: 90123.4 } })
    return jsonResponse({}, 404)
  })
  return { fetchImpl, calls }
}

describe('deribit options client', () => {
  it('reads the chain from the two documented calls, mark_iv as a percentage', async () => {
    const { fetchImpl, calls } = stubFetch({})
    const client = createDeribitOptionsClient({ fetch: fetchImpl })
    const snapshot = await client.fetchChain(NOW_MS)
    expect(snapshot.state).toBe('available')
    if (snapshot.state !== 'available') return
    expect(snapshot.instruments).toHaveLength(2)
    expect(snapshot.quotes[1]?.markIv).toBe(58.4)
    expect(snapshot.observedAt).toBe(new Date(NOW_MS).toISOString())
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('/get_instruments?currency=BTC&kind=option&expired=false')
    expect(calls[1]).toContain('/get_book_summary_by_currency?currency=BTC&kind=option')
  })

  it('reports an HTTP failure as an upstream error', async () => {
    const { fetchImpl } = stubFetch({ instruments: () => jsonResponse({}, 503) })
    const snapshot = await createDeribitOptionsClient({ fetch: fetchImpl }).fetchChain(NOW_MS)
    expect(snapshot).toEqual({ state: 'unavailable', failureCode: 'upstream-http-error' })
  })

  it('reports a refused connection (dead proxy, DNS, timeout) as connection-unavailable', async () => {
    const { fetchImpl } = stubFetch({ instruments: () => Promise.reject(new Error('ECONNREFUSED')) })
    const snapshot = await createDeribitOptionsClient({ fetch: fetchImpl }).fetchChain(NOW_MS)
    expect(snapshot).toEqual({ state: 'unavailable', failureCode: 'connection-unavailable' })
  })

  it('reports a body that is not JSON as a shape failure', async () => {
    const { fetchImpl } = stubFetch({ instruments: () => new Response('<html>', { status: 200 }) })
    const snapshot = await createDeribitOptionsClient({ fetch: fetchImpl }).fetchChain(NOW_MS)
    expect(snapshot).toEqual({ state: 'unavailable', failureCode: 'upstream-shape-invalid' })
  })

  it('reports an empty result array as a shape failure, not as an empty day', async () => {
    const { fetchImpl } = stubFetch({ instruments: () => jsonResponse({ result: [] }) })
    const snapshot = await createDeribitOptionsClient({ fetch: fetchImpl }).fetchChain(NOW_MS)
    expect(snapshot).toEqual({ state: 'unavailable', failureCode: 'upstream-shape-invalid' })
  })

  it('probes with one index-price call only', async () => {
    const { fetchImpl, calls } = stubFetch({})
    const result = await createDeribitOptionsClient({ fetch: fetchImpl }).probe()
    expect(result).toEqual({ state: 'available' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/get_index_price?index_name=btc_usd')
  })

  it('treats a probe with no index price as a shape failure', async () => {
    const { fetchImpl } = stubFetch({ index: () => jsonResponse({ result: {} }) })
    const result = await createDeribitOptionsClient({ fetch: fetchImpl }).probe()
    expect(result).toEqual({ state: 'unavailable', failureCode: 'upstream-shape-invalid' })
  })
})