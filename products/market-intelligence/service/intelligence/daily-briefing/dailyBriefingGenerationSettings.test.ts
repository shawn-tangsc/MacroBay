import { describe, expect, it } from 'vitest'

import {
  applyDailyBriefingGenerationSettingsPatch,
  createDefaultDailyBriefingGenerationSettings,
  dailyBriefingCutoffMinutes,
  dailyBriefingGenerationCronExpression,
  normalizeDailyBriefingGenerationSettings
} from './dailyBriefingGenerationSettings'

describe('daily briefing generation settings', () => {
  it('defaults to the 08:00 morning cutoff and the 24-hour window', () => {
    const settings = createDefaultDailyBriefingGenerationSettings('2026-10-30T00:00:00.000Z')
    expect(settings).toEqual({ generationTime: '08:00', windowHours: 24, updatedAt: '2026-10-30T00:00:00.000Z' })
    expect(dailyBriefingGenerationCronExpression(settings)).toBe('0 8 * * *')
    expect(dailyBriefingCutoffMinutes(settings.generationTime)).toBe(480)
  })

  it('derives the cron expression from the same time the cutoff uses', () => {
    expect(dailyBriefingGenerationCronExpression({ generationTime: '06:00' })).toBe('0 6 * * *')
    expect(dailyBriefingGenerationCronExpression({ generationTime: '07:30' })).toBe('30 7 * * *')
    expect(dailyBriefingGenerationCronExpression({ generationTime: '10:00' })).toBe('0 10 * * *')
    expect(dailyBriefingCutoffMinutes('07:30')).toBe(450)
  })

  it('rejects an out-of-range time, an off-step minute and an unsupported window', () => {
    const current = createDefaultDailyBriefingGenerationSettings()
    for (const generationTime of ['05:30', '11:00', '08:15', '08:01', '8:00', '', 'noon']) {
      expect(() => applyDailyBriefingGenerationSettingsPatch(current, { generationTime }, current.updatedAt))
        .toThrow('daily-briefing-generation-time-invalid')
    }
    for (const windowHours of [6, 18, 36, 72, 0, -24, 24.5]) {
      expect(() => applyDailyBriefingGenerationSettingsPatch(current, { windowHours }, current.updatedAt))
        .toThrow('daily-briefing-window-hours-invalid')
    }
  })

  it('applies a valid patch and keeps the untouched value', () => {
    const current = createDefaultDailyBriefingGenerationSettings('2026-10-30T00:00:00.000Z')
    const later = applyDailyBriefingGenerationSettingsPatch(current, { generationTime: '09:30' }, '2026-10-30T01:00:00.000Z')
    expect(later).toEqual({ generationTime: '09:30', windowHours: 24, updatedAt: '2026-10-30T01:00:00.000Z' })
    expect(applyDailyBriefingGenerationSettingsPatch(later, { windowHours: 48 }, '2026-10-30T02:00:00.000Z'))
      .toEqual({ generationTime: '09:30', windowHours: 48, updatedAt: '2026-10-30T02:00:00.000Z' })
  })

  it('repairs an unreadable stored value to the default instead of throwing', () => {
    expect(normalizeDailyBriefingGenerationSettings({ generationTime: '07:15', windowHours: 36 }, '2026-10-30T00:00:00.000Z'))
      .toEqual({ generationTime: '08:00', windowHours: 24, updatedAt: '2026-10-30T00:00:00.000Z' })
    expect(normalizeDailyBriefingGenerationSettings(undefined, '2026-10-30T00:00:00.000Z'))
      .toEqual({ generationTime: '08:00', windowHours: 24, updatedAt: '2026-10-30T00:00:00.000Z' })
  })
})
