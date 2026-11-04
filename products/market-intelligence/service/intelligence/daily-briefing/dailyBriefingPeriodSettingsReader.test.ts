import { describe, expect, it, vi } from 'vitest'

import { createBriefingPeriodStore } from './dailyBriefingPeriodStore'
import { createDailyBriefingGenerationSettingsService } from './dailyBriefingGenerationSettingsService'
import { readConfiguredBriefingPeriods } from './dailyBriefingPeriodSettingsReader'

const memory = (initial: unknown) => {
  let stored = initial
  return { read: vi.fn(async () => stored), write: vi.fn(async (next) => { stored = next }) }
}

describe('period configuration reader (S7a, capability only)', () => {
  it('reads the configured periods from the period store', async () => {
    const store = createBriefingPeriodStore({
      storage: memory({ version: 1, periods: [{ id: 'default', generationTime: '08:00', windowHours: 24, language: 'zh-CN' }] }),
      defaultLanguage: () => 'zh-CN'
    })
    expect(await readConfiguredBriefingPeriods(store, 'en-US')).toMatchObject([
      { id: 'default', generationTime: '08:00', language: 'zh-CN' }
    ])
  })

  it('does not switch the settings service yet: it still reads the old global settings', async () => {
    // §11.6b: until the migration commit, a never-configured store must not answer for the reader.
    const settingsStorage = memory({ periods: [{ id: 'default', generationTime: '08:00', windowHours: 24 }], updatedAt: '2026-11-01T00:00:00.000Z' })
    const settings = createDailyBriefingGenerationSettingsService({ storage: settingsStorage as never })
    expect((await settings.getPeriods())[0]?.generationTime).toBe('08:00')
    expect(settingsStorage.write).not.toHaveBeenCalled()
  })
})
