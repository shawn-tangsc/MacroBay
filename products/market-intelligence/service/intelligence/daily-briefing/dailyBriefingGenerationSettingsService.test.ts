import { describe, expect, it, vi } from 'vitest'

import {
  createDailyBriefingGenerationSettingsService,
  createInMemoryDailyBriefingGenerationSettingsStorage
} from './dailyBriefingGenerationSettingsService'

const NOW = '2026-10-30T00:00:00.000Z'

describe('daily briefing generation settings service', () => {
  it('serves the default view when nothing has been saved', async () => {
    const service = createDailyBriefingGenerationSettingsService({
      storage: createInMemoryDailyBriefingGenerationSettingsStorage(),
      now: () => NOW
    })
    expect(await service.getView()).toEqual({
      generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *',
      periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }]
    })
  })

  it('hands the scheduler the periods themselves, not a projection', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      periods: [
        { id: 'default', generationTime: '08:00', windowHours: 24 },
        { id: 'p_evening', name: 'Evening', generationTime: '09:30', generationTimeZone: 'UTC', windowHours: 12 }
      ],
      updatedAt: NOW
    })
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW })

    expect(await service.getPeriods()).toEqual([
      { id: 'default', generationTime: '08:00', windowHours: 24 },
      { id: 'p_evening', name: 'Evening', generationTime: '09:30', generationTimeZone: 'UTC', windowHours: 12 }
    ])
    // The single-period page keeps reading the first period until 4b shows the list.
    expect(await service.getView()).toMatchObject({ generationTime: '08:00', windowHours: 24 })
  })

  it('never writes while reading: the old file keeps its shape until a save', async () => {
    const stored = { generationTime: '08:30', windowHours: 24, updatedAt: NOW }
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage(stored)
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    await service.getView()
    await service.getSettings()
    await service.getPeriods()
    await service.getView()

    expect(write).not.toHaveBeenCalled()
    // Opening settings must not silently upgrade the file to the periods shape.
    expect(await storage.read()).toEqual(stored)
    // The old file reads as the one period it meant, with no zone of its own.
    expect(await service.getPeriods()).toEqual([{ id: 'default', generationTime: '08:30', windowHours: 24 }])
  })

  it('reports the reader zone for a period that carries none, without storing it', async () => {
    const stored = { generationTime: '08:30', windowHours: 24, updatedAt: NOW }
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage(stored)
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    expect(await service.getView()).toMatchObject({ generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null })
    expect(write).not.toHaveBeenCalled()
    expect(await service.getPeriods()).toEqual([{ id: 'default', generationTime: '08:30', windowHours: 24 }])
  })

  it('lets a period zone win over the reader zone', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', generationTimeZone: 'UTC', windowHours: 24, updatedAt: NOW
    })
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })
    expect(await service.getView()).toMatchObject({ generationTimeZone: 'UTC', generationTimeZoneInvalid: null })
  })

  it('reports a zone it cannot read instead of repairing it', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', generationTimeZone: 'Asia/Shangai', windowHours: 24, updatedAt: NOW
    })
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    expect(await service.getView()).toMatchObject({ generationTimeZone: null, generationTimeZoneInvalid: 'Asia/Shangai' })
    // A typo is neither replaced by the display zone nor rewritten.
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps the typo an older file stored instead of resuming silently', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', generationTimeZoneInvalid: 'Asia/Shangai', windowHours: 24, updatedAt: NOW
    })
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    // The verdict is not stored, but the value the reader typed is still theirs: the page can keep
    // saying "Asia/Shangai is not a zone, automatic generation is paused" instead of quietly
    // switching to the display zone.
    expect(await service.getView()).toMatchObject({ generationTimeZone: null, generationTimeZoneInvalid: 'Asia/Shangai' })
    expect(write).not.toHaveBeenCalled()
  })

  it('re-anchors nothing on a display-zone change: a period owns its zone', async () => {
    const stored = { generationTime: '08:30', generationTimeZone: 'Asia/Shanghai', windowHours: 24, updatedAt: NOW }
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage(stored)
    const write = vi.spyOn(storage, 'write')
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    const period = await service.reanchor('America/New_York')
    expect(period).toEqual({ id: 'default', generationTime: '08:30', generationTimeZone: 'Asia/Shanghai', windowHours: 24 })
    expect(write).not.toHaveBeenCalled()
    expect(await storage.read()).toEqual(stored)
  })

  it('upgrades the file to the periods shape on a save, once, and tells the scheduler', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      generationTime: '08:30', generationTimeZone: 'America/New_York', windowHours: 24, updatedAt: NOW
    })
    const write = vi.spyOn(storage, 'write')
    const onSaved = vi.fn()
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => '2026-10-30T01:00:00.000Z', timeZone: () => 'Asia/Shanghai', onSaved })

    const saved = await service.save({ generationTime: '09:30' })
    expect(saved).toMatchObject({ generationTime: '09:30', generationTimeZone: 'Asia/Shanghai', windowHours: 24 })

    expect(write).toHaveBeenCalledTimes(1)
    expect(await storage.read()).toEqual({
      periods: [{ id: 'default', generationTime: '09:30', generationTimeZone: 'Asia/Shanghai', windowHours: 24 }],
      updatedAt: '2026-10-30T01:00:00.000Z'
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'default', generationTime: '09:30' }))
    // Saving is the only thing that changes the shape; reading afterwards leaves it alone.
    expect(await service.getPeriods()).toHaveLength(1)
  })

  it('keeps a second period when the single-period page saves', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage({
      periods: [
        { id: 'default', generationTime: '08:00', windowHours: 24 },
        { id: 'p_evening', generationTime: '09:30', windowHours: 12 }
      ],
      updatedAt: NOW
    })
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW, timeZone: () => 'Asia/Shanghai' })

    await service.save({ generationTime: '09:00' })
    expect((await storage.read() as { periods: unknown[] }).periods).toHaveLength(2)
    expect(await service.getPeriods()).toMatchObject([
      { id: 'default', generationTime: '09:00' },
      { id: 'p_evening', generationTime: '09:30' }
    ])
  })

  it('rejects an invalid value without writing or rescheduling', async () => {
    const storage = createInMemoryDailyBriefingGenerationSettingsStorage()
    const onSaved = vi.fn()
    const service = createDailyBriefingGenerationSettingsService({ storage, onSaved, now: () => NOW })

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
      updatedAt: NOW
    })
    const service = createDailyBriefingGenerationSettingsService({ storage, now: () => NOW })
    expect(await service.getView()).toEqual({
      generationTime: '09:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 9 * * *',
      periods: [{ id: 'default', generationTime: '09:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 9 * * *' }]
    })
  })

  it('shares the one zone judgement with its callers', async () => {
    const service = createDailyBriefingGenerationSettingsService({ storage: createInMemoryDailyBriefingGenerationSettingsStorage(), now: () => NOW })
    expect(service.generationTimeZoneIssue('Asia/Shanghai')).toBeUndefined()
    expect(service.generationTimeZoneIssue('Asia/Shangai')).toBe('unparseable')
  })
})
