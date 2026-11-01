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
    expect(await service.getView()).toEqual({ generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' })
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
    expect(await service.getView()).toEqual({ generationTime: '07:30', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 48, cronExpression: '30 7 * * *' })
  })

  it('fills a stored time with the display zone once, and never moves the moment', async () => {
    // The bare 08:05 was always read as the reader's 08:05; the migration writes which zone that
    // was, so the schedule stops following whatever the display zone happens to be.
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', windowHours: 24, updatedAt: '2026-10-30T00:00:00.000Z'
    })
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({
      storage, now: () => '2026-10-30T00:00:00.000Z', timeZone: () => 'Asia/Shanghai'
    })

    const first = await service.getView()
    expect(first).toMatchObject({ generationTime: '08:30', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null })
    expect(write).toHaveBeenCalledTimes(1)

    // Idempotent: the second read sees the zone and writes nothing.
    await service.getView()
    await service.getSettings()
    expect(write).toHaveBeenCalledTimes(1)
    expect(await storage.read()).toMatchObject({ generationTime: '08:30', generationTimeZone: 'Asia/Shanghai' })
  })

  it('reports a zone it cannot read instead of repairing it', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', windowHours: 24, updatedAt: '2026-10-30T00:00:00.000Z',
      generationTimeZone: 'Asia/Shangai' as never
    })
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, timeZone: () => 'Asia/Shanghai' })

    expect(await service.getView()).toMatchObject({
      generationTimeZone: null, generationTimeZoneInvalid: 'Asia/Shangai'
    })
    // A typo must not be silently replaced by the display zone, and must not be rewritten either.
    expect(write).not.toHaveBeenCalled()
  })

  it('re-anchors the schedule to the display zone on a save', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', windowHours: 24, generationTimeZone: 'America/New_York', updatedAt: '2026-10-30T00:00:00.000Z'
    })
    const service = createDailyBriefingGenerationSettingsService({ storage, timeZone: () => 'Asia/Shanghai' })

    const saved = await service.save({ generationTime: '09:30' })
    expect(saved).toMatchObject({ generationTime: '09:30', generationTimeZone: 'Asia/Shanghai' })
    expect(await storage.read()).toMatchObject({ generationTimeZone: 'Asia/Shanghai' })
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
    expect(await service.getView()).toEqual({ generationTime: '09:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 9 * * *' })
  })
})
