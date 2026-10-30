import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingSettingsService } from './dailyBriefingSettingsService'

function deps() {
  const aiView = {
    settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
    resolved: { state: 'agent' as const, providerId: 'p', modelId: 'm', source: 'default' as const }
  }
  const generationView = { generationTime: '08:00', windowHours: 24 as const, cronExpression: '0 8 * * *' }
  return {
    ai: {
      getView: vi.fn(async () => aiView),
      save: vi.fn(async () => aiView)
    },
    generation: {
      getView: vi.fn(async () => generationView),
      save: vi.fn(async () => generationView)
    }
  }
}

describe('daily briefing settings service', () => {
  it('exposes the AI preference and the generation setting as separate blocks', async () => {
    const parts = deps()
    const service = createDailyBriefingSettingsService(parts)
    const view = await service.getView()
    expect(view.settings.editorialEnabled).toBe(true)
    expect(view.generation).toEqual({ generationTime: '08:00', windowHours: 24, cronExpression: '0 8 * * *' })
    expect(view.resolved).toEqual({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default' })
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
  })
})
