import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod, BriefingPeriodDraft } from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingAiSettingsView } from './dailyBriefingAiSettingsService'
import { createBriefingPeriodStore, type BriefingPeriodSaveResult } from './dailyBriefingPeriodStore'
import type { DailyBriefingGenerationSettingsView } from './dailyBriefingGenerationSettingsService'
import { createDailyBriefingSettingsService } from './dailyBriefingSettingsService'

const AI_VIEW: DailyBriefingAiSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' },
  webSearchSupported: true
}

const LANGUAGE_VIEW = {
  settings: { primary: 'follow-ui' as const, additional: [] as const },
  plan: { locales: ['zh-CN' as const], primary: { requested: 'zh-CN', used: 'zh-CN' as const }, writeCount: 1 }
}

const LEGACY_VIEW: DailyBriefingGenerationSettingsView = {
  periods: [{ id: 'default', generationTime: '07:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 7 * * *' }]
}

const EVENING: BriefingPeriod = Object.freeze({ id: 'evening', generationTime: '20:00', windowHours: 12, language: 'zh-CN', origin: 'legacy-settings' })

/**
 * The old generation settings service, still constructed this commit. Nothing may call its `save`:
 * that writes the old file, which the settings page stopped reading. The guard below is the
 * criterion, and `C15c` deletes this seam together with the service.
 */
function oldGenerationSave(): DailyBriefingGenerationSettingsView {
  return LEGACY_VIEW
}

const SAVED: BriefingPeriodSaveResult = Object.freeze({ state: 'saved', period: EVENING, periods: Object.freeze([EVENING]) })

function deps(periods: Readonly<{
  list: (locale: DailyBriefingLocale) => Promise<readonly BriefingPeriod[]>
  update?: (id: string, draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
  create?: (draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
}>) {
  return {
    ai: { getView: vi.fn(async () => AI_VIEW), save: vi.fn(async () => AI_VIEW) },
    generation: { save: vi.fn(async () => oldGenerationSave()) },
    language: { getView: vi.fn(async () => LANGUAGE_VIEW), save: vi.fn(async () => LANGUAGE_VIEW) },
    periods: {
      list: vi.fn(periods.list),
      update: vi.fn(periods.update ?? (async () => SAVED)),
      create: vi.fn(periods.create ?? (async () => SAVED))
    },
    locale: async () => 'zh-CN' as const,
    timeZone: () => 'Asia/Shanghai'
  }
}

describe('daily briefing settings service', () => {
  it('reads the generation block from the first configured period, not the old settings file', async () => {
    const parts = deps({ list: async () => [EVENING] })
    const view = await createDailyBriefingSettingsService(parts).getView()

    expect(view.generation.periods).toEqual([
      {
        id: 'evening',
        generationTime: '20:00',
        generationTimeZone: 'Asia/Shanghai',
        generationTimeZoneInvalid: null,
        windowHours: 12,
        cronExpression: '0 20 * * *'
      }
    ])
    expect(parts.generation.save).not.toHaveBeenCalled()
  })

  it('shows the default period when the reader has none, so the page can still save', async () => {
    const parts = deps({ list: async () => [] })
    const view = await createDailyBriefingSettingsService(parts).getView()

    expect(view.generation.periods).toHaveLength(1)
    expect(view.generation.periods[0]).toMatchObject({ id: 'default', generationTime: '07:00', windowHours: 24 })
  })

  it('saves by editing the first period id, never through the old settings service', async () => {
    const parts = deps({ list: async () => [EVENING] })
    await createDailyBriefingSettingsService(parts).save({ generation: { generationTime: '21:00' } })

    expect(parts.periods.update).toHaveBeenCalledWith('evening', { generationTime: '21:00', windowHours: 12, language: 'zh-CN' })
    expect(parts.periods.create).not.toHaveBeenCalled()
    expect(parts.generation.save).not.toHaveBeenCalled()
  })

  it('creates the first period when the reader has none', async () => {
    const parts = deps({ list: async () => [] })
    await createDailyBriefingSettingsService(parts).save({ generation: { generationTime: '07:30', windowHours: 12 } })

    expect(parts.periods.create).toHaveBeenCalledWith({ generationTime: '07:30', windowHours: 12, language: 'zh-CN' })
    expect(parts.periods.update).not.toHaveBeenCalled()
    expect(parts.generation.save).not.toHaveBeenCalled()
  })

  it('a save leaves every other period and the order alone', async () => {
    let stored: readonly BriefingPeriod[] = Object.freeze([
      EVENING,
      Object.freeze({ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' })
    ])
    const store = createBriefingPeriodStore({
      storage: {
        read: async () => ({ version: 1, periods: stored }),
        write: async (value) => { stored = (value as { periods: readonly BriefingPeriod[] }).periods }
      },
      defaultLanguage: () => 'zh-CN'
    })
    const parts = deps({
      list: (locale) => store.list(locale),
      update: (id, draft) => store.update(id, draft),
      create: (draft) => store.create(draft)
    })

    const service = createDailyBriefingSettingsService(parts)
    await service.save({ generation: { generationTime: '21:00' } })

    // What the reader sees afterwards: same rows, same order, only the edited hour moved.
    expect(stored.map((period) => period.id)).toEqual(['evening', 'default'])
    expect(stored.map((period) => period.generationTime)).toEqual(['21:00', '07:00'])
    expect(stored.map((period) => period.windowHours)).toEqual([12, 24])
    expect((await service.getView()).generation.periods[0]?.generationTime).toBe('21:00')
  })
})
