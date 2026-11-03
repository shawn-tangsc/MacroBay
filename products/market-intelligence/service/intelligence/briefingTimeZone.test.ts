import { describe, expect, it } from 'vitest'

import { resolveBriefingTimeZone } from './daily-briefing/readerTimeZone'

describe('resolveBriefingTimeZone', () => {
  it('uses the shell time zone the host injects, never the machine zone', () => {
    expect(resolveBriefingTimeZone({ getTimeZone: () => 'Asia/Tokyo' })).toBe('Asia/Tokyo')
    // 注入了就听注入的：结果不随运行机器的时区走。
    expect(resolveBriefingTimeZone({ getTimeZone: () => 'America/New_York' })).toBe('America/New_York')
  })

  it('throws when the host injects no hook, instead of claiming UTC', () => {
    // 缺 hook 曾一路回落到 UTC，于是每台机器都被当成 UTC 读者、界面却说着另一个时区。
    // 现在缺了就是响亮的失败，不再给出一个看起来合理的值。
    expect(() => resolveBriefingTimeZone(undefined)).toThrow('reader-time-zone-hook-missing')
    expect(() => resolveBriefingTimeZone({})).toThrow('reader-time-zone-hook-missing')
  })
})
