import { afterEach, describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { requestZeroXRouterCalendarJsonBody, requestZeroXRouterEtfFlowHistoryJson, requestZeroXRouterJson, requestZeroXRouterJsonBody } from './zeroXRouterHttpTransport'
import { calendarMonthResponseBudgetPolicy, etfFlowHistoryResponseBudgetPolicy, zeroXRouterHttpTransportPolicy } from './zeroXRouterSourcePolicy'

afterEach(() => platformFetch.mockReset())

describe('requestZeroXRouterJson rejection diagnostics', () => {
  it.each([false, true])('bounds the calendar body independently, with declared length=%s', async declared => {
    const maximum = calendarMonthResponseBudgetPolicy.maximumBodyBytes
    expect(maximum).toBe(2 * 1024 * 1024)
    expect(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes).toBe(256 * 1024)
    expect(etfFlowHistoryResponseBudgetPolicy).toEqual({ maximumBodyBytes: 2 * 1024 * 1024, trustContentLength: false })
    for (const size of [maximum, maximum + 1]) {
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(size))) }, cancel })
      // Exact-budget stream must end; oversized streams must be cancelled.
      const response = size === maximum ? new Response(' '.repeat(size), { headers: { 'content-type': 'application/json' } }) :
        new Response(body, { headers: { 'content-type': 'application/json' } })
      if (declared) response.headers.set('content-length', String(size))
      platformFetch.mockResolvedValueOnce(response)
      const result = await requestZeroXRouterCalendarJsonBody({ url: 'https://example.test/fixed', apiKey: 'safe-key' })
      expect(result.state).toBe(size === maximum ? 'succeeded' : 'failed')
      if (result.state === 'succeeded') expect(result.acceptedBytes).toBe(maximum)
      else { expect(cancel).toHaveBeenCalledOnce(); expect(result).toEqual({ state: 'failed', failureCode: 'response-unavailable' }) }
    }
  })
  it('returns a bounded accepted JSON body to the main-process caller', async () => {
    const body = '{"code":200,"data":[]}'
    platformFetch.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(requestZeroXRouterJsonBody({ url: 'https://example.test/fixed', apiKey: 'safe-key' }))
      .resolves.toMatchObject({ state: 'succeeded', body, acceptedBytes: Buffer.byteLength(body), status: 200, contentType: 'application/json' })
  })
  it.each([
    ['response-status', new Response('', { status: 403, headers: { 'content-type': 'application/json' } })],
    ['response-mime', new Response('', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['response-content-length', new Response('', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes + 1) } })],
    ['empty-body', new Response('', { status: 200, headers: { 'content-type': 'application/json' } })]
  ] as const)('reports %s without exposing response data', async (expectedStage, response) => {
    platformFetch.mockResolvedValueOnce(response)
    const stages: string[] = []

    await expect(requestZeroXRouterJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts: () => true,
      onRejectionStage: (stage) => stages.push(stage)
    })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })

    expect(stages).toEqual([expectedStage])
  })

  it.each([
    [401, '4xx'],
    [403, '4xx'],
    [404, '4xx'],
    [422, '4xx'],
    [500, '5xx'],
    [503, '5xx'],
    [302, 'other']
  ] as const)('classifies HTTP %s as a safe status class without exposing response details', async (status, expectedStatusClass) => {
    platformFetch.mockResolvedValueOnce(new Response('private response body', {
      status,
      headers: {
        'content-type': 'application/json',
        'x-private-header': 'private-header-value'
      }
    }))
    const diagnostics: Array<{ stage: string; statusClass?: string }> = []

    await expect(requestZeroXRouterJson({
      url: 'https://example.test/private?apiKey=secret',
      apiKey: 'safe-key',
      accepts: () => true,
      onRejectionStage: (stage, statusClass) => diagnostics.push({ stage, statusClass })
    })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })

    expect(diagnostics).toEqual([{ stage: 'response-status', statusClass: expectedStatusClass }])
    expect(JSON.stringify(diagnostics)).not.toContain('private response body')
    expect(JSON.stringify(diagnostics)).not.toContain('private-header-value')
    expect(JSON.stringify(diagnostics)).not.toContain('example.test')
    expect(JSON.stringify(diagnostics)).not.toContain('safe-key')
  })

  it('reports body-size when the actual stream crosses the named cap before accepts', async () => {
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes + 1), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))
    const stages: string[] = []
    const accepts = vi.fn(() => true)

    await requestZeroXRouterJson({ url: 'https://example.test', apiKey: 'safe-key', accepts, onRejectionStage: (stage) => stages.push(stage) })

    expect(stages).toEqual(['body-size'])
    expect(accepts).not.toHaveBeenCalled()
  })

  it('reports body-read for a failing stream and transport-error for a failed request', async () => {
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new Error('private body error')) })
    platformFetch.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    const bodyStages: string[] = []

    await requestZeroXRouterJson({ url: 'https://example.test', apiKey: 'safe-key', accepts: () => true, onRejectionStage: (stage) => bodyStages.push(stage) })
    expect(bodyStages).toEqual(['body-read'])

    platformFetch.mockRejectedValueOnce(new Error('private network error'))
    const transportStages: string[] = []
    await requestZeroXRouterJson({ url: 'https://example.test', apiKey: 'safe-key', accepts: () => true, onRejectionStage: (stage) => transportStages.push(stage) })
    expect(transportStages).toEqual(['transport-error'])
  })

  it('does not emit a rejection stage for an accepted body', async () => {
    platformFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const stages: string[] = []

    await expect(requestZeroXRouterJson({ url: 'https://example.test', apiKey: 'safe-key', accepts: () => true, onRejectionStage: (stage) => stages.push(stage) }))
      .resolves.toEqual({ state: 'succeeded' })
    expect(stages).toEqual([])
  })

  it('uses an ETF-specific stream budget without trusting mismatched Content-Length', async () => {
    const body = '{"code":200,"data":[]}'
    platformFetch.mockResolvedValueOnce(new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes + 1)
      }
    }))

    await expect(requestZeroXRouterEtfFlowHistoryJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts: () => true
    })).resolves.toEqual({ state: 'succeeded' })
  })

  it('keeps the generic entrypoint on the shared cap even when a caller attempts to supply an ETF budget', async () => {
    const accepts = vi.fn(() => true)
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(etfFlowHistoryResponseBudgetPolicy.maximumBodyBytes), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    const legacyCall = requestZeroXRouterJson as unknown as (input: Readonly<{
      url: string
      apiKey: string
      accepts: (body: string) => boolean
      bodyBudget: typeof etfFlowHistoryResponseBudgetPolicy
    }>) => Promise<unknown>
    await expect(legacyCall({
      url: 'https://example.test', apiKey: 'safe-key', accepts,
      bodyBudget: etfFlowHistoryResponseBudgetPolicy
    })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(accepts).not.toHaveBeenCalled()
  })

  it('accepts exactly the ETF byte budget and rejects a larger stream before accepts', async () => {
    const budget = etfFlowHistoryResponseBudgetPolicy.maximumBodyBytes
    const accepts = vi.fn(() => true)
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(budget), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    await expect(requestZeroXRouterEtfFlowHistoryJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts
    })).resolves.toEqual({ state: 'succeeded' })
    expect(accepts).toHaveBeenCalledOnce()

    const stages: string[] = []
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(budget + 1), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))
    await expect(requestZeroXRouterEtfFlowHistoryJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts,
      onRejectionStage: (stage) => stages.push(stage)
    })).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(stages).toEqual(['body-size'])
    expect(accepts).toHaveBeenCalledOnce()
  })

  it('uses the evidence-measured ETF-only cap while the generic entrypoint remains bounded separately', async () => {
    const accepts = vi.fn(() => true)
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(etfFlowHistoryResponseBudgetPolicy.maximumBodyBytes), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    await expect(requestZeroXRouterEtfFlowHistoryJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts
    })).resolves.toEqual({ state: 'succeeded' })
    expect(etfFlowHistoryResponseBudgetPolicy.maximumBodyBytes).toBe(2 * 1024 * 1024)
    expect(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes).toBe(256 * 1024)
  })

  it('accepts an ETF body above the retired cap while keeping the generic cap unchanged', async () => {
    const accepts = vi.fn(() => true)
    platformFetch.mockResolvedValueOnce(new Response(new Uint8Array(601_606), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    await expect(requestZeroXRouterEtfFlowHistoryJson({
      url: 'https://example.test', apiKey: 'safe-key', accepts
    })).resolves.toEqual({ state: 'succeeded' })
    expect(accepts).toHaveBeenCalledOnce()
    expect(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes).toBe(256 * 1024)
  })
})
