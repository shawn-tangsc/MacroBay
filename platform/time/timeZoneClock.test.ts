import { describe, expect, it } from 'vitest'

import { minutesOfDayInTimeZone } from './timeZoneClock'

describe('minutesOfDayInTimeZone', () => {
  it('reads the wall clock of the zone it is given, not of the machine', () => {
    const instant = new Date('2026-11-01T23:30:00.000Z')

    expect(minutesOfDayInTimeZone(instant, 'UTC')).toBe(23 * 60 + 30)
    expect(minutesOfDayInTimeZone(instant, 'Asia/Tokyo')).toBe(8 * 60 + 30)
    // 2026-11-01 美东已回标准时：23:30Z = 18:30 EST
    expect(minutesOfDayInTimeZone(instant, 'America/New_York')).toBe(18 * 60 + 30)
  })

  it('falls back to UTC for an unusable zone instead of throwing', () => {
    expect(minutesOfDayInTimeZone(new Date('2026-11-01T23:30:00.000Z'), 'Mars/Olympus_Mons')).toBe(23 * 60 + 30)
  })
})
