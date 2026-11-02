import { describe, expect, it } from 'vitest'

import { instantForWallClock, minutesOfDayInTimeZone, wallClockAt } from './timeZoneClock'

describe('minutesOfDayInTimeZone', () => {
  it('reads the wall clock of the zone it is given, not of the machine', () => {
    const instant = new Date('2026-11-01T23:30:00.000Z')

    expect(minutesOfDayInTimeZone(instant, 'UTC')).toBe(23 * 60 + 30)
    expect(minutesOfDayInTimeZone(instant, 'Asia/Tokyo')).toBe(8 * 60 + 30)
    // 2026-11-01 美东已回标准时：23:30Z = 18:30 EST
    expect(minutesOfDayInTimeZone(instant, 'America/New_York')).toBe(18 * 60 + 30)
  })

  it('returns null for an unusable zone instead of pretending it is UTC', () => {
    // 「时区用不了」和「用户就在 UTC」必须可区分：混成同一个数，调用方会在错的钟点判定。
    expect(minutesOfDayInTimeZone(new Date('2026-11-01T23:30:00.000Z'), 'Mars/Olympus_Mons')).toBeNull()
    expect(minutesOfDayInTimeZone(new Date('2026-11-01T23:30:00.000Z'), '')).toBeNull()
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

describe('wallClockAt', () => {
  it('reads the instant in the zone it is given, not on the machine running it', () => {
    const instant = Date.parse('2026-11-01T03:30:00.000Z')

    expect(wallClockAt(instant, 'UTC')).toEqual({ year: 2026, month: 11, day: 1, hour: 3, minute: 30 })
    expect(wallClockAt(instant, 'Asia/Shanghai')).toEqual({ year: 2026, month: 11, day: 1, hour: 11, minute: 30 })
    // 美东 2026-11-01 的回退发生在 06:00Z，所以 03:30Z 仍是 EDT：23:30（前一天）
    expect(wallClockAt(instant, 'America/New_York')).toEqual({ year: 2026, month: 10, day: 31, hour: 23, minute: 30 })
  })

  it('pairs with instantForWallClock, so a picker can be filled and read back through one conversion', () => {
    for (const timeZone of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo']) {
      // 08:05 这类普通时刻在每个时区都只有一解，回填后必须原样读回同一个瞬时。
      const at = wallClockAt(Date.parse('2026-11-01T00:05:00.000Z'), timeZone)
      expect(at).not.toBeNull()
      expect(instantForWallClock({ timeZone, ...at! })).toEqual(new Date('2026-11-01T00:05:00.000Z'))
    }
  })

  it('returns null for an unusable zone instead of silently reading UTC', () => {
    // 与同文件另一方向的策略一致：读出来的墙上时间若退回 UTC，选择器会显示一个不存在的时刻。
    expect(wallClockAt(Date.parse('2026-11-01T00:05:00.000Z'), 'Mars/Olympus_Mons')).toBeNull()
    expect(wallClockAt(Date.parse('2026-11-01T00:05:00.000Z'), '')).toBeNull()
  })
})
