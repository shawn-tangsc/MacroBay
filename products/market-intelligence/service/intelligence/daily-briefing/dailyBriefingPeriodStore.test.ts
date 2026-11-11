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

/**
 * A storage that answers a different document after the first read: how "another writer changed the
 * file between our read and our write" looks to the store.
 */
function rewriteStorage(first: unknown, then: unknown) {
  let reads = 0
  let stored = first
  return {
    read: vi.fn(async () => {
      reads += 1
      return reads === 1 ? first : then
    }),
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

  it('keeps a row it cannot run when another row needs a language', async () => {
    // 一期缺语言触发修复；同一文件里另一期的 windowHours 越界。写回只补语言，坏行原样留在文件里
    // ——删掉它就是「读触发写入」造成的静默丢数据：读者配过的那一期会永久消失。
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_ok', generationTime: '07:00', windowHours: 24 },
        { id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN' }
      ]
    })

    const periods = await store(storage).list()

    // 这一版读不了坏行：运行期列表里没有它，文件里不许没有。
    expect(periods.map((period) => period.id)).toEqual(['period_ok'])
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_ok', 'period_bad'])
    expect(storage.stored().periods[1]).toEqual({ id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN' })
  })

  it('keeps a period another writer added while the language was being filled in', async () => {
    // 读 → 补 → 写回之间，另一个写口加了一期。写回按 id 合并，不许整表覆盖掉它。
    const before = { version: 1, periods: [{ id: 'period_ok', generationTime: '07:00', windowHours: 24 }] }
    const meanwhile = {
      version: 1,
      periods: [
        { id: 'period_ok', generationTime: '07:00', windowHours: 24 },
        { id: 'period_new', generationTime: '21:30', windowHours: 12, language: 'en-US' }
      ]
    }
    const storage = rewriteStorage(before, meanwhile)

    await store(storage).list()

    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_ok', 'period_new'])
    expect(storage.stored().periods[0]?.language).toBe('zh-CN')
  })

  it('writes a field it does not read back exactly as the file carried it', async () => {
    // 旧文件带有契约里已经没有的时区值：读的时候不解释它，写回补语言时也不许弄丢。
    const storage = memoryStorage({
      version: 1,
      periods: [{ id: 'default', generationTime: '07:00', windowHours: 24, generationTimeZone: 'Asia/Shanghai' }]
    })

    await store(storage).list()

    expect(storage.stored().periods[0]).toEqual({
      id: 'default',
      generationTime: '07:00',
      windowHours: 24,
      generationTimeZone: 'Asia/Shanghai',
      language: 'zh-CN'
    })
  })

  it('writes a created row as exactly the period’s own values', async () => {
    // 期就是四个值：id、时刻、窗口、语言。谁往写盘里多加一个字段，这里就红。
    const storage = memoryStorage()
    await store(storage).create({ generationTime: '09:00', windowHours: 12, language: 'en-US' })

    expect(Object.keys(storage.stored().periods[1] ?? {}).sort()).toEqual(['generationTime', 'id', 'language', 'windowHours'])
  })

  it('keeps a row it cannot read when the reader adds a period', async () => {
    // 读不懂不等于不存在：加一期是保存动作，不是销毁动作。坏行留在文件里，只是这一版显示不出来。
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_ok', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN', kept: 'verbatim' }
      ]
    })

    const result = await store(storage).create({ generationTime: '12:30', windowHours: 12, language: 'en-US' })

    expect(result.state).toBe('saved')
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_ok', 'period_bad', 'period_new'])
    expect(storage.stored().periods[1]).toEqual({ id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN', kept: 'verbatim' })
    // 返回给界面的是它看得见的那几行：保留了，但这一版读不懂，不能假装已经显示出来。
    if (result.state === 'saved') expect(result.periods.map((period) => period.id)).toEqual(['period_ok', 'period_new'])
  })

  it('keeps a row it cannot read when the reader edits another one', async () => {
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_ok', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN' }
      ]
    })

    const result = await store(storage).update('period_ok', { generationTime: '08:00', windowHours: 48, language: 'zh-CN' })

    expect(result.state).toBe('saved')
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_ok', 'period_bad'])
    expect(storage.stored().periods[1]).toEqual({ id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN' })
  })

  it('keeps a row it cannot read when the reader deletes another one', async () => {
    const storage = memoryStorage({
      version: 1,
      periods: [
        { id: 'period_ok', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
        { id: 'period_bad', generationTime: '09:00', windowHours: 6, language: 'zh-CN' }
      ]
    })

    const result = await store(storage).remove('period_ok')

    expect(result.state).toBe('removed')
    expect(storage.stored().periods.map((period) => period.id)).toEqual(['period_bad'])
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
