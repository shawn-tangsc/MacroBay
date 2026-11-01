import { describe, expect, it } from 'vitest'

import { instantForWallClock, minutesOfDayInTimeZone } from './timeZoneClock'

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

describe('instantForWallClock', () => {
  it('maps an ordinary wall clock to its instant', () => {
    expect(
      instantForWallClock({ timeZone: 'Asia/Shanghai', year: 2026, month: 11, day: 1, hour: 8 })
    ).toEqual(new Date('2026-11-01T00:00:00.000Z'))
  })

  it('returns the first instant after a spring gap instead of the hour before it', () => {
    // 2026-03-08 02:30 在纽约不存在：应落到 03:00 EDT = 07:00Z（往前提会读到开盘前的数据）。
    expect(
      instantForWallClock({ timeZone: 'America/New_York', year: 2026, month: 3, day: 8, hour: 2, minute: 30 })
    ).toEqual(new Date('2026-03-08T07:00:00.000Z'))
  })

  it('returns the earlier instant for a repeated fall hour', () => {
    // 2026-11-01 01:30 在纽约出现两次：取较早的 EDT 那次 = 05:30Z。
    expect(
      instantForWallClock({ timeZone: 'America/New_York', year: 2026, month: 11, day: 1, hour: 1, minute: 30 })
    ).toEqual(new Date('2026-11-01T05:30:00.000Z'))
  })

  it('does not shift a wall clock on an ordinary day on the same zone', () => {
    expect(
      instantForWallClock({ timeZone: 'America/New_York', year: 2026, month: 3, day: 7, hour: 2, minute: 30 })
    ).toEqual(new Date('2026-03-07T07:30:00.000Z'))
  })

  it('fails closed for a bad zone instead of guessing UTC or the machine', () => {
    expect(
      instantForWallClock({ timeZone: 'Mars/Olympus_Mons', year: 2026, month: 11, day: 1, hour: 8 })
    ).toBeNull()
  })
})
