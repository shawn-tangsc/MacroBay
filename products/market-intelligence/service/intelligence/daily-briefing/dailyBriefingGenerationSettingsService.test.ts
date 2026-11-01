import { describe, expect, it, vi } from 'vitest'

import {
  createDailyBriefingGenerationSettingsService,
  createInMemoryDailyBriefingGenerationSettingsStorage
} from './dailyBriefingGenerationSettingsService'

describe('daily briefing generation settings service', () => {
  it('serves the default view when nothing has been saved', async () => {
    const service = createDailyBriefingGenerationSettingsService({
      storage: createInMemoryDailyBriefingGenerationSettingsStorage(),
      now: () => '2026-10-30T00:00:00.000Z'
    })
    expect(await service.getView()).toEqual({ generationTime: '08:00', windowHours: 24, cronExpression: '0 8 * * *' })
  })

  it('saves a valid change, persists it and notifies the scheduler', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage()
    const onSaved = vi.fn()
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => '2026-10-30T00:00:00.000Z', onSaved })

    await service.save({ generationTime: '07:30', windowHours: 48 })

    expect(onSaved).toHaveBeenCalledWith({
      generationTime: '07:30',
      windowHours: 48,
      updatedAt: '2026-10-30T00:00:00.000Z'
    })
    expect(await storage.read()).toMatchObject({ generationTime: '07:30', windowHours: 48 })
    expect(await service.getView()).toEqual({ generationTime: '07:30', windowHours: 48, cronExpression: '30 7 * * *' })
  })

  it('rejects an invalid value without writing or rescheduling', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage()
    const onSaved = vi.fn()
    const service = createDailyBriefingGenerationSettingsService({ storage, onSaved })

    await expect(service.save({ generationTime: '11:30' })).rejects.toThrow('daily-briefing-generation-time-invalid')
    await expect(service.save({ windowHours: 36 })).rejects.toThrow('daily-briefing-window-hours-invalid')
    expect(onSaved).not.toHaveBeenCalled()
    expect(await storage.read()).toBeUndefined()
    expect((await service.getView()).windowHours).toBe(24)
  })

  it('trims a partially written settings file to the supported values', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '09:00',
      windowHours: 36 as never,
      updatedAt: '2026-10-30T00:00:00.000Z'
    })
    const service = createDailyBriefingGenerationSettingsService({ storage })
    expect(await service.getView()).toEqual({ generationTime: '09:00', windowHours: 24, cronExpression: '0 9 * * *' })
  })
})
