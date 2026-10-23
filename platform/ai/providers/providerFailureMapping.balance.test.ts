import { describe, expect, it } from 'vitest'

import { classifyHttpFailure } from './providerFailureMapping'

/**
 * OpenAI 用 **429** 表达"额度用尽"（`insufficient_quota` / `credit_balance_exhausted`），
 * 与真正的限流同状态码。判据必须看文案：否则用户只会看到「限流」去重试，
 * 永远想不到要去充值。
 */
describe('429 的两种含义', () => {
  it('把"没有额度"判成余额不足', () => {
    expect(classifyHttpFailure(429, 'You have no credits remaining. Add credits to continue using the API.')).toBe(
      'account_balance_insufficient'
    )
    expect(classifyHttpFailure(429, 'You exceeded your current quota, please check your plan and billing details.')).toBe(
      'account_balance_insufficient'
    )
  })

  it('真正的限流仍然是限流（哪怕文案里提到 billing）', () => {
    expect(
      classifyHttpFailure(429, 'Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500.')
    ).toBe('rate_limited')
    expect(classifyHttpFailure(429, 'Too many requests, please slow down.')).toBe('rate_limited')
  })

  it('无文案的 429 仍按限流处理', () => {
    expect(classifyHttpFailure(429, null)).toBe('rate_limited')
  })
})
