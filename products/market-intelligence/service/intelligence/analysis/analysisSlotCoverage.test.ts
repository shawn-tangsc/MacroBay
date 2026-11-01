import { describe, expect, it } from 'vitest'

import { slotDedupeDay, slotInstantAtOrBefore, slotInstantsWithin } from './analysisSlotCoverage'

describe('slotDedupeDay', () => {
  it('uses the UTC day, so a dedupe key does not move when the reader changes time zone', () => {
    // 同一瞬间：UTC 是 11-01 23:30，东京已经是 11-02。去重键必须与设置时区无关。
    expect(slotDedupeDay('2026-11-01T23:30:00.000Z')).toBe('2026-11-01')
    expect(slotDedupeDay(new Date('2026-11-02T00:30:00.000Z'))).toBe('2026-11-02')
  })

  it('returns an empty token for an unreadable value instead of guessing today', () => {
    expect(slotDedupeDay('not-a-date')).toBe('')
  })
})

describe('slot instants follow the reader zone', () => {
  it('puts the asia open at 00:00Z for a reader in Asia/Shanghai, whatever the machine zone', () => {
    // suite 以 TZ=Asia/Shanghai 运行；这里断言的是「按传入的读者时区换算」，不是机器本地时间。
    const now = new Date('2026-11-01T12:00:00.000Z')

    const asia = slotInstantsWithin(now, 'Asia/Shanghai').find((instant) => instant.slot === 'asia')

    expect(asia?.at).toBe('2026-11-01T00:00:00.000Z')
  })

  it('finds the open a delayed run served in the reader zone', () => {
    expect(slotInstantAtOrBefore('asia', new Date('2026-11-01T01:20:00.000Z'), 'Asia/Shanghai')).toBe(
      '2026-11-01T00:00:00.000Z'
    )
    // 同一个瞬时，UTC 读者眼里的「亚洲盘 08:00」是当天 08:00Z。
    expect(slotInstantAtOrBefore('asia', new Date('2026-11-01T09:00:00.000Z'), 'UTC')).toBe(
      '2026-11-01T08:00:00.000Z'
    )
  })
})
