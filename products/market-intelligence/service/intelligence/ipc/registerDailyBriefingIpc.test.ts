import { describe, expect, it, vi } from 'vitest'

import { registerDailyBriefingIpc, DAILY_BRIEFING_IPC_METHODS } from './registerDailyBriefingIpc'

const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
const register = ((_productId: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
  handlers.set(method, handler)
}) as never

const service = {
  getToday: vi.fn(async () => ({ state: 'available' as const, document: {} as never })),
  list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [] } })),
  get: vi.fn(async () => ({ state: 'missing' as const }))
}

registerDailyBriefingIpc(register, service)

describe('daily briefing IPC', () => {
  it('forwards a valid query', async () => {
    await handlers.get(DAILY_BRIEFING_IPC_METHODS.getToday)!({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(service.getToday).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    await handlers.get(DAILY_BRIEFING_IPC_METHODS.list)!({ locale: 'en-US', timeZone: 'UTC' })
    expect(service.list).toHaveBeenCalledWith({ locale: 'en-US', timeZone: 'UTC' })
  })

  it('forwards a valid dated read', async () => {
    await handlers.get(DAILY_BRIEFING_IPC_METHODS.get)!({ date: '2026-10-30', locale: 'zh-CN' })
    expect(service.get).toHaveBeenCalledWith({ date: '2026-10-30', locale: 'zh-CN' })
  })

  it('rejects an unknown locale, a missing zone or a non-canonical date', async () => {
    await expect(handlers.get(DAILY_BRIEFING_IPC_METHODS.getToday)!({ locale: 'en-GB', timeZone: 'UTC' }))
      .rejects.toThrow('daily-briefing-invalid-locale')
    await expect(handlers.get(DAILY_BRIEFING_IPC_METHODS.getToday)!({ locale: 'zh-CN' }))
      .rejects.toThrow('daily-briefing-invalid-time-zone')
    await expect(handlers.get(DAILY_BRIEFING_IPC_METHODS.get)!({ date: '2026-02-30', locale: 'zh-CN' }))
      .rejects.toThrow('daily-briefing-invalid-date')
    expect(service.get).toHaveBeenCalledTimes(1)
  })
})
