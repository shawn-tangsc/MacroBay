import { describe, expect, it } from 'vitest'

import { classifyHttpFailure } from './providerConnection'
import { summarizeUpstreamFailureBody } from './providerFailureBody'

/**
 * PLAT-62 追加：Anthropic 协议不支持（AIOnly 实测：500 + 「模型…下无渠道支持messages协议」）。
 * 优先级：rate_limited / account_balance_insufficient > protocol_unsupported > http_5xx。
 */
const aiOnlyBody = JSON.stringify({
  code: 500,
  msg: '模型 glm-4.6 下无渠道支持messages协议，请注意使用的接口协议'
})

describe('PLAT-62 protocol-unsupported provider failures', () => {
  it('classifies the AIOnly messages-protocol 500 as protocol_unsupported', () => {
    expect(classifyHttpFailure(500, aiOnlyBody)).toBe('protocol_unsupported')
    expect(classifyHttpFailure(500, '模型下无渠道支持messages协议，请注意使用的接口协议')).toBe('protocol_unsupported')
  })

  it('classifies protocol wording and 400-with-messages as protocol_unsupported', () => {
    expect(classifyHttpFailure(500, 'upstream does not support the Anthropic protocol')).toBe('protocol_unsupported')
    expect(classifyHttpFailure(400, 'messages are not supported by this channel')).toBe('protocol_unsupported')
  })

  it('keeps the documented priority above generic 5xx but below rate limit and balance', () => {
    expect(classifyHttpFailure(500, 'internal server error')).toBe('http_5xx')
    expect(classifyHttpFailure(429, 'messages protocol overloaded')).toBe('rate_limited')
    expect(classifyHttpFailure(402, 'protocol unsupported')).toBe('account_balance_insufficient')
  })

  it('summarizes the AIOnly body into one line without raw JSON', () => {
    const summary = summarizeUpstreamFailureBody(aiOnlyBody, 500)
    expect(summary.detail).toContain('HTTP 500')
    expect(summary.detail).toContain('messages协议')
    expect(summary.detail).not.toContain('{"')
    expect(summary.detail).not.toContain('"code":500')
    expect(summary.rateLimited).toBe(false)
  })
})
