import { describe, expect, it } from 'vitest'

import {
  classifyGatewayHttpStatus,
  classifyGatewayTransportError,
  toSafeGatewayErrorBody
} from './gatewayErrorClassifier'
import { createGatewayAbortTimeout, isGatewayTimeoutAbort } from './gatewayAbortAndTimeout'

describe('gatewayErrorClassifier', () => {
  it('classifies auth, forbidden, rate-limit, and protocol failures', () => {
    expect(classifyGatewayHttpStatus(401).kind).toBe('auth')
    expect(classifyGatewayHttpStatus(403).kind).toBe('forbidden')
    expect(classifyGatewayHttpStatus(429).kind).toBe('rate-limit')
    expect(classifyGatewayHttpStatus(400, { bodyText: 'invalid request' }).kind).toBe('protocol')
  })

  it('classifies timeout and abort transport errors', () => {
    expect(classifyGatewayTransportError(new Error('gateway-timeout')).kind).toBe('timeout')
    expect(classifyGatewayTransportError(new DOMException('Aborted', 'AbortError')).kind).toBe('abort')
  })

  it('keeps safe error bodies free of secrets', () => {
    const body = toSafeGatewayErrorBody(
      classifyGatewayHttpStatus(401, {
        bodyText: 'invalid api key sk-secret-value'
      })
    )
    expect(JSON.stringify(body)).not.toContain('sk-secret-value')
    expect(JSON.stringify(body)).toContain('Upstream provider authentication failed')
  })
})

describe('gatewayAbortAndTimeout', () => {
  it('aborts on timeout and reports timeout reason', async () => {
    const handle = createGatewayAbortTimeout({ timeoutMs: 5 })
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(handle.signal.aborted).toBe(true)
    expect(isGatewayTimeoutAbort(handle.signal)).toBe(true)
    handle.clear()
  })

  it('propagates parent abort signals', () => {
    const parent = new AbortController()
    const handle = createGatewayAbortTimeout({ parentSignal: parent.signal, timeoutMs: 10_000 })
    parent.abort(new Error('gateway-abort'))
    expect(handle.signal.aborted).toBe(true)
    handle.clear()
  })
})
