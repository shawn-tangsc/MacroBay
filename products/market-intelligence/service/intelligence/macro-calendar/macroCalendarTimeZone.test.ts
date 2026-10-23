import { describe, expect, it } from 'vitest'

import { toUtcIsoFromOfficialEasternTime } from './macroCalendarTimeZone'

describe('toUtcIsoFromOfficialEasternTime', () => {
  it('uses America/New_York rules before and after daylight saving changes', () => {
    expect(toUtcIsoFromOfficialEasternTime('2026-03-06', '08:30')).toBe('2026-03-06T13:30:00.000Z')
    expect(toUtcIsoFromOfficialEasternTime('2026-03-13', '08:30')).toBe('2026-03-13T12:30:00.000Z')
    expect(toUtcIsoFromOfficialEasternTime('2026-10-30', '08:30')).toBe('2026-10-30T12:30:00.000Z')
    expect(toUtcIsoFromOfficialEasternTime('2026-11-06', '08:30')).toBe('2026-11-06T13:30:00.000Z')
  })
})
