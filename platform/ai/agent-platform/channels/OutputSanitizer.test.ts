import { describe, expect, it } from 'vitest'

import { sanitizeChannelOutput } from './OutputSanitizer'

describe('sanitizeChannelOutput', () => {
  it('passes clean output through unchanged', () => {
    const result = sanitizeChannelOutput('All systems operational.')

    expect(result).toEqual({
      text: 'All systems operational.',
      redacted: false
    })
  })

  it('redacts common secrets before channel delivery', () => {
    const result = sanitizeChannelOutput(
      'OpenAI: sk-proj-abcdefghijklmnopqrstuvwxyz and GitHub: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    )

    expect(result.redacted).toBe(true)
    expect(result.text).toContain('[REDACTED]')
    expect(result.text).not.toContain('sk-proj-')
    expect(result.text).not.toContain('ghp_')
  })

  it('avoids broad false positives for short or unlabeled values', () => {
    expect(sanitizeChannelOutput('password=short')).toEqual({
      text: 'password=short',
      redacted: false
    })

    expect(
      sanitizeChannelOutput('output: wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01')
    ).toEqual({
      text: 'output: wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01',
      redacted: false
    })
  })

  it('keeps the delimiter that followed a redacted bearer token', () => {
    // 频道侧此前没有 bearer 用例：占位符一度把后面的空格/换行一起吃掉，两个词被并成一个。
    expect(sanitizeChannelOutput('Authorization: Bearer abcdefghijklmnopqrstuvwxyz next word').text).toBe(
      'Authorization: [REDACTED] next word'
    )
    expect(sanitizeChannelOutput('Bearer abcdefghijklmnopqrstuvwxyz\n下一行').text).toBe(
      '[REDACTED]\n下一行'
    )
  })
})
