import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { probeZeroXRouterConnection } from './zeroXRouterConnectionProbe'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

describe('probeZeroXRouterConnection', () => {
  it('settles at the named deadline when platformFetch ignores abort', async () => {
    vi.useFakeTimers()
    try {
      let requestSignal: AbortSignal | undefined
      platformFetch.mockImplementationOnce((_url: string, options: RequestInit) => {
        requestSignal = options.signal ?? undefined
        return new Promise<Response>(() => undefined)
      })

      const result = probeZeroXRouterConnection('router-probe-key')
      await vi.advanceTimersByTimeAsync(zeroXRouterSourcePolicy.connectionProbe.requestTimeoutMs)

      await expect(result).resolves.toEqual({
        sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'request-timeout'
      })
      expect(requestSignal?.aborted).toBe(true)
      expect(platformFetch).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a body reader that ignores abort and settles at the named deadline', async () => {
    vi.useFakeTimers()
    try {
      const reader = {
        read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn()
      }
      const response = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: { getReader: () => reader }
      } as unknown as Response
      platformFetch.mockResolvedValueOnce(response)

      const result = probeZeroXRouterConnection('router-probe-key')
      await vi.advanceTimersByTimeAsync(zeroXRouterSourcePolicy.connectionProbe.requestTimeoutMs)

      await expect(result).resolves.toEqual({
        sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'request-timeout'
      })
      expect(reader.cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a response body that arrives after the deadline without parsing it', async () => {
    vi.useFakeTimers()
    try {
      let resolveResponse!: (response: Response) => void
      const body = { cancel: vi.fn(async () => undefined) } as unknown as ReadableStream<Uint8Array>
      platformFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveResponse = resolve }))

      const result = probeZeroXRouterConnection('router-probe-key')
      await vi.advanceTimersByTimeAsync(zeroXRouterSourcePolicy.connectionProbe.requestTimeoutMs)
      await expect(result).resolves.toEqual({
        sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'request-timeout'
      })

      resolveResponse({ body } as Response)
      await Promise.resolve()
      await Promise.resolve()
      expect(body.cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
