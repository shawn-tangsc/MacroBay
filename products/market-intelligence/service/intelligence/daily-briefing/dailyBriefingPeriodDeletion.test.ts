import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingPeriodDeletion } from './dailyBriefingPeriodDeletion'

describe('daily briefing period deletion', () => {
  it('reports both sides and says it is complete', async () => {
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const links = { deletePeriod: vi.fn(async () => 3) }

    const deleted = await createDailyBriefingPeriodDeletion({ store, links })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(deleted).toEqual({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 3, sessions: 0, remaining: null, allDone: true })
    expect(store.deletePeriod).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
    expect(links.deletePeriod).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
  })

  it('reports a partial deletion when the session side fails, keeping what the brief side removed', async () => {
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const links = { deletePeriod: vi.fn(async () => { throw new Error('session-db-busy') }) }

    const deleted = await createDailyBriefingPeriodDeletion({ store, links })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(deleted).toEqual({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 0, sessions: 0, remaining: null, allDone: false })
  })

  it('still answers when the store has no deletion path, and counts nothing as removed', async () => {
    const deleted = await createDailyBriefingPeriodDeletion({
      store: {},
      links: { deletePeriod: async () => 0 }
    })({ date: '2026-11-02', periodId: 'default', locale: 'en-US', entry: 'toolbar' })

    expect(deleted).toEqual({ editions: 0, attempts: 0, periodRuns: 0, sessionLinks: 0, sessions: 0, remaining: null, allDone: true })
  })

  it('deletes the writing sessions themselves, not just their links', async () => {
    // 只删连接的话，读者还能在会话列表里看到那一版的写作会话——删版次就得让它从会话列表消失。
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const listByEdition = vi.fn(async () => [{ sessionId: 's-1' }, { sessionId: 's-2' }])
    const links = { deletePeriod: vi.fn(async () => 2), listByEdition }
    const deleteAgentSessions = vi.fn(async () => undefined)

    const deleted = await createDailyBriefingPeriodDeletion({ store, links, deleteAgentSessions })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(deleteAgentSessions).toHaveBeenCalledWith(['s-1', 's-2'])
    expect(deleted.sessions).toBe(2)
    expect(deleted.allDone).toBe(true)
  })

  it('says it is partial when the session list cannot remove them', async () => {
    const store = { deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0 })) }
    const links = { deletePeriod: vi.fn(async () => 1), listByEdition: vi.fn(async () => [{ sessionId: 's-1' }]) }
    const deleteAgentSessions = vi.fn(async () => { throw new Error('session-store-busy') })

    const deleted = await createDailyBriefingPeriodDeletion({ store, links, deleteAgentSessions })({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(deleted.sessions).toBe(0)
    expect(deleted.sessionLinks).toBe(1)
    expect(deleted.allDone).toBe(false)
  })
})

/**
 * 「删除这一版」的操作记录（用户 2026-11-06 拍板）：**只记录、不还原**。
 *
 * 记四样——时间、入口、哪一版（日期+期号+语言）、成没成。不记正文、不存副本、没有恢复入口；
 * 库里那次"11/05 两版消失"查不出是谁删的，就是因为缺这一条。
 */
describe('every deletion leaves one operation record', () => {
  const now = () => '2026-11-06T06:12:49.000Z'

  it('writes when, which entry, which edition and that it succeeded', async () => {
    const recordDeleteAudit = vi.fn(async () => undefined)
    await createDailyBriefingPeriodDeletion({
      store: { deletePeriod: async () => ({ editions: 1, attempts: 0, periodRuns: 0 }) },
      links: { deletePeriod: async () => 0 },
      recordDeleteAudit, now
    })({ date: '2026-11-06', periodId: 'period_en', locale: 'en-US', entry: 'row-menu' })

    expect(recordDeleteAudit).toHaveBeenCalledTimes(1)
    expect(recordDeleteAudit).toHaveBeenCalledWith({
      at: '2026-11-06T06:12:49.000Z',
      entry: 'row-menu',
      editionDate: '2026-11-06',
      periodId: 'period_en',
      locale: 'en-US',
      outcome: 'success'
    })
  })

  it('records a partial deletion as failed, with the reason', async () => {
    const recordDeleteAudit = vi.fn(async () => undefined)
    await createDailyBriefingPeriodDeletion({
      store: { deletePeriod: async () => ({ editions: 1, attempts: 0, periodRuns: 0 }) },
      links: { deletePeriod: async () => { throw new Error('session-db-busy') } },
      recordDeleteAudit, now
    })({ date: '2026-11-06', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(recordDeleteAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', failureCode: 'delete-partial', entry: 'toolbar' }))
  })

  it('deletes even when the record cannot be written: the log is evidence, not a gate', async () => {
    const recordDeleteAudit = vi.fn(async () => { throw new Error('audit-db-busy') })
    const deleted = await createDailyBriefingPeriodDeletion({
      store: { deletePeriod: async () => ({ editions: 1, attempts: 0, periodRuns: 0 }) },
      links: { deletePeriod: async () => 0 },
      recordDeleteAudit, now
    })({ date: '2026-11-06', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })

    expect(deleted.editions).toBe(1)
  })
})
