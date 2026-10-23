import { describe, expect, it } from 'vitest'

import {
  createDefaultAppSettings,
  fallbackTimeZone,
  isTimeZoneSetting,
  normalizeAppSettings,
  systemTimeZoneSetting,
  timeZoneIdPattern,
  type AppSettings
} from './appSettings'

describe('time zone preference', () => {
  it('follows the system time zone by default instead of pinning one', () => {
    expect(createDefaultAppSettings().timeZone).toBe(systemTimeZoneSetting)
    expect(isTimeZoneSetting(systemTimeZoneSetting)).toBe(true)
  })

  it('accepts any time zone the runtime can actually format', () => {
    for (const timeZone of ['UTC', 'Asia/Shanghai', 'America/Argentina/ComodRivadavia', 'Etc/GMT+8']) {
      expect(isTimeZoneSetting(timeZone), timeZone).toBe(true)
      expect(timeZoneIdPattern.test(timeZone), timeZone).toBe(true)
    }
    // The longest legal IANA id must not be cut by a shorter width limit than the pattern allows.
    expect('America/Argentina/ComodRivadavia'.length).toBeLessThanOrEqual(64)
  })

  it('refuses a value that is not a time zone', () => {
    expect(isTimeZoneSetting('Mars/Olympus')).toBe(false)
    expect(isTimeZoneSetting('')).toBe(false)
    expect(isTimeZoneSetting('x'.repeat(65))).toBe(false)
    expect(isTimeZoneSetting('Asia/Shanghai;rm -rf')).toBe(false)
    expect(isTimeZoneSetting(undefined)).toBe(false)
    expect(isTimeZoneSetting(42)).toBe(false)
  })

  it('keeps a stored time zone and repairs a stored value that is not one', () => {
    const stored = { ...createDefaultAppSettings(), timeZone: 'Asia/Tokyo' } as AppSettings
    expect(normalizeAppSettings(stored).timeZone).toBe('Asia/Tokyo')

    const broken = { ...createDefaultAppSettings(), timeZone: 'Mars/Olympus' }
    expect(normalizeAppSettings(broken).timeZone).toBe(systemTimeZoneSetting)
  })

  it('keeps the UTC fallback named once so no consumer invents its own', () => {
    expect(fallbackTimeZone).toBe('UTC')
    expect(isTimeZoneSetting(fallbackTimeZone)).toBe(true)
  })
})
