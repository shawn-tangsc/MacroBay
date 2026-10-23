import { describe, expect, it, vi } from 'vitest'

import { httpRequest } from './httpClient'

describe('httpClient', () => {
  it('aborts request on timeout', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 200)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
      return new Response('late', { status: 200 })
    })

    await expect(
      httpRequest(
        { url: 'https://example.test/data', timeoutMs: 20 },
        { fetchImpl }
      )
    ).rejects.toThrow('timed out')
  })

  it('retries only retryable failures', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('error', { status: 503 })
      }
      return new Response('ok', { status: 200 })
    })

    const response = await httpRequest(
      { url: 'https://example.test/retry' },
      {
        fetchImpl,
        retryPolicy: { maxAttempts: 2, retryableStatuses: [503] }
      }
    )

    expect(response.status).toBe(200)
    expect(attempts).toBe(2)
  })

  it('redacts configured headers in request and response logs', async () => {
    const logs: Array<{ phase: string; metadata?: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async () =>
      new Response('body', {
        status: 200,
        headers: {
          authorization: 'secret-token',
          'content-type': 'text/plain'
        }
      })
    )

    await httpRequest(
      {
        url: 'https://example.test/secure',
        headers: {
          Authorization: 'secret-token',
          'X-Custom': 'visible'
        }
      },
      {
        fetchImpl,
        redactHeaders: ['authorization'],
        onLog: (entry) => logs.push(entry)
      }
    )

    const requestLog = logs.find((entry) => entry.phase === 'request')
    const responseLog = logs.find((entry) => entry.phase === 'response')
    const requestHeaders = (requestLog?.metadata?.headers ?? {}) as Record<string, string>
    const responseHeaders = (responseLog?.metadata?.headers ?? {}) as Record<string, string>

    expect(requestHeaders.Authorization).toBe('[REDACTED]')
    expect(requestHeaders['X-Custom']).toBe('visible')
    expect(responseHeaders.authorization).toBe('[REDACTED]')
  })

  it('passes conditional fetch headers without platform interpretation', async () => {
    let observedHeaders: Record<string, string> | undefined
    const fetchImpl = vi.fn(async (_url, init) => {
      observedHeaders = init?.headers as Record<string, string>
      return new Response('', { status: 200 })
    })

    await httpRequest({
      url: 'https://example.test/conditional',
      conditionalHeaders: {
        'If-None-Match': 'etag-123',
        'If-Modified-Since': 'Mon, 01 Jan 2024 00:00:00 GMT'
      }
    }, { fetchImpl })

    expect(observedHeaders?.['If-None-Match']).toBe('etag-123')
    expect(observedHeaders?.['If-Modified-Since']).toBe('Mon, 01 Jan 2024 00:00:00 GMT')
  })
})
