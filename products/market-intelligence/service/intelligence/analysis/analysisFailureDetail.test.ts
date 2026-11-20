import { describe, expect, it } from 'vitest'

import {
  analysisFailureDetailCodes,
  classifyProviderFailureDetail,
  isAnalysisFailureDetailCode,
  resolveAnalysisRunFailureDetail
} from './analysisFailureDetail'

describe('provider failure detail', () => {
  it('names a rate limit by what the platform already knows it was', () => {
    expect(classifyProviderFailureDetail({ errorCode: 'rate-limited', durationMs: 900 })).toBe('http-429')
  })

  it('names the invocation timer firing as a gateway timeout', () => {
    expect(classifyProviderFailureDetail({ errorCode: 'timeout', durationMs: 240_000 })).toBe('gateway-timeout')
  })

  it('names the fallback budget cutting a long attempt', () => {
    // Observed: 59–61 s, the gateway's undeclared-budget fallback.
    for (const durationMs of [59_000, 60_700, 61_400]) {
      expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs })).toBe('upstream-aborted')
    }
  })

  it('keeps a slow failure that ended on its own out of "aborted"', () => {
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 54_000 })).toBe('provider-other')
  })

  it('names an error answer by the status it carried, whatever the elapsed time', () => {
    // 状态码是事实：一个 500 无论在 1.2 秒还是 60 秒回来，都是「服务端给了错误回答」，
    // 不是「连不上」。原来那条按耗时猜的规则在这两个数上都会猜反。
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, httpStatus: 500 })).toBe('http-5xx')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, httpStatus: 503 })).toBe('http-5xx')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, httpStatus: 400 })).toBe('http-4xx')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, httpStatus: 401 })).toBe('http-4xx')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, httpStatus: 429 })).toBe('http-429')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 60_700, httpStatus: 502 })).toBe('http-5xx')
  })

  it('names a connection failure only when the transport kind says so', () => {
    for (const transportErrorKind of ['dns', 'refused', 'reset', 'tls'] as const) {
      expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, transportErrorKind })).toBe('connect-failed')
    }
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, transportErrorKind: 'timeout' })).toBe('gateway-timeout')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, transportErrorKind: 'unknown' })).toBe('provider-other')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200, transportErrorKind: 'aborted' })).toBe('provider-other')
  })

  it('no longer infers a connection failure from a short duration', () => {
    // `connectFailureMaxMs` 退役：耗时短只说明这一跳很快失败，说明不了是不是连接。
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 1_200 })).toBe('provider-other')
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 200 })).toBe('provider-other')
  })

  it('treats an error answer that took a while as one the provider returned', () => {
    expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs: 20_000 })).toBe('provider-other')
  })

  it('never answers with a blank, even without a duration or with a nonsense one', () => {
    for (const durationMs of [undefined, null, Number.NaN, -1]) {
      expect(classifyProviderFailureDetail({ errorCode: 'provider-error', durationMs })).toBe('provider-other')
    }
    expect(classifyProviderFailureDetail({ errorCode: 'something-new' })).toBe('provider-other')
  })

  it('keeps every answer inside the closed set', () => {
    for (const [errorCode, durationMs] of [['provider-error', 60_000], ['rate-limited', 1], ['timeout', 2], ['invalid-json', 3]] as const) {
      expect(isAnalysisFailureDetailCode(classifyProviderFailureDetail({ errorCode, durationMs }))).toBe(true)
    }
    expect(new Set(analysisFailureDetailCodes).size).toBe(analysisFailureDetailCodes.length)
  })
})

describe('detail stored on a failed run', () => {
  it('finer causes of their own are kept, not replaced', () => {
    expect(resolveAnalysisRunFailureDetail({ failureCode: 'analysis-invalid-output-schema' })).toBe('analysis-invalid-output-schema')
    expect(resolveAnalysisRunFailureDetail({ failureCode: 'analysis-missing-evidence' })).toBe('analysis-missing-evidence')
    expect(resolveAnalysisRunFailureDetail({ failureCode: 'analysis-storage-failed' })).toBe('analysis-storage-failed')
  })

  it('the provider line gets a detail code, and a blank is impossible', () => {
    expect(resolveAnalysisRunFailureDetail({ failureCode: 'analysis-provider-error' })).toBe('provider-other')
    expect(resolveAnalysisRunFailureDetail({
      failureCode: 'analysis-provider-error', providerFailure: { errorCode: 'provider-error', durationMs: 60_000 }
    })).toBe('upstream-aborted')
    expect(resolveAnalysisRunFailureDetail({
      failureCode: 'analysis-timeout', providerFailure: { errorCode: 'timeout', durationMs: 240_000 }
    })).toBe('gateway-timeout')
  })
})
