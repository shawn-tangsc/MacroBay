import { describe, expect, it } from 'vitest'

import { decideUpstreamRetry } from './analysisUpstreamRetry'

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

  it('allows one retry per UTC day and refuses a second one', () => {
    expect(decideUpstreamRetry({ ...base, lastRetryAt: '2026-11-06T00:01:00.000Z' }))
      .toEqual({ retry: false, reason: 'already-used-today' })
    // 换一天就是新的一天；同一 UTC 日的判定不跟本地时区走。
    expect(decideUpstreamRetry({ ...base, lastRetryAt: '2026-11-05T23:59:00.000Z' })).toEqual({ retry: true })
  })
})
