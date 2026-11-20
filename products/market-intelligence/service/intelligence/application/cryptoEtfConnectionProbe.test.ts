import { describe, expect, it } from 'vitest'

import { createCredentialedProviderProbes } from './credentialedProviderProbes'
import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'

/**
 * The settings page's test button is the only thing a reader can press for this source, so it has to
 * make a real request and tell the four groups apart. A probe that only checked "the key is not
 * empty" would go green on a wrong path, a wrong header or an answer in another shape — the failure
 * this round exists to prevent.
 */

const key = 'cetf_live_0123456789abcdef'

function responseOf(body: unknown, status = 200) {
  const calls = { textCalled: false }
  const response = {
    status,
    headers: new Headers(),
    text: async () => { calls.textCalled = true; return typeof body === 'string' ? body : JSON.stringify(body) }
  }
  return { response: response as unknown as Response, calls }
}

function fundsPayload(days: readonly unknown[]) {
  return {
    symbol: 'BTC',
    asset: 'bitcoin',
    windowDays: 30,
    days,
    updatedAt: '2026-11-12T20:14:24.534Z'
  }
}

const settledDay = { date: '2026-11-11', totalUsdM: -299.8, funds: [{ ticker: 'IBIT', issuer: 'BlackRock', netFlowUsdM: -299.8 }] }

function probeWith(fetchImpl: typeof fetch) {
  return createCredentialedProviderProbes({ platformFetch: fetchImpl }).get(cryptoEtfSourcePolicy.sourceId)
}

function respondingWith(response: Response, onRequest?: (url: string, init: RequestInit | undefined) => void) {
  return (async (url: string, init?: RequestInit) => {
    onRequest?.(String(url), init)
    return response
  }) as unknown as typeof fetch
}

describe('the CryptoETF credential probe', () => {
  it('is registered under the source id and calls the funds endpoint with a bearer key', async () => {
    const seen: { url: string; headers: unknown }[] = []
    const probe = probeWith(respondingWith(responseOf(fundsPayload([settledDay])).response, (url, init) => {
      seen.push({ url, headers: init?.headers })
    }))
    expect(probe).toBeDefined()

    await expect(probe!.probe(key)).resolves.toEqual({ state: 'succeeded' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe(`${cryptoEtfSourcePolicy.apiBaseUrl}/api/v1/flows/btc/funds`)
    expect(JSON.stringify(seen[0]!.headers)).toContain(key)
  })

  it('answers the four reader-facing groups with four different codes', async () => {
    await expect(probeWith(respondingWith(responseOf({ error: 'Unauthorized' }, 401).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'credential-invalid' })
    await expect(probeWith(respondingWith(responseOf({ error: 'Too many requests' }, 429).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'rate-limited' })
    await expect(probeWith(respondingWith(responseOf({ error: 'forbidden' }, 403).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'plan-restricted' })
    await expect(probeWith((async () => { throw new Error('getaddrinfo ENOTFOUND api.cryptoetf.today') }) as unknown as typeof fetch)!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
  })

  it('refuses an answer that is HTTP 200 but not the shape we read', async () => {
    // No settled day at all: the reader's answer is "structure changed", not "no data".
    await expect(probeWith(respondingWith(responseOf(fundsPayload([])).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
    // An envelope that parses as JSON but carries the wrong field types.
    await expect(probeWith(respondingWith(responseOf({ days: 'not-an-array' }).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
    // A settled day without the per-fund detail is not a settled day either.
    await expect(probeWith(respondingWith(responseOf(fundsPayload([{ date: '2026-11-11', totalUsdM: 1, funds: [] }])).response))!.probe(key))
      .resolves.toEqual({ state: 'failed', failureCode: 'response-shape-invalid' })
  })

  it('rejects a malformed draft without spending a request', async () => {
    let requested = 0
    const probe = probeWith(respondingWith(responseOf(fundsPayload([settledDay])).response, () => { requested += 1 }))
    expect(probe!.isValidCredentialShape('')).toBe(false)
    expect(probe!.isValidCredentialShape('key with\nnewline')).toBe(false)
    expect(probe!.isValidCredentialShape(key)).toBe(true)
    expect(requested).toBe(0)
  })
})
