
import { describe, expect, it } from 'vitest'

import { fallbackTimeZone, systemTimeZoneSetting } from '../../settings/schema/appSettings'
import {
  formatShellCompactInstant,
  formatShellInstant,
  formatShellTimeOfDay,
  formatShellTimeZoneLabel,
  formatShellYearMonth,
  resolveShellTimeZone,
  resolveSystemTimeZone
} from './shellTimeFormat'

describe('shell time formatting', () => {
  it('renders a UTC instant in the display time zone with its offset', () => {
    // The reported defect: `2026-10-09T03:39:13.625Z` was shown as `2026-10-09 03:39 UTC`
    // to a reader whose clock said 11:39.
    expect(formatShellInstant('2026-10-09T03:39:13.625Z', { timeZone: 'Asia/Shanghai' }))
      .toBe('2026-10-09 11:39 GMT+8')
    expect(formatShellInstant('2026-10-09T03:39:13.625Z', { timeZone: 'Asia/Shanghai', precision: 'second' }))
      .toBe('2026-10-09 11:39:13 GMT+8')
    expect(formatShellInstant('2026-10-09T03:39:13.625Z', { timeZone: 'UTC' }))
      .toBe('2026-10-09 03:39 GMT')
    expect(formatShellInstant('2026-10-09T03:39:13.625Z', { timeZone: 'America/New_York' }))
      .toBe('2026-10-08 23:39 GMT-4')
  })

  it('never invents an instant it cannot parse', () => {
    expect(formatShellInstant('not-an-instant', { timeZone: 'Asia/Shanghai' })).toBe('not-an-instant')
    expect(formatShellInstant('2026-10-09T03:39:13.625Z', { timeZone: 'Mars/Olympus' })).toBe('2026-10-09T03:39:13.625Z')
  })

  it('resolves the system setting to a formattable zone and passes an explicit one through', () => {
    expect(resolveShellTimeZone(systemTimeZoneSetting)).toBe(resolveSystemTimeZone())
    expect(resolveShellTimeZone(undefined)).toBe(resolveSystemTimeZone())
    expect(resolveShellTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
    expect(resolveSystemTimeZone().length).toBeGreaterThan(0)
  })

  it('names the zone so two same-named abbreviations cannot be confused', () => {
    expect(formatShellTimeZoneLabel('Asia/Shanghai')).toBe('GMT+8')
    // `shortOffset` names zero offset as GMT rather than UTC; that is the same instant, named once.
    expect(formatShellTimeZoneLabel('UTC')).toBe('GMT')
    expect(formatShellTimeZoneLabel('America/New_York', 'en-US', new Date('2026-01-15T00:00:00.000Z'))).toBe('GMT-5')
    expect(formatShellTimeZoneLabel('Mars/Olympus')).toBe('Mars/Olympus')
  })

  it('falls back to a named zone rather than guessing one', () => {
    expect(fallbackTimeZone).toBe('UTC')
  })
})

describe('formatShellYearMonth', () => {
  it('formats the month in the display zone, not in UTC', () => {
    const instant = new Date('2026-11-30T23:30:00.000Z')

    expect(formatShellYearMonth(instant, 'UTC')).toBe('2026-11')
    // 东京此刻已是 12 月 1 日。
    expect(formatShellYearMonth(instant, 'Asia/Tokyo')).toBe('2026-12')
  })
})

/**
 * T22（runtime §15）：中心合并条、列表行与手机正文共用的紧凑时刻。
 * 四条判据：偏移正确 / 跨年不丢日期 / 坏输入原样返回 / 与 `formatShellInstant` 时刻部分逐字相同。
 */
describe('formatShellCompactInstant (T22)', () => {
  it('drops only the year and keeps the offset spelling', () => {
    expect(formatShellCompactInstant('2026-11-02T14:50:00.000Z', { timeZone: 'Asia/Shanghai' })).toBe(
      '11-02 22:50 GMT+8'
    )
    expect(formatShellCompactInstant('2026-11-02T14:50:00.000Z', { timeZone: 'UTC' })).toBe('11-02 14:50 GMT')
    // 11 月 2 日美东已过夏令时：偏移是 GMT-5。
    expect(formatShellCompactInstant('2026-11-02T14:50:00.000Z', { timeZone: 'America/New_York' })).toBe(
      '11-02 09:50 GMT-5'
    )
  })

  it('keeps the date across a year boundary', () => {
    expect(formatShellCompactInstant('2026-12-31T16:30:00.000Z', { timeZone: 'Asia/Shanghai' })).toBe(
      '01-01 00:30 GMT+8'
    )
  })

  it('returns an unparseable input unchanged instead of inventing an instant', () => {
    expect(formatShellCompactInstant('not-an-instant', { timeZone: 'Asia/Shanghai' })).toBe('not-an-instant')
    expect(formatShellCompactInstant('2026-12-31T16:30:00.000Z', { timeZone: 'Mars/Olympus' })).toBe(
      '2026-12-31T16:30:00.000Z'
    )
  })

  it('matches formatShellInstant character for character apart from the year prefix', () => {
    for (const instant of [
      '2026-11-02T14:50:00.000Z',
      '2026-12-31T16:30:00.000Z',
      '2026-01-01T00:00:00.000Z'
    ]) {
      const full = formatShellInstant(instant, { timeZone: 'Asia/Shanghai' })
      // `YYYY-` 只有 5 个字符：去掉后必须逐字相同，否则两处实现对同一个瞬时给出了两个时刻。
      expect(formatShellCompactInstant(instant, { timeZone: 'Asia/Shanghai' })).toBe(full.slice(5))
    }
  })

  it('uses the numeric offset under a non-Chinese locale too', () => {
    expect(
      formatShellCompactInstant('2026-07-15T12:00:00.000Z', { timeZone: 'America/New_York', locale: 'en-US' })
    ).toBe('07-15 08:00 GMT-4')
  })
})

describe('formatShellTimeOfDay', () => {
  it('gives the wall clock only, on the same day and on another day alike', () => {
    // 日期由调用方的分组标题表达；这里偷偷补一个 MM-DD，就会让「名字里已有这个时刻」的判定失效。
    expect(formatShellTimeOfDay('2026-11-09T20:45:00.000Z', { timeZone: 'UTC' })).toBe('20:45')
    // 换时区要换时刻、但依然不换形状：东八区是次日凌晨 04:45。
    expect(formatShellTimeOfDay('2026-11-09T20:45:00.000Z', { timeZone: 'Asia/Shanghai' })).toBe('04:45')
  })

  it('returns null for an instant it cannot read, and never throws on an unknown zone', () => {
    expect(formatShellTimeOfDay('not-an-instant', { timeZone: 'UTC' })).toBeNull()
    expect(formatShellTimeOfDay('2026-11-09T20:45:00.000Z', { timeZone: 'Mars/Olympus' })).toBeNull()
  })
})
