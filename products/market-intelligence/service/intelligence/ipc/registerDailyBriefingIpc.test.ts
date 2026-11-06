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

describe('the regenerate payload keeps the run\'s identity', () => {
  // 用户报的「选 8 点、跑成 7 点」：这一层曾把 periodId 与 generation 一起丢掉，服务看到的是
  // `periodId: undefined`，于是落回 default，覆盖了读者正在看的那一版。这条用例防的就是这个。
  it('passes the period, language and chosen cutoff through unchanged', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    await handler({
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
      periodId: 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf',
      generation: { asOf: '2026-11-05T00:00:00.000Z', windowHours: 24 }
    })

    expect(regenerate).toHaveBeenCalledWith({
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
      periodId: 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf',
      generation: { asOf: '2026-11-05T00:00:00.000Z', windowHours: 24 }
    })
  })

  it('refuses a malformed cutoff instead of silently dropping it', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    // 静默丢弃正是这次的事故形态：读者选的时刻不见了，跑出来的还是别的期。
    await expect(handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generation: { asOf: 'tomorrowish' } }))
      .rejects.toThrow('daily-briefing-invalid-request')
    expect(regenerate).not.toHaveBeenCalled()
  })
})

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
    // 入口必填：操作记录要能回答"从哪删的"（用户 2026-11-06），缺了直接拒。
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'en-US', entry: 'toolbar' })).resolves.toMatchObject({ editions: 1, allDone: true })
    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-03', periodId: 'default', locale: 'en-US', entry: 'toolbar' })
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'en-US' })).rejects.toThrow('daily-briefing-invalid-request')
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
