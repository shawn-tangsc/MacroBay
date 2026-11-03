import { describe, expect, it, vi } from 'vitest'

import { DAILY_BRIEFING_IPC_METHODS, registerDailyBriefingIpc } from './registerDailyBriefingIpc'

const service = {
  getToday: vi.fn(), list: vi.fn(), regenerate: vi.fn(), getProgress: vi.fn(), get: vi.fn(),
  listAttempts: vi.fn(), getStorageState: vi.fn(() => ({ state: 'ready' })), retryUpgrade: vi.fn(() => ({ state: 'ready' }))
} as never

function registerAll(deletePeriod?: (input: Readonly<{ date: string; periodId: string }>) => Promise<never>) {
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

  it('passes the validated date and period to the delete handler', async () => {
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 2, periodRuns: 1, sessionLinks: 3, allDone: true }))
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    await expect(handler({ date: '2026-11-03', periodId: 'default' })).resolves.toMatchObject({ editions: 1, allDone: true })
    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-03', periodId: 'default' })
  })

  it('refuses a payload that could delete another issue', async () => {
    const deletePeriod = vi.fn()
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    // Both fields are required: a missing period would delete another issue's rows.
    await expect(handler({ date: '2026-11-03' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-13-40', periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: '   ' })).rejects.toThrow('daily-briefing-invalid-request')
    expect(deletePeriod).not.toHaveBeenCalled()
  })
})
