import { describe, expect, it, vi } from 'vitest'

import { capitalConditionsTransportPolicy, createCapitalConditionsHttpClient } from './capitalConditionsHttpClient'

describe('capital conditions HTTP client', () => {
  it('rejects an over-cap declared length before consuming the body', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"peggedAssets":[]}'))
      },
      cancel
    })
    const platformFetch = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(capitalConditionsTransportPolicy.maximumResponseBytes + 1)
      }
    }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    await expect(client.requestStablecoinPayload()).resolves.toEqual({ state: 'unavailable', reason: 'response-body-too-large' })
    expect(cancel).toHaveBeenCalled()
  })

  it('accepts an under-cap response with no declared length', async () => {
    const platformFetch = vi.fn(async () => new Response(JSON.stringify({ peggedAssets: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    await expect(client.requestStablecoinPayload()).resolves.toMatchObject({
      state: 'available',
      payload: { peggedAssets: [] }
    })
    expect(platformFetch).toHaveBeenCalledWith(
      capitalConditionsTransportPolicy.stablecoinEndpoint,
      capitalConditionsTransportPolicy.requestInit
    )
  })

  it('requests the official stablecoin history endpoint through the same bounded client', async () => {
    const platformFetch = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createCapitalConditionsHttpClient({ platformFetch })
    await expect(client.requestStablecoinHistoryPayload()).resolves.toMatchObject({ state: 'available', payload: [] })
    expect(platformFetch).toHaveBeenCalledWith(capitalConditionsTransportPolicy.stablecoinHistoryEndpoint, capitalConditionsTransportPolicy.requestInit)
  })

  it('uses the history-only byte budget for the larger official history response', async () => {
    const payload = JSON.stringify([]) + ' '.repeat(1_600_000)
    const platformFetch = vi.fn(async () => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    await expect(client.requestStablecoinHistoryPayload()).resolves.toMatchObject({ state: 'available' })
  })

  it('rejects a history response above its named history-only budget', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(capitalConditionsTransportPolicy.stablecoinHistoryMaximumResponseBytes + 1))
      },
      cancel
    })
    const platformFetch = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    await expect(client.requestStablecoinHistoryPayload()).resolves.toEqual({ state: 'unavailable', reason: 'response-body-too-large' })
    expect(cancel).toHaveBeenCalled()
  })

  it('fails closed for redirects, non-2xx, non-JSON and malformed JSON', async () => {
    const responses = [
      new Response('{}', { status: 302, headers: { 'content-type': 'application/json' } }),
      new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
      new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }),
      new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })
    ]
    const platformFetch = vi.fn(async () => responses.shift()!)
    const client = createCapitalConditionsHttpClient({ platformFetch })

    for (const _response of [0, 1, 2, 3]) {
      await expect(client.requestStablecoinPayload()).resolves.toEqual({ state: 'unavailable', reason: 'response-unavailable' })
    }
  })

  it('cancels a missing-length streamed DeFiLlama response that exceeds the one MiB cap', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(capitalConditionsTransportPolicy.maximumResponseBytes + 1))
      },
      cancel
    })
    const platformFetch = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    await expect(client.requestStablecoinPayload()).resolves.toEqual({ state: 'unavailable', reason: 'response-body-too-large' })
    expect(cancel).toHaveBeenCalled()
  })

  it('accepts a near-cap JSON response without exceeding the named response budget', async () => {
    const core = { id: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 1 }, circulatingPrevWeek: { peggedUSD: 1 }, circulatingPrevMonth: { peggedUSD: 1 } }
    const payload = JSON.stringify({ peggedAssets: [core], padding: 'x'.repeat(capitalConditionsTransportPolicy.maximumResponseBytes - 1_000) })
    const platformFetch = vi.fn(async () => new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const client = createCapitalConditionsHttpClient({ platformFetch })

    const result = await client.requestStablecoinPayload()

    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(capitalConditionsTransportPolicy.maximumResponseBytes)
    expect(result).toMatchObject({ state: 'available', acceptedBytes: Buffer.byteLength(payload, 'utf8') })
  })
})
