import { describe, expect, it } from 'vitest'

import { decideUpstreamRetry, waitForRetry } from './analysisUpstreamRetry'

const now = '2026-11-06T10:00:00.000Z'
const base = { failureDetailCode: 'upstream-aborted', callsSpent: 1, lastRetryAt: null, now } as const

describe('the one upstream retry', () => {
  it('retries only a cut connection', () => {
    expect(decideUpstreamRetry(base)).toEqual({ retry: true })
    for (const code of ['http-429', 'connect-failed', 'gateway-timeout', 'provider-other']) {
      expect(decideUpstreamRetry({ ...base, failureDetailCode: code })).toEqual({ retry: false, reason: 'not-aborted' })
    }
  })

  it('stops at the call budget, so repair and retry cannot add up to a fourth call', () => {
    expect(decideUpstreamRetry({ ...base, callsSpent: 2 })).toEqual({ retry: false, reason: 'attempts-spent' })
  })

  it('gives up the backoff the moment the run is cancelled', async () => {
    // 已经取消：不等、不发。
    const already = new AbortController(); already.abort()
    await expect(waitForRetry(20_000, already.signal)).resolves.toBe('cancelled')
    // 等待中途取消：立刻返回，而不是先等满 20 秒再发一次没人要的请求。
    const during = new AbortController()
    const started = Date.now()
    const pending = waitForRetry(20_000, during.signal)
    during.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('allows one retry per UTC day and refuses a second one', () => {
    expect(decideUpstreamRetry({ ...base, lastRetryAt: '2026-11-06T00:01:00.000Z' }))
      .toEqual({ retry: false, reason: 'already-used-today' })
    // 换一天就是新的一天；同一 UTC 日的判定不跟本地时区走。
    expect(decideUpstreamRetry({ ...base, lastRetryAt: '2026-11-05T23:59:00.000Z' })).toEqual({ retry: true })
  })
})
