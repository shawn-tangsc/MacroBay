import { describe, expect, it } from 'vitest'

import { classifyHttpFailure } from './providerConnection'
import { summarizeUpstreamFailureBody } from './providerFailureBody'

/**
 * PLAT-62：Z.ai 免费模型实测 429（overloaded_error / 1305）。
 * - HTTP 429 一律 `rate_limited`（走「供应商限流或过载」，不再「请按状态码排查」）；
 * - 上游 message/body 含 overloaded / rate limit / too many requests / temporarily overloaded / 1305 同样归类；
 * - 兼容性检查的响应体先解析 JSON，取 type/code/message（脱敏、≤200），detail 保留 request_id。
 */
describe('PLAT-62 rate-limited provider failures', () => {
  it('maps HTTP 429 to rate_limited unless the body says the account is out of credits', () => {
    expect(classifyHttpFailure(429, null)).toBe('rate_limited')
    expect(classifyHttpFailure(429, '{"error":{"type":"overloaded_error"}}')).toBe('rate_limited')
    // 2026-10-21 修订（PM 确认）：OpenAI 用 429 表达"额度用尽"，按文案区分。
    // 判据见 `isBalanceMessageWithoutRateLimit`：命中余额词且没有限流词才算余额。
    expect(classifyHttpFailure(429, 'quota exceeded, please recharge')).toBe('account_balance_insufficient')
    expect(classifyHttpFailure(429, 'You have no credits remaining.')).toBe('account_balance_insufficient')
  })

  it('maps overload / rate-limit wording and the 1305 code to rate_limited', () => {
    const messages = [
      'The service may be temporarily overloaded',
      'rate limit exceeded',
      'Too Many Requests',
      '{"error":{"type":"overloaded_error","code":"1305"}}'
    ]
    for (const message of messages) {
      expect(classifyHttpFailure(503, message), message).toBe('rate_limited')
    }
  })

  it('summarizes an overloaded error body compactly and keeps the request id', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'overloaded_error',
        code: '1305',
        message: 'The service may be temporarily overloaded.'
      },
      request_id: 'req_abc123'
    })

    const summary = summarizeUpstreamFailureBody(body, 429, 'secret-key-123')
    expect(summary.rateLimited).toBe(true)
    expect(summary.detail).toContain('HTTP 429')
    expect(summary.detail).toContain('overloaded_error (1305)')
    expect(summary.detail).toContain('The service may be temporarily overloaded')
    expect(summary.detail).toContain('request_id req_abc123')
    // 不再把整段 JSON 原样抛给用户。
    expect(summary.detail).not.toContain('{"')
    expect(summary.detail).not.toContain('"type":"error"')
    expect(summary.detail.length).toBeLessThanOrEqual(200)
  })

  it('redacts the api key from the summarized detail', () => {
    const body = '{"error":{"type":"overloaded_error","message":"overloaded for secret-key-123"}}'
    const summary = summarizeUpstreamFailureBody(body, 429, 'secret-key-123')

    expect(summary.detail).not.toContain('secret-key-123')
    expect(summary.detail).toContain('[redacted]')
    expect(summary.rateLimited).toBe(true)
  })

  it('does not classify unrelated failures as rate limiting', () => {
    expect(classifyHttpFailure(401, 'invalid api key')).toBe('http_401')
    expect(summarizeUpstreamFailureBody('{"error":{"message":"bad request"}}', 400, '').rateLimited).toBe(false)
  })

  it('extracts the plain "msg" field and never falls back to raw JSON', () => {
    const body = JSON.stringify({ code: 401, msg: 'APIkey或者用户异常', data: null })

    const summary = summarizeUpstreamFailureBody(body, 401)
    expect(summary.detail).toBe('HTTP 401 · APIkey或者用户异常')
    expect(summary.detail).not.toContain('{"')
    expect(summary.detail).not.toContain('"data":null')

    // 解析不出 message 时只留状态码，不把 JSON 原样抛出去。
    expect(summarizeUpstreamFailureBody('{"code":401,"data":null}', 401).detail).toBe('HTTP 401')
  })
})
