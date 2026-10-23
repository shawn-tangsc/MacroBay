import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { getFixedLocalDevelopmentBlsApiRequestIdentityCapability } from './blsApiRequestIdentity'

import {
  blsApiCompatibilityDescriptorPolicy,
  type BlsApiCompatibilityFetch,
  createBlsApiCompatibilityProbe,
  recognizeBlsApiCompatibilityEnvelope
} from './blsApiCompatibilityProbe'

function compatibleBody(): string {
  return JSON.stringify({
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '73' }] },
        { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M07', value: '4.2' }] }
      ]
    }
  })
}

function response(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(Buffer.byteLength(body, 'utf8')) },
    ...init
  })
}

function probe(fetch: ReturnType<typeof vi.fn>) {
  return createBlsApiCompatibilityProbe({ fetch: fetch as BlsApiCompatibilityFetch, identity: getFixedLocalDevelopmentBlsApiRequestIdentityCapability() })
}

describe('BLS API compatibility probe', () => {
  it('returns indeterminate without production identity and never calls fetch', async () => {
    const fetch = vi.fn()

    const result = await createBlsApiCompatibilityProbe({ fetch }).probe()

    expect(result).toEqual({ state: 'indeterminate' })
    expect(fetch).not.toHaveBeenCalled()
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('rejects a missing fetch dependency and a forged opaque capability before transport', async () => {
    const fetch = vi.fn()
    const missingDependency = await createBlsApiCompatibilityProbe({}).probe()
    const forgedCapability = await createBlsApiCompatibilityProbe({ fetch, identity: Object.freeze({}) as never }).probe()

    expect(missingDependency).toEqual({ state: 'indeterminate' })
    expect(forgedCapability).toEqual({ state: 'indeterminate' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('turns a hostile dependency container into the safe no-fetch state', async () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('private dependency getter') } })

    const subject = createBlsApiCompatibilityProbe(hostile as never)

    await expect(subject.probe()).resolves.toEqual({ state: 'indeterminate' })
  })

  it('uses the exact fixed one-shot compatibility envelope and returns frozen safe observations', async () => {
    const fetch = vi.fn().mockResolvedValue(response(compatibleBody()))

    const result = await probe(fetch).probe()

    expect(blsApiCompatibilityDescriptorPolicy).toMatchObject({
      attempts: 1,
      authentication: 'none',
      deadlineMs: 15_000,
      responseMaximumBytes: 1_500_000
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(blsApiCompatibilityDescriptorPolicy.endpoint, expect.objectContaining({
      method: 'POST',
      body: '{"seriesid":["CES0000000001","LNS14000000"],"startyear":"2026","endyear":"2026"}',
      redirect: 'error'
    }))
    const init = fetch.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(init.headers).get('User-Agent')).toBe('BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)')
    expect(result).toEqual({
      state: 'api-compatible',
      observations: [
        { seriesId: 'CES0000000001', period: '2026-M07', value: '73' },
        { seriesId: 'LNS14000000', period: '2026-M07', value: '4.2' }
      ]
    })
    expect(Object.isFrozen(result)).toBe(true)
    if (result.state === 'api-compatible') {
      expect(Object.isFrozen(result.observations)).toBe(true)
      expect(Object.isFrozen(result.observations[0])).toBe(true)
      expect(JSON.stringify(result)).not.toMatch(/content-length|status|header|user-agent|support@|error|api\.bls\.gov/i)
    }
  })

  it.each([
    ['non-2xx', new Response('', { status: 403 }), 'access-denied-or-unavailable'],
    ['malformed JSON', response('{'), 'invalid-response'],
    ['missing requested series', response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [] } })), 'invalid-response'],
    ['duplicate requested series', response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '1' }] },
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '2' }] }
    ] } })), 'invalid-response'],
    ['foreign series extension', response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '1' }] },
      { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M07', value: '2' }] },
      { seriesID: 'FOREIGN', data: [{ year: '2026', period: 'M07', value: '3' }] }
    ] } })), 'invalid-response'],
    ['duplicate M07', response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '1' }, { year: '2026', period: 'M07', value: '1' }] },
      { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M07', value: '2' }] }
    ] } })), 'invalid-response'],
    ['noncanonical decimal', response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [
      { seriesID: 'CES0000000001', data: [{ year: '2026', period: 'M07', value: '+1' }] },
      { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M07', value: '2' }] }
    ] } })), 'invalid-response']
  ])('returns only the safe %s classification', async (_label, httpResponse, state) => {
    const fetch = vi.fn().mockResolvedValue(httpResponse)

    const result = await probe(fetch).probe()

    expect(result).toEqual({ state })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('rejects absent, malformed, declared, and observed oversized bodies without retrying', async () => {
    const absent = vi.fn().mockResolvedValue(new Response(compatibleBody(), { status: 200 }))
    const malformed = vi.fn().mockResolvedValue(new Response(compatibleBody(), { status: 200, headers: { 'content-length': '1.5' } }))
    const declared = vi.fn().mockResolvedValue(new Response('', {
      status: 200,
      headers: { 'content-length': String(blsApiCompatibilityDescriptorPolicy.responseMaximumBytes + 1) }
    }))
    const observedBody = compatibleBody().padEnd(blsApiCompatibilityDescriptorPolicy.responseMaximumBytes + 1, ' ')
    const observed = vi.fn().mockResolvedValue(new Response(observedBody, { status: 200 }))

    await expect(probe(absent).probe()).resolves.toEqual({ state: 'indeterminate' })
    await expect(probe(malformed).probe()).resolves.toEqual({ state: 'indeterminate' })
    await expect(probe(declared).probe()).resolves.toEqual({ state: 'indeterminate' })
    await expect(probe(observed).probe()).resolves.toEqual({ state: 'indeterminate' })
    expect(absent).toHaveBeenCalledTimes(1)
    expect(malformed).toHaveBeenCalledTimes(1)
    expect(declared).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledTimes(1)
  })

  it('cancels an observed oversized response stream and keeps its raw body out of the result', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(blsApiCompatibilityDescriptorPolicy.responseMaximumBytes + 1))
      },
      cancel() { cancelled = true }
    })
    const fetch = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-length': '1' }
    }))

    const result = await probe(fetch).probe()

    expect(result).toEqual({ state: 'indeterminate' })
    expect(cancelled).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/raw|body|content|private/i)
  })

  it('cancels a declared oversized response stream before reading any content', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('private response body'))
      },
      cancel() { cancelled = true }
    })
    const fetch = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-length': String(blsApiCompatibilityDescriptorPolicy.responseMaximumBytes + 1) }
    }))

    await expect(probe(fetch).probe()).resolves.toEqual({ state: 'indeterminate' })
    expect(cancelled).toBe(true)
  })

  it('cancels a non-2xx response stream before returning the safe unavailable state', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('private denied response'))
      },
      cancel() { cancelled = true }
    })
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 403 }))

    await expect(probe(fetch).probe()).resolves.toEqual({ state: 'access-denied-or-unavailable' })
    expect(cancelled).toBe(true)
  })

  it('maps a body-stream failure to indeterminate without retrying', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('private stream failure')) }
    })
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))

    await expect(probe(fetch).probe()).resolves.toEqual({ state: 'indeterminate' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps throw, rejection, and deadline abort to indeterminate without exposing diagnostics', async () => {
    const throws = vi.fn().mockImplementation(() => { throw new Error('private transport failure') })
    const rejects = vi.fn().mockRejectedValue(new Error('private transport rejection'))
    const aborts = vi.fn((_: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('private abort')), { once: true })
    }))

    await expect(probe(throws).probe()).resolves.toEqual({ state: 'indeterminate' })
    await expect(probe(rejects).probe()).resolves.toEqual({ state: 'indeterminate' })
    vi.useFakeTimers()
    try {
      // This uses fake time only to verify the named probe deadline, not to wait for a condition.
      const pending = probe(aborts).probe()
      await vi.advanceTimersByTimeAsync(blsApiCompatibilityDescriptorPolicy.deadlineMs)
      await expect(pending).resolves.toEqual({ state: 'indeterminate' })
    } finally {
      vi.useRealTimers()
    }
    expect(JSON.stringify(await probe(throws).probe())).not.toMatch(/private|error|transport/i)
  })

  it('returns at the named deadline when a fake fetch ignores abort and never settles', async () => {
    const ignoresAbort = vi.fn(() => new Promise<Response>(() => {}))
    const subject = probe(ignoresAbort)

    vi.useFakeTimers()
    try {
      const pending = subject.probe()
      await vi.advanceTimersByTimeAsync(blsApiCompatibilityDescriptorPolicy.deadlineMs)
      await expect(pending).resolves.toEqual({ state: 'indeterminate' })
      await expect(subject.probe()).resolves.toEqual({ state: 'indeterminate' })
      expect(ignoresAbort).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not accept a late response or start a concurrent replacement after the named deadline', async () => {
    let resolve: ((value: Response) => void) | undefined
    const ignoresAbort = vi.fn(() => new Promise<Response>((next) => { resolve = next }))
    const subject = probe(ignoresAbort)

    vi.useFakeTimers()
    try {
      const pending = subject.probe()
      await vi.advanceTimersByTimeAsync(blsApiCompatibilityDescriptorPolicy.deadlineMs)
      await expect(pending).resolves.toEqual({ state: 'indeterminate' })
      await expect(subject.probe()).resolves.toEqual({ state: 'indeterminate' })
      expect(ignoresAbort).toHaveBeenCalledTimes(1)
      resolve!(response(compatibleBody()))
      await Promise.resolve()
      await Promise.resolve()
      expect(ignoresAbort).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fences a concurrent second call before a second fetch', async () => {
    let resolve: ((value: Response) => void) | undefined
    const fetch = vi.fn(() => new Promise<Response>((next) => { resolve = next }))
    const subject = probe(fetch)

    const first = subject.probe()
    await Promise.resolve()
    const second = subject.probe()

    await expect(second).resolves.toEqual({ state: 'indeterminate' })
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve!(response(compatibleBody()))
    await expect(first).resolves.toMatchObject({ state: 'api-compatible' })
  })

  it('rejects accessor, cyclic, symbol, and hostile Proxy input in the pure recognizer', () => {
    const accessor: Record<string, unknown> = { status: 'REQUEST_SUCCEEDED', Results: { series: [] } }
    Object.defineProperty(accessor, 'status', { enumerable: true, get: () => 'REQUEST_SUCCEEDED' })
    const cyclic: Record<string, unknown> = { status: 'REQUEST_SUCCEEDED', Results: { series: [] } }
    cyclic.self = cyclic
    const symbol = { status: 'REQUEST_SUCCEEDED', Results: { series: [] }, [Symbol('private')]: true }
    const nonEnumerable = { status: 'REQUEST_SUCCEEDED', Results: { series: [] } }
    Object.defineProperty(nonEnumerable, 'private', { value: true })
    const hostile = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('private proxy failure') } })

    expect(recognizeBlsApiCompatibilityEnvelope(accessor)).toBeUndefined()
    expect(recognizeBlsApiCompatibilityEnvelope(cyclic)).toBeUndefined()
    expect(recognizeBlsApiCompatibilityEnvelope(symbol)).toBeUndefined()
    expect(recognizeBlsApiCompatibilityEnvelope(nonEnumerable)).toBeUndefined()
    expect(recognizeBlsApiCompatibilityEnvelope(hostile)).toBeUndefined()
  })

  it('has no platform, persistence, job, IPC, renderer, Agent, or LLM import boundary', () => {
    const source = readFileSync(new URL('./blsApiCompatibilityProbe.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('./blsApiRequestIdentity.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from ['"](?:electron|@platform\/|.*(?:settings|vault|storage|ipc|renderer|job|agent|llm))/i)
    expect(source).not.toMatch(/getPlatformFetch|applySessionProxySettings|localStorage|process\.env/i)
    expect(source).not.toMatch(/releaseDate|actualPrevious|calendar(?:Event|Revision)?/i)
  })
})
