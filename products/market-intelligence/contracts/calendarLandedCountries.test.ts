import { describe, expect, it } from 'vitest'

import {
  CALENDAR_LANDED_COUNTRY_CODES,
  CALENDAR_LANDED_COUNTRY_SCOPES,
  DEFAULT_CALENDAR_LANDED_COUNTRIES,
  MAX_CALENDAR_LANDED_COUNTRIES,
  calendarLandedCountryMatches,
  normalizeCalendarLandedCountries,
  type CalendarLandedCountrySelection
} from './calendarLandedCountries'

const selection = (scope: CalendarLandedCountrySelection['scope'], codes: readonly string[] = []) =>
  ({ scope, codes }) as unknown as CalendarLandedCountrySelection

describe('calendar landed countries contract', () => {
  it('keeps the cap equal to the country list, so "limit 12, list 8" cannot exist', () => {
    expect(CALENDAR_LANDED_COUNTRY_CODES).toEqual(['US', 'CA', 'GB', 'DE', 'FR', 'IT', 'JP', 'CN'])
    expect(MAX_CALENDAR_LANDED_COUNTRIES).toBe(8)
    expect(MAX_CALENDAR_LANDED_COUNTRIES).toBe(CALENDAR_LANDED_COUNTRY_CODES.length)
  })

  it('has three scopes: us, all, custom — major is gone, not kept as a dead value', () => {
    expect(CALENDAR_LANDED_COUNTRY_SCOPES).toEqual(['us', 'all', 'custom'])
    expect(normalizeCalendarLandedCountries({ scope: 'major', codes: [] })).toEqual(DEFAULT_CALENDAR_LANDED_COUNTRIES)
  })

  it('defaults to US only, which is today’s behaviour', () => {
    expect(DEFAULT_CALENDAR_LANDED_COUNTRIES).toEqual({ scope: 'us', codes: [] })
    // 缺键（老文件没有这一项）与坏值都回默认，且这是「可读 + 默认」，不是读失败。
    expect(normalizeCalendarLandedCountries(undefined)).toEqual(DEFAULT_CALENDAR_LANDED_COUNTRIES)
    expect(normalizeCalendarLandedCountries({ scope: 'somewhere', codes: [] })).toEqual(DEFAULT_CALENDAR_LANDED_COUNTRIES)
    expect(normalizeCalendarLandedCountries({ scope: 'custom', codes: ['XX'] })).toEqual(DEFAULT_CALENDAR_LANDED_COUNTRIES)
    expect(normalizeCalendarLandedCountries({ scope: 'custom', codes: [] })).toEqual(DEFAULT_CALENDAR_LANDED_COUNTRIES)
    // 重复码先并成一个，所以「9 个 US」是合法的一条 custom，而不是超限；真正越界只能靠未知码。
    expect(normalizeCalendarLandedCountries({ scope: 'custom', codes: Array(9).fill('US') })).toEqual({
      scope: 'custom',
      codes: ['US']
    })
    // 名单 8 个全选仍是合法上限。
    expect(
      normalizeCalendarLandedCountries({ scope: 'custom', codes: [...CALENDAR_LANDED_COUNTRY_CODES] })
    ).toEqual({ scope: 'custom', codes: [...CALENDAR_LANDED_COUNTRY_CODES] })
  })

  it('keeps a valid custom selection, de-duplicating codes that repeat', () => {
    expect(normalizeCalendarLandedCountries({ scope: 'custom', codes: ['CN', 'US', 'CN'] })).toEqual({
      scope: 'custom',
      codes: ['CN', 'US']
    })
    // 非 custom 的范围不携带国家列表。
    expect(normalizeCalendarLandedCountries({ scope: 'all', codes: ['CN'] })).toEqual({ scope: 'all', codes: [] })
  })

  it('matches US only for the default, and never treats unknown as US', () => {
    expect(calendarLandedCountryMatches(selection('us'), 'US')).toBe(true)
    expect(calendarLandedCountryMatches(selection('us'), 'DE')).toBe(false)
    expect(calendarLandedCountryMatches(selection('us'), null)).toBe(false)
    expect(calendarLandedCountryMatches(selection('us'), '')).toBe(false)
    // GB 不认 UK：出现按未知处理，不猜。
    expect(calendarLandedCountryMatches(selection('us'), 'UK')).toBe(false)
  })

  it('includes unknown only under "all": us and custom must not swallow it', () => {
    // 库里 1962 条 NULL 就是这个输入——「中国·外汇储备」也在这一批。
    expect(calendarLandedCountryMatches(selection('all'), null)).toBe(true)
    expect(calendarLandedCountryMatches(selection('us'), null)).toBe(false)
    expect(calendarLandedCountryMatches(selection('custom', ['US', 'CN']), null)).toBe(false)
    // 「全部国家」也收名单外的具名国家；us / custom 按各自的名单收。
    expect(calendarLandedCountryMatches(selection('all'), 'BR')).toBe(true)
    expect(calendarLandedCountryMatches(selection('us'), 'BR')).toBe(false)
  })

  it('matches only the ticked codes for a custom selection', () => {
    const custom = selection('custom', ['CN', 'DE'])
    expect(calendarLandedCountryMatches(custom, 'CN')).toBe(true)
    expect(calendarLandedCountryMatches(custom, 'de')).toBe(true)
    expect(calendarLandedCountryMatches(custom, 'US')).toBe(false)
    expect(calendarLandedCountryMatches(custom, null)).toBe(false)
  })
})
