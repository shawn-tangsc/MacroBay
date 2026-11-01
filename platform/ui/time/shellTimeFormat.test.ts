
import { describe, expect, it } from 'vitest'

import { fallbackTimeZone, systemTimeZoneSetting } from '../../settings/schema/appSettings'
import {
  formatShellInstant,
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
