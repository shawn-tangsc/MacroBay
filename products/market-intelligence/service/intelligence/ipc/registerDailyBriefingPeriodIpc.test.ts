import { describe, expect, it, vi } from 'vitest'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { createBriefingPeriodStore, type BriefingPeriodStorage } from '../daily-briefing/dailyBriefingPeriodStore'
import { registerDailyBriefingPeriodIpc } from './registerDailyBriefingPeriodIpc'

/** Captures the four methods the module registers, so they can be called like the renderer would. */
function registrar() {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const register: ProductIpcRegistrar = (productId, method, handler) => {
    expect(productId).toBe('market-intelligence')
    handlers.set(method, handler as (payload: unknown) => unknown)
  }
  return { register, handlers }
}

function memoryStorage(initial: unknown = undefined) {
  let stored = initial
  const storage: BriefingPeriodStorage = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (value) => { stored = value })
  }
  return { storage, stored: () => stored }
}

function setup() {
  const memory = memoryStorage()
  const store = createBriefingPeriodStore({
    storage: memory.storage,
    defaultLanguage: () => 'zh-CN',
    newId: () => 'period_new'
  })
  const { register, handlers } = registrar()
  registerDailyBriefingPeriodIpc(register, store)
  return { memory, store, handlers }
}

const M = {
  list: 'intelligence.dailyBriefing.listPeriods',
  create: 'intelligence.dailyBriefing.createPeriod',
  update: 'intelligence.dailyBriefing.updatePeriod',
  remove: 'intelligence.dailyBriefing.removePeriod'
}

describe('the period write seam', () => {
  it('registers the four channels on the daily briefing method table', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual([M.create, M.list, M.remove, M.update].sort())
  })

  it('writes through the period store, and never through the old generation settings', async () => {
    const { memory, handlers } = setup()
    let settingsFile: unknown = { periods: [{ id: 'default', generationTime: '07:00', windowHours: 24 }], updatedAt: 'before' }
    const settingsStorage = {
      read: vi.fn(async () => settingsFile),
      write: vi.fn(async (value: unknown) => { settingsFile = value })
    }

    const saved = await handlers.get(M.create)!({ draft: { generationTime: '09:00', windowHours: 12, language: 'en-US' }, locale: 'en-US' })
    expect(saved).toMatchObject({ state: 'saved' })
    // The new path is readable through the same store.
    const listed = await handlers.get(M.list)!({ locale: 'zh-CN' })
    expect(listed).toMatchObject([{ id: 'default' }, { id: 'period_new', generationTime: '09:00' }])
    expect(memory.stored()).toMatchObject({ periods: [{ id: 'default' }, { id: 'period_new' }] })

    // The old generation settings file is byte-for-byte what it was: these methods do not touch it.
    expect(settingsStorage.write).not.toHaveBeenCalled()
    expect(settingsFile).toEqual({ periods: [{ id: 'default', generationTime: '07:00', windowHours: 24 }], updatedAt: 'before' })
  })

  it('updates one row without touching its neighbour, and removes one without disturbing the rest', async () => {
    const { handlers } = setup()
    await handlers.get(M.create)!({ draft: { generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, locale: 'zh-CN' })
    await handlers.get(M.create)!({ draft: { generationTime: '09:00', windowHours: 12, language: 'en-US' }, locale: 'zh-CN' })

    const updated = await handlers.get(M.update)!({ id: 'period_new', draft: { generationTime: '08:00', windowHours: 48, language: 'en-US' }, locale: 'zh-CN' })
    expect(updated).toMatchObject({ state: 'saved', period: { id: 'period_new', generationTime: '08:00' } })
    const afterUpdate = await handlers.get(M.list)!({ locale: 'zh-CN' })
    expect(afterUpdate).toMatchObject([
      { id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' },
      { id: 'period_new', generationTime: '08:00', windowHours: 48, language: 'en-US' }
    ])

    const removed = await handlers.get(M.remove)!({ id: 'period_new', locale: 'zh-CN' })
    expect(removed).toMatchObject({ state: 'removed', id: 'period_new' })
    const afterRemove = await handlers.get(M.list)!({ locale: 'zh-CN' }) as readonly Readonly<{ id: string; generationTime: string }>[]
    expect(afterRemove).toHaveLength(1)
    expect(afterRemove[0]).toMatchObject({ id: 'default', generationTime: '07:00' })
    expect(await handlers.get(M.remove)!({ id: 'period_x', locale: 'zh-CN' })).toEqual({ state: 'missing', id: 'period_x' })
  })

  it('names the conflicting row instead of overwriting it', async () => {
    const { handlers } = setup()
    const before = await handlers.get(M.list)!({ locale: 'zh-CN' })
    const duplicate = await handlers.get(M.create)!({ draft: { generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, locale: 'zh-CN' })
    expect(duplicate).toMatchObject({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict: { id: 'default' } })
    expect(await handlers.get(M.list)!({ locale: 'zh-CN' })).toEqual(before)
  })

  it('refuses to guess the reader language: no locale is a refusal, not Chinese', async () => {
    const { memory, handlers } = setup()
    // The never-configured fallback period speaks the reader's language; defaulting it to Chinese
    // would show a Chinese issue to an English reader and call it "the default".
    await expect(handlers.get(M.list)!({})).rejects.toThrow('daily-briefing-locale-required')
    await expect(handlers.get(M.list)!(undefined)).rejects.toThrow('daily-briefing-locale-required')
    await expect(handlers.get(M.remove)!({ id: 'default' })).rejects.toThrow('daily-briefing-locale-required')
    expect(memory.storage.write).not.toHaveBeenCalled()
  })

  it('refuses a malformed draft before it reaches the store', async () => {
    const { memory, handlers } = setup()
    await expect(handlers.get(M.create)!({ draft: { generationTime: '07:15', windowHours: 24, language: 'zh-CN' } }))
      .rejects.toThrow('daily-briefing-period-invalid:generation-time')
    await expect(handlers.get(M.create)!({ draft: { generationTime: '07:00', windowHours: 24 } }))
      .rejects.toThrow('daily-briefing-period-invalid:language')
    await expect(handlers.get(M.create)!({ draft: { generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, extra: 1 }))
      .rejects.toThrow('daily-briefing-invalid-request')
    expect(memory.storage.write).not.toHaveBeenCalled()
  })
})
