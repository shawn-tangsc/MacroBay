import { describe, expect, it, vi } from 'vitest'

import { DAILY_BRIEFING_IPC_METHODS, registerDailyBriefingIpc } from './registerDailyBriefingIpc'

const service = {
  getToday: vi.fn(), list: vi.fn(), regenerate: vi.fn(), getProgress: vi.fn(), get: vi.fn(),
  listAttempts: vi.fn(), getStorageState: vi.fn(() => ({ state: 'ready' })), retryUpgrade: vi.fn(() => ({ state: 'ready' }))
} as never

function registerAll(deletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: string }>) => Promise<never>) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  registerDailyBriefingIpc((( _product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
    handlers.set(method, handler)
  }) as never, service, undefined, deletePeriod as never)
  return handlers
}

describe('daily briefing delete channel', () => {
  it('registers the delete method under its own name', () => {
    expect(DAILY_BRIEFING_IPC_METHODS.deletePeriod).toBe('intelligence.dailyBriefing.deletePeriod')
    expect(registerAll().has('intelligence.dailyBriefing.deletePeriod')).toBe(true)
  })

  it('forwards "read only, do not generate" and nothing else', async () => {
    const getToday = vi.fn(async () => ({ state: 'unavailable' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), getToday } as never)
    const handler = handlers.get('intelligence.dailyBriefing.getToday')!

    await handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generate: false })
    expect(getToday).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generate: false })
    // An ordinary open keeps the old shape: the flag exists only to suppress a run.
    await handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(getToday).toHaveBeenLastCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
  })

  it('passes the validated date, period and edition language to the delete handler', async () => {
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 3, allDone: true }))
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'en-US' })).resolves.toMatchObject({ editions: 1, allDone: true })
    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-03', periodId: 'default', locale: 'en-US' })
  })

  it('refuses a payload that could delete another issue', async () => {
    const deletePeriod = vi.fn()
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    // Every field is required: a missing period or language would delete another edition's rows.
    await expect(handler({ date: '2026-11-03' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-13-40', periodId: 'default', locale: 'zh-CN' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: '   ', locale: 'zh-CN' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'fr-FR' })).rejects.toThrow('daily-briefing-invalid-request')
    expect(deletePeriod).not.toHaveBeenCalled()
  })
})
