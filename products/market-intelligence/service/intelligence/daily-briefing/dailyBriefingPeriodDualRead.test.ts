import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingAiSettingsView } from './dailyBriefingAiSettingsService'
import {
  createDailyBriefingGenerationSettingsService,
  createInMemoryDailyBriefingGenerationSettingsStorage
} from './dailyBriefingGenerationSettingsService'
import {
  createEditionLanguageSettingsService,
  createInMemoryEditionLanguageSettingsStorage
} from './dailyBriefingLanguageSettingsService'
import { createBriefingPeriodStore } from './dailyBriefingPeriodStore'
import { createDailyBriefingSettingsService } from './dailyBriefingSettingsService'

const UI_LOCALE: DailyBriefingLocale = 'zh-CN'
const NOW = '2026-11-10T00:00:00.000Z'

/**
 * The old file: two periods, and 20:00 deliberately comes first. A migration or a read that
 * "tidies" the list would show up as a different order, which the reader would see as their rows
 * jumping around.
 */
const LEGACY_SETTINGS = {
  periods: [
    { id: 'evening', generationTime: '20:00', windowHours: 12 },
    { id: 'default', generationTime: '07:00', windowHours: 24 }
  ],
  updatedAt: NOW
}

const ADDITIONAL: readonly DailyBriefingLocale[] = ['en-US']

/**
 * The period store's document, shape `{ version, periods, markers }`.
 *
 * The English rows are the old "also generate an English edition" choice, one twin per saved
 * period at the same hour and window. `markers` is present on purpose: the comparison must look at
 * `periods` only, or the document's bookkeeping would read as a difference in the reader's list.
 */
const STORE_DOCUMENT = {
  version: 1,
  periods: [
    { id: 'evening', generationTime: '20:00', windowHours: 12, language: 'zh-CN', origin: 'legacy-settings' },
    { id: 'period_legacy_evening_en-US', generationTime: '20:00', windowHours: 12, language: 'en-US', origin: 'legacy-settings' },
    { id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings' },
    { id: 'period_legacy_default_en-US', generationTime: '07:00', windowHours: 24, language: 'en-US', origin: 'legacy-settings' }
  ],
  markers: { 'migrated.legacyGlobalSettings.v1': NOW }
}

function aiStub(): { getView: () => Promise<DailyBriefingAiSettingsView>; save: () => Promise<DailyBriefingAiSettingsView> } {
  const view: DailyBriefingAiSettingsView = {
    settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
    resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' },
    webSearchSupported: true
  }
  return { getView: vi.fn(async () => view), save: vi.fn(async () => view) }
}

/** The old rows as the reader's list will read them: primary language first, then each extra. */
function expandAdditional(
  periods: readonly Readonly<{ id: string; generationTime: string; windowHours: number }>[],
  additional: readonly DailyBriefingLocale[]
): readonly Readonly<{ id: string; generationTime: string; windowHours: number; language: DailyBriefingLocale }>[] {
  const rows: { id: string; generationTime: string; windowHours: number; language: DailyBriefingLocale }[] = []
  for (const period of periods) {
    rows.push({ id: period.id, generationTime: period.generationTime, windowHours: period.windowHours, language: UI_LOCALE })
    for (const language of additional) {
      if (language === UI_LOCALE) continue
      rows.push({
        id: `period_legacy_${period.id}_${language}`,
        generationTime: period.generationTime,
        windowHours: period.windowHours,
        language
      })
    }
  }
  return rows
}

/** Only the four facts the reader sees per row; `origin` and everything else stay out of the comparison. */
function comparable(periods: readonly Readonly<{ id: string; generationTime: string; windowHours: number; language: string }>[]) {
  return periods.map((period) => ({
    id: period.id,
    generationTime: period.generationTime,
    windowHours: period.windowHours,
    language: period.language
  }))
}

describe('the period list read two ways', () => {
  it('the old settings view and the period store describe the same periods, in the same order', async () => {
    const generation = createDailyBriefingGenerationSettingsService({
      storage: createInMemoryDailyBriefingGenerationSettingsStorage(LEGACY_SETTINGS),
      now: () => NOW,
      timeZone: () => 'Asia/Shanghai'
    })
    const language = createEditionLanguageSettingsService({
      storage: createInMemoryEditionLanguageSettingsStorage({ primary: 'follow-ui', additional: ADDITIONAL, updatedAt: NOW }),
      uiLanguage: () => UI_LOCALE
    })
    const settings = createDailyBriefingSettingsService({ ai: aiStub(), generation, language })

    // The settings page's read path: `getView().generation.periods`.
    const view = await settings.getView()
    const store = createBriefingPeriodStore({
      storage: { read: async () => STORE_DOCUMENT, write: async () => undefined },
      defaultLanguage: () => UI_LOCALE
    })
    const stored = await store.list(UI_LOCALE)

    const expected = expandAdditional(view.generation.periods, view.language.settings.additional)
    // The same fixture, row by row and in order: a re-sorted or dropped row is a red test.
    expect(comparable(stored)).toEqual(comparable(expected))
    // Spelled out so a failure says which of the four facts moved, not just "arrays differ".
    expect(stored.map((period) => period.id)).toEqual(['evening', 'period_legacy_evening_en-US', 'default', 'period_legacy_default_en-US'])
    expect(stored.map((period) => period.generationTime)).toEqual(['20:00', '20:00', '07:00', '07:00'])
    expect(stored.map((period) => period.windowHours)).toEqual([12, 12, 24, 24])
    expect(stored.map((period) => period.language)).toEqual(['zh-CN', 'en-US', 'zh-CN', 'en-US'])
  })
})
