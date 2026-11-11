import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingAiSettingsView } from './dailyBriefingAiSettingsService'
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

function deps() {
  return {
    ai: { getView: vi.fn(async () => AI_VIEW), save: vi.fn(async () => AI_VIEW) },
    language: { getView: vi.fn(async () => LANGUAGE_VIEW), save: vi.fn(async () => LANGUAGE_VIEW) }
  }
}

describe('daily briefing settings service', () => {
  it('exposes the AI preference and the language plan as the only two blocks', async () => {
    const parts = deps()
    const view = await createDailyBriefingSettingsService(parts).getView()

    expect(view.settings.editorialEnabled).toBe(true)
    expect(view.language.plan.writeCount).toBe(1)
    expect(view.resolved).toEqual({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default' })
    // The period list is not part of this surface any more: it has its own store and IPC methods,
    // and a second copy here could only disagree with the schedule.
    expect(Object.keys(view).sort()).toEqual(['language', 'resolved', 'settings', 'webSearchSupported'])
  })

  it('saves one block without rewriting the other', async () => {
    const parts = deps()
    const service = createDailyBriefingSettingsService(parts)

    await service.save({ editorialEnabled: false, webSearchEnabled: true })
    expect(parts.ai.save).toHaveBeenCalledWith({ editorialEnabled: false, webSearchEnabled: true })
    expect(parts.language.save).not.toHaveBeenCalled()

    await service.save({ language: { additional: ['en-US'] } })
    expect(parts.language.save).toHaveBeenCalledWith({ additional: ['en-US'] })
    expect(parts.ai.save).toHaveBeenCalledTimes(1)
  })
})
