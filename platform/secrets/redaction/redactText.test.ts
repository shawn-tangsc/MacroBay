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
