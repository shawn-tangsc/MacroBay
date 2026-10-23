import { describe, expect, it, vi } from 'vitest'
import { realMarketApiPolicy } from '../macro-market/realMarketApiPolicy'
import { realMarketApiPriceResponse } from '../macro-market/realMarketApiResponseFixtures'
import {
  isSafeRealMarketApiKey, probeRealMarketApiConnection, realMarketApiConnectionProbePolicy, realMarketApiProbeUrl
} from './realMarketApiConnectionProbe'

const key = 'ab12'.repeat(16)

/** A response that remembers whether its body was ever read. */
function responseOf(body: unknown, status = 200, contentLength?: string) {
  const state = { textCalled: false }
  const response = {
    state, status,
    headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? (contentLength ?? null) : null },
    text: async () => { state.textCalled = true; return typeof body === 'string' ? body : JSON.stringify(body) }
  }
  return { response: response as unknown as Response, state }
}

const probe = (response: Response) => probeRealMarketApiConnection(key, { platformFetch: (async () => response) as unknown as typeof fetch })

/** Nothing this probe does — succeed or fail — may put the key where anyone can read it. */
async function capturedWhile(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = []
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(level => vi.spyOn(console, level)
    .mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')) }))
  try { await run() } finally { for (const spy of spies) spy.mockRestore() }
  return lines.join('\n')
}

describe('the real dollar index credential probe', () => {
  it('refuses a key of the wrong shape before any request', () => {
    expect(isSafeRealMarketApiKey(key)).toBe(true)
    for (const draft of [
      key.slice(0, 20),                    // too short to be anything
      key + 'a'.repeat(40),                // far too long
      '_'.repeat(48),                      // punctuation is never part of a key
      'ab12'.repeat(12) + '-b12',          // a dash in the middle
      `ab12${' '.repeat(44)}`,             // whitespace
      '', 'ab12'
    ]) {
      expect(isSafeRealMarketApiKey(draft)).toBe(false)
    }
    // The provider issues forty-eight alphanumeric characters. An earlier rule asserted exactly
    // sixty-four and refused the reader's valid key without sending a single request; the shape check
    // is a pre-filter that spares a request, not a claim about the length the provider issues.
    expect(isSafeRealMarketApiKey('kRHg'.repeat(12))).toBe(true)
    expect(isSafeRealMarketApiKey('AB12'.repeat(16))).toBe(true)
  })

  it('verifies the key against the provider\'s own price endpoint, instrument by instrument', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      const gold = new URL(String(url)).searchParams.get('symbolCode') === 'XAUUSD'
      return responseOf({ ...realMarketApiPriceResponse, ...(gold ? { symbolCode: 'XAUUSD', closePrice: 4180.5 } : {}) }).response
    }) as unknown as typeof fetch
    await expect(probeRealMarketApiConnection(key, { platformFetch: fetchImpl })).resolves.toEqual({ state: 'succeeded' })
    // Every instrument the collector reads is asked, so a key that only answers the dollar cannot pass.
    expect(urls.map(url => new URL(url).searchParams.get('symbolCode'))).toEqual(['DXY', 'XAUUSD'])
    const url = new URL(realMarketApiProbeUrl(key))
    expect(url.origin + url.pathname).toBe('https://api.realmarketapi.com/api/v1/price')
    expect(url.searchParams.get('symbolCode')).toBe('DXY')
    expect(url.searchParams.get('timeFrame')).toBe('H1')
    expect(url.searchParams.get('apiKey')).toBe(key)
  })

  it('refuses the key when a second instrument it collects is not on the plan', async () => {
    // A key that works for the dollar and not for gold is not a working source: the tick would fill one
    // series and quietly never fill the other, so the refusal is what the reader is shown.
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      return new URL(String(url)).searchParams.get('symbolCode') === 'XAUUSD'
        ? responseOf({ message: 'symbol not included in plan' }, 403).response
        : responseOf(realMarketApiPriceResponse).response
    }) as unknown as typeof fetch
    await expect(probeRealMarketApiConnection(key, { platformFetch: fetchImpl })).resolves.toEqual({ state: 'failed', failureCode: 'plan-restricted' })
    expect(urls.map(url => new URL(url).searchParams.get('symbolCode'))).toEqual(['DXY', 'XAUUSD'])
  })

  it.each([
    ['a rejected key', 401, { message: 'unauthorized' }, 'credential-invalid'],
    ['a plan restriction', 403, { message: 'plan does not include DXY' }, 'plan-restricted'],
    ['a rate limit', 429, { message: 'too many requests' }, 'rate-limited'],
    // The 400 is only the credential's fault when the provider says so, exactly as FRED's own 400 is read.
    ['a 400 that names the key', 400, { message: 'invalid apiKey' }, 'credential-invalid'],
    ['a 400 that does not', 400, { message: 'symbolCode is required' }, 'response-unavailable'],
    ['an unrecognized provider error', 500, { message: 'provider failure' }, 'response-unavailable'],
    ['a 200 without a price', 200, { symbolCode: 'DXY' }, 'response-unavailable'],
    ['a 200 for another symbol', 200, { symbolCode: 'EURUSD', closePrice: 1.08 }, 'response-unavailable'],
    ['a 200 with a string price', 200, { symbolCode: 'DXY', closePrice: '102.237' }, 'response-unavailable']
  ])('reports %s as %s', async (_name, status, body, failureCode) => {
    const { response } = responseOf(body, status)
    await expect(probe(response)).resolves.toEqual({ state: 'failed', failureCode })
  })

  it('bounds the answer with its own budget and reads no body it has already refused', async () => {
    // The probe's ceiling is its own constant, deliberately not the collector's megabyte.
    expect(realMarketApiConnectionProbePolicy.maxBodyBytes).toBeLessThan(realMarketApiPolicy.maxBodyBytes)
    const advertised = responseOf(realMarketApiPriceResponse, 200, String(realMarketApiConnectionProbePolicy.maxBodyBytes + 1))
    await expect(probe(advertised.response)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(advertised.state.textCalled).toBe(false)

    const oversized = responseOf('x'.repeat(realMarketApiConnectionProbePolicy.maxBodyBytes + 1))
    await expect(probe(oversized.response)).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(oversized.state.textCalled).toBe(true)
  })

  it('never claims a verification it did not observe', async () => {
    const broken = { status: 200, headers: { get: () => null }, text: async () => { throw new Error('socket closed') } } as unknown as Response
    await expect(probe(broken)).resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
    // The transport error may quote the URL the key travelled in; it is discarded, never surfaced.
    const offline = (async () => { throw new Error(`getaddrinfo ENOTFOUND ${realMarketApiProbeUrl(key)}`) }) as unknown as typeof fetch
    await expect(probeRealMarketApiConnection(key, { platformFetch: offline })).resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
  })

  it('leaves no trace of the key in anything it logs', async () => {
    const fragment = key.slice(0, 12)
    const logged = await capturedWhile(async () => {
      for (const [status, body] of [[401, { message: 'unauthorized' }], [400, { message: 'invalid apiKey' }], [200, { symbolCode: 'DXY' }]] as const) {
        await probe(responseOf(body, status).response)
      }
      await probeRealMarketApiConnection(key, { platformFetch: (async () => { throw new Error(realMarketApiProbeUrl(key)) }) as unknown as typeof fetch })
    })
    expect(logged).not.toContain(fragment)
    expect(logged).toBe('')
  })
})
