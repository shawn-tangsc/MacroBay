import { describe, expect, it } from 'vitest'

import { resolveBriefingTimeZone } from './intelligenceModule'

describe('resolveBriefingTimeZone', () => {
  it('uses the shell time zone the host injects', () => {
    expect(resolveBriefingTimeZone({ getTimeZone: () => 'Asia/Tokyo' })).toBe('Asia/Tokyo')
  })

  it('falls back to UTC, never to the machine zone', () => {
    expect(resolveBriefingTimeZone(undefined)).toBe('UTC')
    expect(resolveBriefingTimeZone({})).toBe('UTC')
    // 注入了就听注入的：结果不随运行机器的时区走。
    expect(resolveBriefingTimeZone({ getTimeZone: () => 'America/New_York' })).toBe('America/New_York')
  })
})
