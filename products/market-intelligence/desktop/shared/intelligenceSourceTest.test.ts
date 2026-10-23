// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isNetworkConnectionFailure, testSourceConnection } from './intelligenceSourceTest'

afterEach(() => {
  Reflect.deleteProperty(window, 'platform')
})

function stubInvoke(result: unknown) {
  const invoke = vi.fn(async () => result)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  return invoke
}

describe('isNetworkConnectionFailure', () => {
  it.each(['transport-unavailable', 'response-unavailable', 'request-timeout'])(
    'treats %s as a network-layer refusal',
    (failureCode) => {
      expect(isNetworkConnectionFailure({ ok: false, failureCode })).toBe(true)
    }
  )

  it.each(['credential-invalid', 'credential-not-configured', 'authentication-failed', 'plan-restricted', 'rate-limited'])(
    'does not treat %s as a network-layer refusal',
    (failureCode) => {
      expect(isNetworkConnectionFailure({ ok: false, failureCode })).toBe(false)
    }
  )

  it('ignores a success, an unsupported source, an unknown code, and a bare rejection', () => {
    expect(isNetworkConnectionFailure({ ok: true })).toBe(false)
    expect(isNetworkConnectionFailure({ ok: false, unsupported: true, failureCode: 'response-unavailable' })).toBe(false)
    expect(isNetworkConnectionFailure({ ok: false, failureCode: 'something-else' })).toBe(false)
    expect(isNetworkConnectionFailure({ ok: false })).toBe(false)
  })
})

describe('testSourceConnection failure code', () => {
  it('carries the provider refusal through so the page can name the network cause', async () => {
    stubInvoke({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })

    await expect(testSourceConnection({ sourceId: '0xrouter-aggregate-provider', kind: 'feed' }))
      .resolves.toEqual({ ok: false, failureCode: 'response-unavailable' })
  })

  it('reports a verified connection without a failure code', async () => {
    stubInvoke({ sourceId: '0xrouter-aggregate-provider', state: 'succeeded' })

    await expect(testSourceConnection({ sourceId: '0xrouter-aggregate-provider', kind: 'feed' }))
      .resolves.toEqual({ ok: true })
  })

  it('keeps product-scheduled market calendars unsupported and unprobed', async () => {
    const invoke = stubInvoke({ state: 'succeeded' })

    await expect(testSourceConnection({ sourceId: 'macro-calendar-0xrouter-economic-data', kind: 'market-calendar' }))
      .resolves.toEqual({ ok: false, unsupported: true })
    expect(invoke).not.toHaveBeenCalled()
  })
})
