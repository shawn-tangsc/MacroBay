import { describe, expect, it, vi } from 'vitest'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { pruneDailyBriefSessions } from './dailyBriefSessionRetention'

const link = (date: string) => ({ editionKey: `${date}:zh-CN`, sessionId: `s-${date}`, editionDate: date, locale: 'zh-CN' as const, state: 'accepted' as const, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z` })

describe('daily brief session retention', () => {
  it('deletes only sessions before the 14-day window and keeps links on failure', async () => {
    const links = createDailyBriefSessionLinkStore(':memory:')
    await links.put(link('2026-10-16'))
    await links.put(link('2026-10-17'))
    await links.put(link('2026-10-30'))
    const remove = vi.fn(async () => undefined)
    const result = await pruneDailyBriefSessions({ links, deleteSessions: remove, today: '2026-10-30' })
    expect(result).toEqual({ removed: 1, failed: false })
    expect(remove).toHaveBeenCalledWith(['s-2026-10-16'])
    expect((await links.listByEdition('2026-10-17:zh-CN')).length).toBe(1)
    await links.put(link('2026-10-15'))
    const failed = await pruneDailyBriefSessions({ links, deleteSessions: vi.fn(async () => { throw new Error('x') }), today: '2026-10-30' })
    expect(failed.failed).toBe(true)
    expect((await links.listByEdition('2026-10-15:zh-CN')).length).toBe(1)
  })
})
