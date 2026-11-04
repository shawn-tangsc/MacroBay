import { describe, expect, it } from 'vitest'

import { migrateLegacyBriefingSettings } from './dailyBriefingSettingsMigration'

const legacy = (overrides: Partial<Parameters<typeof migrateLegacyBriefingSettings>[0]['legacy']> = {}) => ({
  generationTime: '07:00', windowHours: 24, primaryLocale: 'zh-CN', additionalLocales: [], uiLocale: 'zh-CN', ...overrides
})

describe('legacy settings migration (pure)', () => {
  it('produces exactly one default period when English was not requested', () => {
    const result = migrateLegacyBriefingSettings({ legacy: legacy() })
    expect(result.outcome).toBe('one')
    expect(result.periods).toEqual([{ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings' }])
  })

  it('produces two periods at the same time and window, with distinct ids and languages', () => {
    const result = migrateLegacyBriefingSettings({ legacy: legacy({ additionalLocales: ['en-US'] }) })
    expect(result.outcome).toBe('two')
    expect(result.periods.map((period) => period.language)).toEqual(['zh-CN', 'en-US'])
    expect(result.periods.map((period) => period.generationTime)).toEqual(['07:00', '07:00'])
    expect(result.periods[0]?.id).toBe('default')
    expect(new Set(result.periods.map((period) => period.id)).size).toBe(2)
  })

  it('produces one period (not two) when the interface is already English and English was requested', () => {
    const result = migrateLegacyBriefingSettings({ legacy: legacy({ primaryLocale: 'en-US', uiLocale: 'en-US', additionalLocales: ['en-US'] }) })
    expect(result.outcome).toBe('legacy-english-only')
    expect(result.periods).toHaveLength(1)
    expect(result.periods[0]?.language).toBe('en-US')
  })

  it('writes concrete languages only, and keeps the old time and window verbatim', () => {
    const result = migrateLegacyBriefingSettings({ legacy: legacy({ generationTime: '08:00', windowHours: 12, additionalLocales: ['en-US'] }) })
    for (const period of result.periods) {
      expect(period.language === 'zh-CN' || period.language === 'en-US').toBe(true)
      expect(period.generationTime).toBe('08:00')
      expect(period.windowHours).toBe(12)
    }
  })
})
