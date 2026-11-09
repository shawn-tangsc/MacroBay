import { describe, expect, it, vi } from 'vitest'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { createBriefingPeriodStore } from './dailyBriefingPeriodStore'

function memoryStorage(initial: unknown = undefined) {
  let stored = initial
  return {
    read: vi.fn(async () => stored),
    write: vi.fn(async (value: unknown) => { stored = value }),
    stored: () => stored as Readonly<{ periods: readonly BriefingPeriod[] }>
  }
}

const store = (storage: ReturnType<typeof memoryStorage>, overrides: Readonly<{ defaultLanguage?: () => 'zh-CN' | 'en-US' }> = {}) =>
  createBriefingPeriodStore({
    storage,
    defaultLanguage: overrides.defaultLanguage ?? (() => 'zh-CN'),
    newId: () => 'period_new'
  })

describe('briefing period store', () => {
  it('reads a configuration that was never written as the one default period, without writing', async () => {
    const storage = memoryStorage()
    const periods = await store(storage).list()
    expect(periods).toEqual([{ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' }])
    expect(storage.write).not.toHaveBeenCalled()
    // The fallback follows the caller's interface language rather than inventing one.
    expect((await store(storage, { defaultLanguage: () => 'en-US' }).list())[0]?.language).toBe('en-US')
  })

  it('keeps a file whose periods were all deleted empty, instead of reviving a default', async () => {
    const storage = memoryStorage({ version: 1, periods: [] })
    // The reader deleted every period; showing a 07:00 row again would invent one they never made.
    expect(await store(storage).list()).toEqual([])
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('adds a period and persists the whole list', async () => {
    const storage = memoryStorage()
    const result = await store(storage).create({ generationTime: '09:00', windowHours: 12, language: 'en-US' })
    expect(result.state).toBe('saved')
    if (result.state !== 'saved') return
    expect(result.period.id).toBe('period_new')
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['default', 'period_new'])
    expect((await store(storage).list()).map((period) => period.id)).toEqual(['default', 'period_new'])
  })

  it('never writes the transitional zone field into the periods file', async () => {
    // `generationTimeZone` exists only so the older settings shape stays assignable until C15b
    // deletes it. A zone stored now would outlive the field and have no owner on the next read, so
    // no write path may put one into the file.
    const storage = memoryStorage()
    await store(storage).create({ generationTime: '09:00', windowHours: 12, language: 'en-US' })
    await store(storage).update('period_new', { generationTime: '10:00', windowHours: 24, language: 'zh-CN' })
    for (const period of storage.stored().periods) expect(period).not.toHaveProperty('generationTimeZone')
  })

  it('refuses a duplicate and names the row it collides with, leaving the file untouched', async () => {
    const storage = memoryStorage({ version: 1, periods: [{ id: 'period_a', generationTime: '07:00', windowHours: 24, language: 'zh-CN' }] })
    const result = await store(storage).create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' })
    expect(result).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-duplicate' })
    if (result.state !== 'rejected' || result.code !== 'daily-briefing-period-duplicate') return
    expect(result.conflict.id).toBe('period_a')
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('treats the implicit default as a row when checking duplicates', async () => {
    const storage = memoryStorage()
    const result = await store(storage).create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' })
    expect(result).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-duplicate' })
    if (result.state !== 'rejected' || result.code !== 'daily-briefing-period-duplicate') return
    expect(result.conflict.id).toBe('default')
  })

  it('edits one period in place: same id, neighbours untouched', async () => {
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_a', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings' },
        { id: 'period_b', generationTime: '09:00', windowHours: 12, language: 'en-US' }
      ]
    })
    const result = await store(storage).update('period_a', { generationTime: '08:00', windowHours: 48, language: 'zh-CN' })
    expect(result.state).toBe('saved')
    if (result.state !== 'saved') return
    expect(result.period.id).toBe('period_a')
    // The origin says where the row came from; editing it does not rewrite that history.
    expect(result.period.origin).toBe('legacy-settings')
    const periods = storage.stored().periods
    expect(periods.map((period) => period.id)).toEqual(['period_a', 'period_b'])
    expect(periods[1]).toEqual({ id: 'period_b', generationTime: '09:00', windowHours: 12, language: 'en-US' })
  })

  it('refuses an edit that would collide with another row, and a missing id', async () => {
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_a', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_b', generationTime: '09:00', windowHours: 12, language: 'en-US' }
      ]
    })
    const clash = await store(storage).update('period_b', { generationTime: '07:00', windowHours: 24, language: 'zh-CN' })
    expect(clash).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-duplicate' })
    if (clash.state === 'rejected' && clash.code === 'daily-briefing-period-duplicate') expect(clash.conflict.id).toBe('period_a')

    const missing = await store(storage).update('period_x', { generationTime: '08:00', windowHours: 24, language: 'zh-CN' })
    expect(missing).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-missing', id: 'period_x' })
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('rejects invalid values with the field named, and never writes them', async () => {
    const storage = memoryStorage()
    const invalidHour = await store(storage).create({ generationTime: '07:15', windowHours: 24, language: 'zh-CN' })
    expect(invalidHour).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-invalid', issue: 'generation-time' })
    const invalidWindow = await store(storage).create({ generationTime: '08:00', windowHours: 6, language: 'zh-CN' })
    expect(invalidWindow).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-invalid', issue: 'window-hours' })
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('removes one period and keeps the rest, and reports an unknown id', async () => {
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_a', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_b', generationTime: '09:00', windowHours: 12, language: 'en-US' }
      ]
    })
    const removed = await store(storage).remove('period_a')
    expect(removed).toMatchObject({ state: 'removed', id: 'period_a' })
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_b'])
    // Deleting the last one leaves a real empty configuration, not the never-configured fallback.
    await store(storage).remove('period_b')
    expect(await store(storage).list()).toEqual([])
    expect(await store(storage).remove('period_x')).toEqual({ state: 'missing', id: 'period_x' })
  })
})
