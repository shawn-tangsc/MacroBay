import { describe, expect, it } from 'vitest'

import {
  applyDailyBriefingGenerationSettingsPatch,
  createDefaultDailyBriefingPeriodsSettings,
  dailyBriefingCutoffMinutes,
  dailyBriefingGenerationCronExpression,
  generationTimeZoneIssue,
  readDailyBriefingPeriodsSettings
} from './dailyBriefingGenerationSettings'

const NOW = '2026-10-30T00:00:00.000Z'

describe('daily briefing generation settings', () => {
  it('defaults to one period: 08:00, a 24-hour window, no zone of its own', () => {
    const settings = createDefaultDailyBriefingPeriodsSettings(NOW)
    expect(settings).toEqual({
      periods: [{ id: 'default', generationTime: '08:00', windowHours: 24 }],
      updatedAt: NOW
    })
    expect(dailyBriefingGenerationCronExpression(settings.periods[0]!)).toBe('0 8 * * *')
    expect(dailyBriefingCutoffMinutes(settings.periods[0]!.generationTime)).toBe(480)
  })

  it('derives the cron expression from the same time the cutoff uses', () => {
    expect(dailyBriefingGenerationCronExpression({ generationTime: '06:00' })).toBe('0 6 * * *')
    expect(dailyBriefingGenerationCronExpression({ generationTime: '07:30' })).toBe('30 7 * * *')
    expect(dailyBriefingGenerationCronExpression({ generationTime: '10:00' })).toBe('0 10 * * *')
    expect(dailyBriefingCutoffMinutes('07:30')).toBe(450)
  })

  it('rejects an out-of-range time, an off-step minute and an unsupported window on a save', () => {
    const current = createDefaultDailyBriefingPeriodsSettings(NOW)
    for (const generationTime of ['05:30', '11:00', '08:15', '08:01', '8:00', '', 'noon']) {
      expect(() => applyDailyBriefingGenerationSettingsPatch(current, { generationTime }, NOW))
        .toThrow('daily-briefing-generation-time-invalid')
    }
    for (const windowHours of [6, 18, 36, 72, 0, -24, 24.5]) {
      expect(() => applyDailyBriefingGenerationSettingsPatch(current, { windowHours }, NOW))
        .toThrow('daily-briefing-window-hours-invalid')
    }
    expect(() => applyDailyBriefingGenerationSettingsPatch(current, { generationTimeZone: 'Asia/Shangai' }, NOW))
      .toThrow('daily-briefing-generation-time-zone-invalid')
  })

  it('applies a valid patch to the first period and keeps every other period untouched', () => {
    const current = {
      periods: [
        { id: 'default', generationTime: '08:00', windowHours: 24 as const },
        { id: 'p_evening', name: 'Evening', generationTime: '09:30', windowHours: 12 as const, generationTimeZone: 'UTC' }
      ],
      updatedAt: NOW
    }
    const next = applyDailyBriefingGenerationSettingsPatch(current, { generationTime: '09:30' }, '2026-10-30T01:00:00.000Z')
    expect(next.periods[0]).toEqual({ id: 'default', generationTime: '09:30', windowHours: 24 })
    expect(next.periods[1]).toEqual(current.periods[1])
    expect(next.updatedAt).toBe('2026-10-30T01:00:00.000Z')
  })

  it('reads the single-period file every earlier version wrote as one period with id default', () => {
    const read = readDailyBriefingPeriodsSettings({
      generationTime: '08:30',
      generationTimeZone: 'Asia/Shanghai',
      windowHours: 48,
      updatedAt: NOW
    }, NOW)
    expect(read).toEqual({
      periods: [{ id: 'default', generationTime: '08:30', generationTimeZone: 'Asia/Shanghai', windowHours: 48 }],
      updatedAt: NOW
    })
  })

  it('ignores the old stored verdict about the zone: only the raw value and one judgement exist', () => {
    // An older file could hold the raw typo in `generationTimeZoneInvalid`. Reading it back as a
    // verdict would let a second truth outlive the value it described.
    const read = readDailyBriefingPeriodsSettings({
      generationTime: '08:30',
      generationTimeZoneInvalid: 'Asia/Shangai',
      windowHours: 24,
      updatedAt: NOW
    }, NOW)
    expect(read.periods).toEqual([{ id: 'default', generationTime: '08:30', windowHours: 24 }])
  })

  it('reads the periods shape as written, keeping order, names and per-period zones', () => {
    const read = readDailyBriefingPeriodsSettings({
      periods: [
        { id: 'default', generationTime: '08:00', windowHours: 24 },
        { id: 'p_evening', name: 'Evening', generationTime: '09:30', generationTimeZone: 'UTC', windowHours: 12 }
      ],
      updatedAt: NOW
    }, NOW)
    expect(read.periods.map((period) => period.id)).toEqual(['default', 'p_evening'])
    expect(read.periods[1]).toEqual({ id: 'p_evening', name: 'Evening', generationTime: '09:30', generationTimeZone: 'UTC', windowHours: 12 })
  })

  it('keeps a repeated or blank id deterministic instead of merging two periods', () => {
    const read = readDailyBriefingPeriodsSettings({
      periods: [
        { id: 'default', generationTime: '08:00', windowHours: 24 },
        { id: 'default', generationTime: '09:30', windowHours: 12 },
        { generationTime: '10:00', windowHours: 24 }
      ]
    }, NOW)
    // First occurrence of an id wins; a missing id means the one period every file has.
    expect(read.periods).toEqual([{ id: 'default', generationTime: '08:00', windowHours: 24 }])
  })

  it('falls back to the default schedule when nothing usable is stored', () => {
    expect(readDailyBriefingPeriodsSettings(undefined, NOW).periods).toHaveLength(1)
    expect(readDailyBriefingPeriodsSettings({ periods: [] }, NOW).periods).toHaveLength(1)
    expect(readDailyBriefingPeriodsSettings({ periods: [null, 3, 'x'] }, NOW).periods).toHaveLength(1)
    expect(readDailyBriefingPeriodsSettings({ hello: 'world' }, NOW).periods).toHaveLength(1)
  })

  it('repairs an unreadable stored value to the default instead of throwing', () => {
    const read = readDailyBriefingPeriodsSettings({ generationTime: 'noon', windowHours: 36 }, NOW)
    expect(read.periods[0]).toEqual({ id: 'default', generationTime: '08:00', windowHours: 24 })
  })
})

describe('generationTimeZoneIssue', () => {
  it('treats an absent or blank value as "follow the reader", not as a problem', () => {
    expect(generationTimeZoneIssue(undefined)).toBeUndefined()
    expect(generationTimeZoneIssue('')).toBeUndefined()
    expect(generationTimeZoneIssue('   ')).toBeUndefined()
  })

  it('accepts a zone the platform can format', () => {
    expect(generationTimeZoneIssue('Asia/Shanghai')).toBeUndefined()
    expect(generationTimeZoneIssue('UTC')).toBeUndefined()
    expect(generationTimeZoneIssue('America/New_York')).toBeUndefined()
  })

  it('reports a value it cannot read, and needs no reader zone to decide', () => {
    // The verdict is a pure function of the stored value: opening the same setting in two zones
    // must not change whether it reads as valid.
    expect(generationTimeZoneIssue('Asia/Shangai')).toBe('unparseable')
    expect(generationTimeZoneIssue('Not/AZone')).toBe('unparseable')
    // An offset is readable by the platform (and by the scheduler that formats the cron in it), so
    // it is not reported as a problem: the judgement is "can a clock be formatted in it", not
    // "is it an IANA name".
    expect(generationTimeZoneIssue('+08:00')).toBeUndefined()
  })
})
