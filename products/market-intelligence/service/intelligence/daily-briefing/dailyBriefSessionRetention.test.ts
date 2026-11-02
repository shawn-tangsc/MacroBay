import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { dailyBriefSessionRetentionPolicy, pruneDailyBriefSessions } from './dailyBriefSessionRetention'

const link = (date: string) => ({ editionDate: date, periodId: DEFAULT_PERIOD_ID, sessionId: `s-${date}`, locale: 'zh-CN' as const, state: 'accepted' as const, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z` })

describe('daily brief session retention', () => {
  it('deletes only sessions before the session window and keeps links on failure', async () => {
    const links = createDailyBriefSessionLinkStore(':memory:')
    await links.put(link('2026-10-23'))
    await links.put(link('2026-10-24'))
    await links.put(link('2026-10-30'))
    const remove = vi.fn(async () => undefined)
    const result = await pruneDailyBriefSessions({ links, deleteSessions: remove, today: '2026-10-30' })
    expect(result).toEqual({ removed: 1, failed: false })
    expect(remove).toHaveBeenCalledWith(['s-2026-10-23'])
    expect((await links.listByEdition('2026-10-24', DEFAULT_PERIOD_ID, 'zh-CN')).length).toBe(1)
    await links.put(link('2026-10-22'))
    const failed = await pruneDailyBriefSessions({ links, deleteSessions: vi.fn(async () => { throw new Error('x') }), today: '2026-10-30' })
    expect(failed.failed).toBe(true)
    expect((await links.listByEdition('2026-10-22', DEFAULT_PERIOD_ID, 'zh-CN')).length).toBe(1)
  })

  /**
   * The session window is what makes the tombstone visible: an attempt row lives fourteen days, so
   * cleaning sessions seven days in leaves a week in which the history rail can still say the
   * attempt was cleaned up. Equal windows would delete the row in the same pass as the session.
   */
  it('cleans sessions earlier than the edition window, so a cleaned attempt can still be seen', () => {
    expect(dailyBriefSessionRetentionPolicy.days).toBeLessThan(14)
  })
})
