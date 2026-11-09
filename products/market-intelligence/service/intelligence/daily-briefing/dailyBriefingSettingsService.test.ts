import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingAiSettingsView } from './dailyBriefingAiSettingsService'
import type { DailyBriefingGenerationSettingsView } from './dailyBriefingGenerationSettingsService'
import { createDailyBriefingSettingsService } from './dailyBriefingSettingsService'

function deps() {
  const aiView: DailyBriefingAiSettingsView = {
    settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
    resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' },
    // 这个模型能不能吃服务端搜索工具：界面据此决定授不授权，缺了就不是一个完整的设置视图。
    webSearchSupported: true
  }
  // 生成设置现在按「期」给：派生值（cron、时区是否可用）只在每期里说一次。
  const generationView: DailyBriefingGenerationSettingsView = {
    periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }]
  }
  const languageView = {
    settings: { primary: 'follow-ui' as const, additional: [] as const },
    plan: { locales: ['zh-CN' as const], primary: { requested: 'zh-CN', used: 'zh-CN' as const }, writeCount: 1 }
  }
  return {
    ai: {
      getView: vi.fn(async () => aiView),
      save: vi.fn(async () => aiView)
    },
    generation: {
      getView: vi.fn(async () => generationView),
      save: vi.fn(async () => generationView)
    },
    language: {
      getView: vi.fn(async () => languageView),
      save: vi.fn(async () => languageView)
    }
  }
}

describe('daily briefing settings service', () => {
  it('exposes the AI preference and the generation setting as separate blocks', async () => {
    const parts = deps()
    const service = createDailyBriefingSettingsService(parts)
    const view = await service.getView()
    expect(view.settings.editorialEnabled).toBe(true)
    expect(view.generation).toEqual({ periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] })
    expect(view.resolved).toEqual({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default' })
    expect(view.language.plan.writeCount).toBe(1)
  })

  it('saves one block without rewriting the other', async () => {
    const parts = deps()
    const service = createDailyBriefingSettingsService(parts)

    await service.save({ generation: { generationTime: '07:30', windowHours: 48 } })
    expect(parts.generation.save).toHaveBeenCalledWith({ generationTime: '07:30', windowHours: 48 })
    expect(parts.ai.save).not.toHaveBeenCalled()

    await service.save({ editorialEnabled: false, webSearchEnabled: true })
    expect(parts.ai.save).toHaveBeenCalledWith({ editorialEnabled: false, webSearchEnabled: true })
    expect(parts.generation.save).toHaveBeenCalledTimes(1)
    expect(parts.language.save).not.toHaveBeenCalled()

    await service.save({ language: { additional: ['en-US'] } })
    expect(parts.language.save).toHaveBeenCalledWith({ additional: ['en-US'] })
    expect(parts.generation.save).toHaveBeenCalledTimes(1)
    expect(parts.ai.save).toHaveBeenCalledTimes(1)
  })
})
