import { describe, expect, it, vi } from 'vitest'

import {
  applyEditionLanguageSettingsPatch,
  createDefaultEditionLanguageSettings,
  readEditionLanguageSettings,
  resolveGenerationLanguages
} from './dailyBriefingLanguageSettings'
import {
  createEditionLanguageSettingsService,
  createInMemoryEditionLanguageSettingsStorage
} from './dailyBriefingLanguageSettingsService'

const NOW = '2026-11-02T00:00:00.000Z'

describe('edition language settings', () => {
  it('defaults to following the interface, with no extra editions', () => {
    expect(createDefaultEditionLanguageSettings(NOW)).toEqual({ primary: 'follow-ui', additional: [], updatedAt: NOW })
  })

  it('has no older shape to migrate: a missing or unreadable file is the default', () => {
    expect(readEditionLanguageSettings(undefined, NOW).additional).toEqual([])
    expect(readEditionLanguageSettings('nonsense', NOW).additional).toEqual([])
    expect(readEditionLanguageSettings({ additional: ['ja-JP', 'en-US', 'en-US'] }, NOW).additional).toEqual(['en-US'])
  })

  it('rejects a language it cannot write on a save instead of dropping it', () => {
    const current = createDefaultEditionLanguageSettings(NOW)
    expect(() => applyEditionLanguageSettingsPatch(current, { additional: ['ja-JP'] }, NOW))
      .toThrow('daily-briefing-language-unsupported')
  })

  it('keeps the order the reader ticked', () => {
    const next = applyEditionLanguageSettingsPatch(
      createDefaultEditionLanguageSettings(NOW),
      { additional: ['en-US', 'zh-CN'] },
      '2026-11-02T01:00:00.000Z'
    )
    expect(next.additional).toEqual(['en-US', 'zh-CN'])
  })
})

describe('resolveGenerationLanguages', () => {
  const settings = (additional: readonly ('zh-CN' | 'en-US')[]) => ({ additional })

  it('uses the interface language as the primary and adds the ticked editions after it', () => {
    const plan = resolveGenerationLanguages({ settings: settings(['en-US']), uiLanguage: 'zh-CN' })
    expect(plan.locales).toEqual(['zh-CN', 'en-US'])
    expect(plan.primary).toEqual({ requested: 'zh-CN', used: 'zh-CN' })
    expect(plan.writeCount).toBe(2)
  })

  it('never writes the same language twice: ticking English in English writes one edition', () => {
    const plan = resolveGenerationLanguages({ settings: settings(['en-US']), uiLanguage: 'en-US' })
    expect(plan.locales).toEqual(['en-US'])
    expect(plan.writeCount).toBe(1)
  })

  it('falls back to English explicitly when the interface language is not supported', () => {
    const plan = resolveGenerationLanguages({ settings: settings([]), uiLanguage: 'ja-JP' })
    expect(plan.primary).toEqual({ requested: 'ja-JP', used: 'en-US', fallbackReason: 'ui-language-unsupported' })
    expect(plan.locales).toEqual(['en-US'])
  })
})

describe('edition language settings service', () => {
  it('reads without writing, and the plan carries the writing cost', async () => {
    const storage = createInMemoryEditionLanguageSettingsStorage({ additional: ['en-US'], updatedAt: NOW })
    const write = vi.spyOn(storage, 'write')
    const service = createEditionLanguageSettingsService({ storage, uiLanguage: () => 'zh-CN', now: () => NOW })

    const view = await service.getView()
    expect(view.settings).toEqual({ primary: 'follow-ui', additional: ['en-US'] })
    expect(view.plan.writeCount).toBe(2)
    expect(write).not.toHaveBeenCalled()
  })

  it('saves the extra editions and re-derives the plan from the current interface language', async () => {
    const storage = createInMemoryEditionLanguageSettingsStorage()
    const service = createEditionLanguageSettingsService({ storage, uiLanguage: () => 'zh-CN', now: () => NOW })

    const saved = await service.save({ additional: ['en-US'] })
    expect(saved.plan.locales).toEqual(['zh-CN', 'en-US'])
    expect(await storage.read()).toEqual({ primary: 'follow-ui', additional: ['en-US'], updatedAt: NOW })
  })
})
