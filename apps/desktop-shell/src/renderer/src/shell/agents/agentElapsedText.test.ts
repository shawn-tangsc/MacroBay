import { describe, expect, it } from 'vitest'

import { formatAgentElapsed } from './agentElapsedText'

describe('formatAgentElapsed', () => {
  it('formats elapsed time in Chinese below and above one minute', () => {
    expect(formatAgentElapsed(12_000, 'zh-CN')).toBe('12 秒')
    expect(formatAgentElapsed(65_000, 'zh-CN')).toBe('1 分 5 秒')
  })

  it('formats elapsed time in English below and above one minute', () => {
    expect(formatAgentElapsed(12_000, 'en-US')).toBe('12s')
    expect(formatAgentElapsed(65_000, 'en-US')).toBe('1m 5s')
  })
})
