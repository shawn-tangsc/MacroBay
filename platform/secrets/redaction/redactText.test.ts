import { describe, expect, it } from 'vitest'

import { redactText } from './redactText'

/**
 * 这张模式表的「行为不变」证据是 `OutputSanitizer.test.ts`（一条断言都没改）。
 * 这里只补日志侧真正关心的三点：干净文本原样返回、常见凭据被替换、JSON 行仍然可解析。
 */
describe('redactText', () => {
  it('passes clean text through and reports no rewrite', () => {
    expect(redactText('All systems operational.')).toEqual({
      text: 'All systems operational.',
      redacted: false
    })
  })

  it('replaces provider keys and bearer tokens', () => {
    const result = redactText(
      'OpenAI: sk-proj-abcdefghijklmnopqrstuvwxyz and Authorization: Bearer abcdefghijklmnopqrstuvwxyz'
    )

    expect(result.redacted).toBe(true)
    expect(result.text).not.toContain('sk-proj-')
    expect(result.text).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(result.text).toContain('[REDACTED]')
  })

  it('keeps a JSON log line parseable after a credential field is replaced', () => {
    const line = JSON.stringify({
      level: 'error',
      event: 'provider.test',
      apiKey: 'sk-proj-0123456789abcdefghijABCDEFGHIJ'
    })

    const result = redactText(line)

    expect(result.redacted).toBe(true)
    expect(result.text).not.toContain('sk-proj-')
    expect(() => JSON.parse(result.text)).not.toThrow()
  })
})

describe('redactText keeps surrounding structure', () => {
  it('leaves the delimiter after a bearer token so lines and words do not merge', () => {
    const result = redactText('header: Bearer abcdefghijklmnop 后面还有字\n下一行')

    expect(result.redacted).toBe(true)
    expect(result.text).toBe('header: [REDACTED] 后面还有字\n下一行')
  })

  it('passes benign outbound content through byte for byte', () => {
    // Same rule as the inbound guard: a transform may only fire on an exact pattern, never tidy up.
    for (const text of [
      '今日 BTC 上涨 2.3%，情绪偏温和。',
      '家庭 👨‍👩‍👧 与国旗 🇨🇳',
      '| 指标 | 值 |\n| --- | --- |\n| 涨跌 | +2.3% |',
      'Token: 这是中文解释，不是密钥'
    ]) {
      expect(redactText(text)).toEqual({ text, redacted: false })
    }
  })
})
