import { describe, expect, it } from 'vitest'

import { CJK_TOKENS_PER_CHAR, OTHER_TOKENS_PER_CHAR, estimateTokens } from './tokenEstimate'

describe('token estimate', () => {
  it('charges one token per CJK character', () => {
    expect(CJK_TOKENS_PER_CHAR).toBe(1)
    expect(estimateTokens('中文测试')).toBe(4)
    expect(estimateTokens('观潮会话上下文')).toBe(7)
  })

  it('charges roughly one token per three non-CJK characters', () => {
    expect(OTHER_TOKENS_PER_CHAR).toBe(1 / 3)
    expect(estimateTokens('abcd')).toBe(2)
    expect(estimateTokens('a'.repeat(30))).toBe(10)
  })

  it('weights a mixed string by character class instead of by length', () => {
    // 8 个字符，其中 4 个是汉字：4 + ceil(4/3) = 6；按旧的 `长度/2.5` 只会得到 4，中文会被算小。
    expect(estimateTokens('中文测试abcd')).toBe(6)
  })

  it('counts empty text as zero', () => {
    expect(estimateTokens('')).toBe(0)
  })
})
