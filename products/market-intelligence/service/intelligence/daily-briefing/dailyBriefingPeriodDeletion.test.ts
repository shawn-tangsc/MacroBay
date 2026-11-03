import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingPeriodDeletion } from './dailyBriefingPeriodDeletion'

describe('daily briefing period deletion', () => {
  it('reports both sides and says it is complete', async () => {
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const links = { deletePeriod: vi.fn(async () => 3) }

    const deleted = await createDailyBriefingPeriodDeletion({ store, links })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })

    expect(deleted).toEqual({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 3, remaining: null, allDone: true })
    expect(store.deletePeriod).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
    expect(links.deletePeriod).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
  })

  it('reports a partial deletion when the session side fails, keeping what the brief side removed', async () => {
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const links = { deletePeriod: vi.fn(async () => { throw new Error('session-db-busy') }) }

    const deleted = await createDailyBriefingPeriodDeletion({ store, links })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })

    expect(deleted).toEqual({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 0, remaining: null, allDone: false })
  })

  it('still answers when the store has no deletion path, and counts nothing as removed', async () => {
    const deleted = await createDailyBriefingPeriodDeletion({
      store: {},
      links: { deletePeriod: async () => 0 }
    })({ date: '2026-11-02', periodId: 'default', locale: 'en-US' })

    expect(deleted).toEqual({ editions: 0, attempts: 0, periodRuns: 0, sessionLinks: 0, remaining: null, allDone: true })
  })
})
