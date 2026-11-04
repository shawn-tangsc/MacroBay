import { describe, expect, it } from 'vitest'

import {
  briefingPeriodConflict,
  briefingPeriodDraftIssue,
  readBriefingPeriods
} from './dailyBriefingPeriodValidation'

describe('briefing period validation', () => {
  it('accepts the three values the rest of the brief already understands', () => {
    expect(briefingPeriodDraftIssue({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' })).toBeUndefined()
    expect(briefingPeriodDraftIssue({ generationTime: '09:30', windowHours: 48, language: 'en-US' })).toBeUndefined()
  })

  it('names the field that is wrong instead of a general failure', () => {
    expect(briefingPeriodDraftIssue({ generationTime: '07:15', windowHours: 24, language: 'zh-CN' })).toBe('generation-time')
    expect(briefingPeriodDraftIssue({ generationTime: '07:00', windowHours: 6, language: 'zh-CN' })).toBe('window-hours')
    expect(briefingPeriodDraftIssue({ generationTime: '07:00', windowHours: 24, language: 'ja-JP' })).toBe('language')
  })

  it('points at the row a duplicate would collide with, and only when all three match', () => {
    const existing = Object.freeze({ id: 'period_a', generationTime: '07:00', windowHours: 24 as const, language: 'zh-CN' as const })
    expect(briefingPeriodConflict([existing], { generationTime: '07:00', windowHours: 24, language: 'zh-CN' })?.id).toBe('period_a')
    // Same hour, one value different: two legitimate periods.
    expect(briefingPeriodConflict([existing], { generationTime: '07:00', windowHours: 4 as unknown as 24, language: 'zh-CN' })).toBeUndefined()
    expect(briefingPeriodConflict([existing], { generationTime: '07:00', windowHours: 24, language: 'en-US' })).toBeUndefined()
    expect(briefingPeriodConflict([existing], { generationTime: '08:00', windowHours: 24, language: 'zh-CN' })).toBeUndefined()
    // Editing a row must ignore itself, otherwise saving it unchanged would collide.
    expect(briefingPeriodConflict([existing], { generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, 'period_a')).toBeUndefined()
  })

  it('reads the stored file and refuses rows this build cannot run', () => {
    const periods = readBriefingPeriods({
      version: 1,
      periods: [
        { id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings' },
        { id: 'period_b', generationTime: '09:00', windowHours: 12, language: 'en-US' },
        // An hour outside the table, a bad window and a missing id are dropped, not repaired into
        // 07:00: silently moving a real schedule is worse than not loading it.
        { id: 'period_bad', generationTime: '07:15', windowHours: 24, language: 'zh-CN' },
        { id: 'period_bad2', generationTime: '07:00', windowHours: 6, language: 'zh-CN' },
        { generationTime: '08:00', windowHours: 24, language: 'zh-CN' },
        // Two rows with one id cannot both be addressed: the first wins.
        { id: 'period_b', generationTime: '10:00', windowHours: 24, language: 'zh-CN' }
      ]
    })
    expect(periods.map((period) => period.id)).toEqual(['default', 'period_b'])
    expect(periods[0]?.origin).toBe('legacy-settings')
    expect(periods[1]?.generationTime).toBe('09:00')
  })

  it('reads an older or empty file as no periods', () => {
    expect(readBriefingPeriods(undefined)).toEqual([])
    expect(readBriefingPeriods({})).toEqual([])
    expect(readBriefingPeriods({ periods: [] })).toEqual([])
    expect(readBriefingPeriods(null)).toEqual([])
  })
})
