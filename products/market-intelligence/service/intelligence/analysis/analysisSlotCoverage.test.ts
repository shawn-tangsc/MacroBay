import { describe, expect, it } from 'vitest'

import { slotDedupeDay } from './analysisSlotCoverage'

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
