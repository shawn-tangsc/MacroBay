import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: platformFetch }))

import { macroCalendarTransportPolicy } from './macroCalendarPolicy'
import { beaOfficialReleaseTransportPolicy, createMacroCalendarHttpClient, fedFomcStatementTransportPolicy } from './macroCalendarHttpClient'
import { getMacroCalendarOfficialSourceDescriptor, type MacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

const runAt = '2026-08-04T00:00:00.000Z'

describe('macroCalendarHttpClient', () => {
  const descriptor = () => getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
  const blsValues = () => getMacroCalendarOfficialSourceDescriptor('macro-calendar-bls-values')!
  const manualBlsIcs = () => getMacroCalendarOfficialSourceDescriptor('macro-calendar-bls-ics-manual')!
  const beaReleaseRss = () => getMacroCalendarOfficialSourceDescriptor('macro-calendar-bea-release-rss')!

  it('uses a GET without a body for fixed credential-free descriptors and retries at most twice', async () => {
    const request = vi.fn().mockRejectedValue(new Error('transport unavailable'))
    platformFetch.mockReturnValue(request)
    const result = await createMacroCalendarHttpClient().request(descriptor(), runAt)
    expect(request).toHaveBeenCalledTimes(macroCalendarTransportPolicy.maxAttempts)
    expect(request).toHaveBeenCalledWith(descriptor().sourceUrl, expect.objectContaining({ method: 'GET', redirect: macroCalendarTransportPolicy.redirectMode }))
    expect(request.mock.calls[0][1]).not.toHaveProperty('body')
    expect(result).toMatchObject({ ok: false, descriptorId: descriptor().descriptorId, failureCode: 'network-request-failed' })
    expect(JSON.stringify(result)).not.toContain('federalreserve.gov')
  })

  it('rejects an unregistered descriptor URL before transport', async () => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)
    const result = await createMacroCalendarHttpClient().request({ ...descriptor(), sourceUrl: 'https://discovered.invalid/next' }, runAt)
    expect(result).toMatchObject({ ok: false, failureCode: 'descriptor-not-allowed' })
    expect(request).not.toHaveBeenCalled()
  })

  it('requests an exact official FOMC statement body through platform fetch without redirects', async () => {
    const body = '<html><body>FOMC statement</body></html>'
    const request = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' }
    }))
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestFomcStatement(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
    )).resolves.toEqual({
      ok: true, descriptorId: 'macro-calendar-fed-statement-body', status: 200,
      acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html'
    })
    expect(request).toHaveBeenCalledWith(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm',
      expect.objectContaining({ method: 'GET', redirect: macroCalendarTransportPolicy.redirectMode })
    )
  })

  it('preserves UTF-8 BOM byte parity for a chunked FOMC statement without Content-Length', async () => {
    const body = '\uFEFF<html><body>FOMC statement</body></html>'
    const bytes = new TextEncoder().encode(body)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3))
        controller.enqueue(bytes.slice(3))
        controller.close()
      }
    })
    const request = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/html' }
    }))
    platformFetch.mockReturnValue(request)

    const result = await createMacroCalendarHttpClient().requestFomcStatement(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
    )

    expect(result).toMatchObject({ ok: true, acceptedBytes: Buffer.byteLength(body, 'utf8'), body })
    expect(result.ok && result.body.startsWith('\uFEFF')).toBe(true)
  })

  it('rejects and cancels an over-cap chunked FOMC statement before returning any body data', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(fedFomcStatementTransportPolicy.maximumBytes + 1))
      },
      cancel() { cancelled = true }
    })
    const request = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }))
    platformFetch.mockReturnValue(request)

    const result = await createMacroCalendarHttpClient().requestFomcStatement(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
    )

    expect(result).toEqual({ ok: false, descriptorId: 'macro-calendar-fed-statement-body', failureCode: 'response-body-too-large' })
    expect(cancelled).toBe(true)
    expect(result).not.toHaveProperty('body')
  })

  it.each(['-1', '1.5', String(fedFomcStatementTransportPolicy.maximumBytes + 1)])('rejects and cancels a malformed or over-cap FOMC declared content length without reading it: %s', async (contentLength) => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('FOMC statement body must not be read'))
      },
      cancel() { cancelled = true }
    })
    const request = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-length': contentLength, 'content-type': 'text/html' }
    }))
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestFomcStatement(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
    )).resolves.toEqual({ ok: false, descriptorId: 'macro-calendar-fed-statement-body', failureCode: 'response-body-too-large' })
    expect(cancelled).toBe(true)
  })

  it.each([
    [302, 'redirect-rejected'],
    [403, 'http-response-not-success']
  ])('preserves the FOMC %s response outcome despite an invalid declared content length', async (status, failureCode) => {
    const request = vi.fn().mockResolvedValue(new Response(null, {
      status,
      headers: { 'content-length': '-1', 'content-type': 'text/html' }
    }))
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestFomcStatement(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
    )).resolves.toEqual({ ok: false, descriptorId: 'macro-calendar-fed-statement-body', status, failureCode })
  })

  it.each([
    'https://example.test/newsevents/pressreleases/monetary20260729a.htm',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm?source=history',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729b.htm'
  ])('rejects a discovered noncanonical FOMC statement body URL before transport', async (url) => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestFomcStatement(url)).resolves.toEqual({
      ok: false, descriptorId: 'macro-calendar-fed-statement-body', failureCode: 'descriptor-not-allowed'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ['descriptorId', 'descriptorId', 'macro-calendar-fed-schedule'],
    ['providerId', 'providerId', 'macro-calendar-fed'],
    ['sourceUrl', 'sourceUrl', 'https://example.test/not-bea'],
    ['payloadFormat', 'payloadFormat', 'json'],
    ['parserId', 'parserId', 'caller-mutated-parser'],
    ['eventFamilies contents', 'eventFamilies', ['pce', 'core-pce', 'caller-mutated']],
    ['eventFamilies order', 'eventFamilies', ['gdp', 'core-pce', 'pce']],
    ['eventFamilies shape', 'eventFamilies', 'not-an-array'],
    ['authMode', 'authMode', 'required-api-key'],
    ['pollEligibility', 'pollEligibility', 'schedule'],
    ['evidenceLabel', 'evidenceLabel', 'schedule-html'],
    ['accessMode', 'accessMode', 'manual-upload']
  ])('rejects a caller-mutated fixed descriptor %s before transport', async (_label, field, value) => {
    const request = vi.fn()
    platformFetch.mockClear()
    platformFetch.mockReturnValue(request)
    const mutated = { ...beaReleaseRss(), [field]: value } as unknown as MacroCalendarOfficialSourceDescriptor

    await expect(createMacroCalendarHttpClient().request(mutated, runAt)).resolves.toMatchObject({
      ok: false, failureCode: 'descriptor-not-allowed'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('sends the fixed BLS JSON POST and returns only accepted response data', async () => {
    const body = '{"status":"REQUEST_SUCCEEDED"}'
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')), 'content-type': 'application/json' }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    const result = await createMacroCalendarHttpClient().request(blsValues(), runAt)

    expect(request).toHaveBeenCalledWith(blsValues().sourceUrl, expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"seriesid":["CUUR0000SA0","CUUR0000SA0L1E","CES0000000001","LNS14000000","CES0500000003","CES0500000001"],"startyear":"2025","endyear":"2026"}',
      redirect: macroCalendarTransportPolicy.redirectMode
    }))
    expect(result).toEqual({
      ok: true, descriptorId: blsValues().descriptorId, status: 200,
      acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'application/json'
    })
  })

  it('rejects malformed run time before transport', async () => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().request(descriptor(), 'not-a-date')).resolves.toMatchObject({
      ok: false, failureCode: 'run-time-invalid'
    })
    await expect(createMacroCalendarHttpClient().request(blsValues(), 'not-a-date')).resolves.toMatchObject({
      ok: false, failureCode: 'run-time-invalid'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('requests only the fixed official BEA RSS and returns a MIME-validated bounded body', async () => {
    const body = '<rss><channel /></rss>'
    const request = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=UTF-8' } }))
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestBeaOfficialReleaseRss()).resolves.toEqual({
      ok: true, descriptorId: beaOfficialReleaseTransportPolicy.rssDescriptorId, status: 200,
      acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'application/rss+xml; charset=UTF-8'
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(beaReleaseRss().sourceUrl, expect.objectContaining({ method: 'GET', redirect: 'error' }))
  })

  it.each([
    'http://www.bea.gov/news/2026/release',
    'https://www.bea.gov/news/2026/release?x=1',
    'https://attacker.invalid/news/2026/release',
    'https://user@www.bea.gov/news/2026/release'
  ])('rejects an unrecognized BEA release page URL before transport: %s', async (url) => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)
    await expect(createMacroCalendarHttpClient().requestBeaOfficialReleasePage(url)).resolves.toEqual({
      ok: false, descriptorId: beaOfficialReleaseTransportPolicy.pageDescriptorId, failureCode: 'descriptor-not-allowed'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('accepts an HTML essence with parameters for the fixed canonical BEA release page', async () => {
    const body = '<html><title>release</title></html>'
    const request = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } }))
    platformFetch.mockReturnValue(request)
    await expect(createMacroCalendarHttpClient().requestBeaOfficialReleasePage('https://www.bea.gov/news/2026/release')).resolves.toMatchObject({
      ok: true, descriptorId: beaOfficialReleaseTransportPolicy.pageDescriptorId, body
    })
  })

  it('cancels a chunked BEA release body that exceeds the fixed limit before parsing', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(beaOfficialReleaseTransportPolicy.maximumBytes + 1)) },
      cancel() { cancelled = true }
    })
    const request = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } }))
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().requestBeaOfficialReleaseRss()).resolves.toEqual({
      ok: false, descriptorId: beaOfficialReleaseTransportPolicy.rssDescriptorId, failureCode: 'response-body-too-large'
    })
    expect(cancelled).toBe(true)
  })

  it('uses the exact fixed Fed schedule request for one redacted provider connection probe', async () => {
    const body = '<html><body>FOMC calendar</body></html>'
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': String(Buffer.byteLength(body, 'utf8')), 'content-type': 'text/html' }),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    const client = createMacroCalendarHttpClient() as unknown as {
      testProviderConnection: (providerId: unknown, userId?: unknown) => Promise<unknown>
    }

    await expect(client.testProviderConnection('macro-calendar-fed')).resolves.toEqual({ state: 'succeeded' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(descriptor().sourceUrl, expect.objectContaining({ method: 'GET', redirect: macroCalendarTransportPolicy.redirectMode }))
  })

  it.each([
    ['redirect', 302, '<html>unexpected</html>'],
    ['minimum-envelope failure', 200, 'not an HTML document']
  ])('fails the Fed connection probe closed for %s responses without a retry', async (_label, status, body) => {
    const request = vi.fn().mockResolvedValue({
      status,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(body)
    })
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().testProviderConnection('macro-calendar-fed')).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([
    [{ providerId: 'macro-calendar-fed' }],
    new Proxy({}, { ownKeys() { throw new Error('hostile') } })
  ])('fails closed before transport for hostile provider input', async (providerId) => {
    const request = vi.fn()
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().testProviderConnection(providerId)).resolves.toEqual({
      state: 'failed', failureCode: 'response-unavailable'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('maps the one bounded provider probe deadline to the coarse timeout result', async () => {
    vi.useFakeTimers()
    const request = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    platformFetch.mockReturnValue(request)
    const result = createMacroCalendarHttpClient().testProviderConnection('macro-calendar-fed')

    await vi.advanceTimersByTimeAsync(macroCalendarTransportPolicy.requestTimeoutMs)
    await expect(result).resolves.toEqual({ state: 'failed', failureCode: 'request-timeout' })
    expect(request).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('rejects the fixed manual BLS ICS descriptor before resolving platform fetch', async () => {
    const request = vi.fn()
    platformFetch.mockClear()
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().request(manualBlsIcs(), runAt)).resolves.toEqual({
      ok: false, descriptorId: 'macro-calendar-bls-ics-manual', failureCode: 'descriptor-not-allowed'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not resolve platform fetch when the parent signal is already aborted', async () => {
    const parent = new AbortController()
    parent.abort()
    const request = vi.fn()
    platformFetch.mockClear()
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().request(descriptor(), runAt, parent.signal)).resolves.toMatchObject({
      ok: false, failureCode: 'network-request-failed'
    })
    expect(platformFetch).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not start a retry after parent cancellation', async () => {
    const parent = new AbortController()
    const request = vi.fn(() => {
      parent.abort()
      return Promise.resolve({ status: 503, headers: new Headers(), text: vi.fn() })
    })
    platformFetch.mockReturnValue(request)

    await expect(createMacroCalendarHttpClient().request(descriptor(), runAt, parent.signal)).resolves.toMatchObject({
      ok: false, failureCode: 'network-request-failed'
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects declared and observed oversized bodies before a parser could receive them', async () => {
    const tooLarge = String(macroCalendarTransportPolicy.responseAcceptedMaxBytes + 1)
    const declaredText = vi.fn()
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: new Headers({ 'content-length': tooLarge }), text: declaredText })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), text: vi.fn().mockResolvedValue('x'.repeat(macroCalendarTransportPolicy.responseAcceptedMaxBytes + 1)) })
    platformFetch.mockReturnValue(request)
    const declared = await createMacroCalendarHttpClient().request(descriptor(), runAt)
    const observed = await createMacroCalendarHttpClient().request(descriptor(), runAt)
    expect(declared).toMatchObject({ ok: false, failureCode: 'response-body-too-large' })
    expect(declaredText).not.toHaveBeenCalled()
    expect(observed).toMatchObject({ ok: false, failureCode: 'response-body-too-large' })
  })

  it('returns a safe redirect failure without accepting a redirect response', async () => {
    platformFetch.mockReturnValue(vi.fn().mockResolvedValue({ status: 302, headers: new Headers(), text: vi.fn() }))
    await expect(createMacroCalendarHttpClient().request(descriptor(), runAt)).resolves.toMatchObject({
      ok: false,
      failureCode: 'redirect-rejected'
    })
  })

  it('never accepts 401, 403, or 404 response bodies', async () => {
    for (const status of [401, 403, 404]) {
      const body = vi.fn().mockResolvedValue('error response must not escape')
      platformFetch.mockReturnValue(vi.fn().mockResolvedValue({ status, headers: new Headers(), text: body }))
      const result = await createMacroCalendarHttpClient().request(descriptor(), runAt)
      expect(result).toMatchObject({ ok: false, status, failureCode: 'http-response-not-success' })
      expect(JSON.stringify(result)).not.toContain('error response')
      expect(body).not.toHaveBeenCalled()
    }
  })

  it('retries a transient 5xx once and returns a safe terminal failure without its body', async () => {
    const firstBody = vi.fn()
    const finalBody = vi.fn()
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 503, headers: new Headers(), text: firstBody })
      .mockResolvedValueOnce({ status: 503, headers: new Headers(), text: finalBody })
    platformFetch.mockReturnValue(request)

    const result = await createMacroCalendarHttpClient().request(descriptor(), runAt)

    expect(request).toHaveBeenCalledTimes(macroCalendarTransportPolicy.maxAttempts)
    expect(result).toMatchObject({ ok: false, status: 503, failureCode: 'http-response-not-success' })
    expect(firstBody).not.toHaveBeenCalled()
    expect(finalBody).not.toHaveBeenCalled()
  })

  it('aborts each transport attempt at the named deadline', async () => {
    vi.useFakeTimers()
    const request = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    platformFetch.mockReturnValue(request)
    const result = createMacroCalendarHttpClient().request(descriptor(), runAt)
    await vi.advanceTimersByTimeAsync(macroCalendarTransportPolicy.requestTimeoutMs * macroCalendarTransportPolicy.maxAttempts)
    await expect(result).resolves.toMatchObject({ ok: false, failureCode: 'request-timeout' })
    expect(request).toHaveBeenCalledTimes(macroCalendarTransportPolicy.maxAttempts)
    vi.useRealTimers()
  })
})
