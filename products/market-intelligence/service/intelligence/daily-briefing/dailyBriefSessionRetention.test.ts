import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { dailyBriefSessionRetentionPolicy, pruneDailyBriefSessions } from './dailyBriefSessionRetention'

const link = (date: string, extra: { sessionId?: string; attemptNo?: number } = {}) => ({
  editionDate: date,
  periodId: DEFAULT_PERIOD_ID,
  sessionId: extra.sessionId ?? `s-${date}`,
  locale: 'zh-CN' as const,
  ...(extra.attemptNo === undefined ? {} : { attemptNo: extra.attemptNo }),
  state: 'accepted' as const,
  createdAt: `${date}T00:00:00.000Z`,
  updatedAt: `${date}T00:00:00.000Z`
})

const now = () => '2026-10-30T08:10:00.000Z'

describe('daily brief session retention', () => {
  it('deletes only sessions before the session window and keeps links on failure', async () => {
    const links = createDailyBriefSessionLinkStore(':memory:')
    await links.put(link('2026-10-23'))
    await links.put(link('2026-10-24'))
    await links.put(link('2026-10-30'))
    const remove = vi.fn(async () => undefined)
    const result = await pruneDailyBriefSessions({ links, deleteSessions: remove, today: '2026-10-30' })
    expect(result).toEqual({ removed: 1, tombstoned: 0, deferred: false, failed: false })
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

  it('deletes the session, writes the tombstone, and removes the link last', async () => {
    const order: string[] = []
    const links = {
      listBefore: vi.fn(async () => [link('2026-10-20', { attemptNo: 2 }), link('2026-10-21')]),
      remove: vi.fn(async (ids: readonly string[]) => { order.push(`remove:${ids.join(',')}`) })
    } as never
    const result = await pruneDailyBriefSessions({
      links,
      deleteSessions: vi.fn(async (ids: string[]) => { order.push(`sessions:${ids.join(',')}`) }),
      markAttemptCleaned: vi.fn(async (input) => {
        order.push(`mark:${input.editionDate}:${input.attemptNo ?? 'none'}:${input.cleanedAt}`)
        return 1
      }),
      today: '2026-10-30',
      now
    })
    expect(result).toEqual({ removed: 2, tombstoned: 2, deferred: false, failed: false })
    expect(order).toEqual([
      'sessions:s-2026-10-20,s-2026-10-21',
      'mark:2026-10-20:2:2026-10-30T08:10:00.000Z',
      'mark:2026-10-21:none:2026-10-30T08:10:00.000Z',
      'remove:s-2026-10-20,s-2026-10-21'
    ])
  })

  it('counts a tombstone that hit no row as done, because the row may already be pruned', async () => {
    const links = {
      listBefore: vi.fn(async () => [link('2026-10-20')]),
      remove: vi.fn(async () => undefined)
    } as never
    const result = await pruneDailyBriefSessions({ links, deleteSessions: vi.fn(async () => undefined), markAttemptCleaned: vi.fn(async () => 0), today: '2026-10-30', now })
    expect(result).toEqual({ removed: 1, tombstoned: 0, deferred: false, failed: false })
  })

  it('keeps every link when the platform deletion fails, and writes no tombstone', async () => {
    const links = { listBefore: vi.fn(async () => [link('2026-10-20')]), remove: vi.fn(async () => undefined) } as never
    const markAttemptCleaned = vi.fn(async () => 1)
    const result = await pruneDailyBriefSessions({ links, deleteSessions: vi.fn(async () => { throw new Error('x') }), markAttemptCleaned, today: '2026-10-30', now })
    expect(result).toEqual({ removed: 0, tombstoned: 0, deferred: false, failed: true })
    expect(markAttemptCleaned).not.toHaveBeenCalled()
    expect((links as unknown as { remove: ReturnType<typeof vi.fn> }).remove).not.toHaveBeenCalled()
  })

  it('keeps the links without calling the run failed when the store cannot write a tombstone yet', async () => {
    // An un-upgraded database keeps `trace_json NOT NULL`, so there is nowhere to put a tombstone.
    // That is "not yet", not "the row is gone": the link has to survive so a later run can write it.
    const links = { listBefore: vi.fn(async () => [link('2026-10-20')]), remove: vi.fn(async () => undefined) } as never
    const result = await pruneDailyBriefSessions({
      links,
      deleteSessions: vi.fn(async () => undefined),
      markAttemptCleaned: vi.fn(async () => null),
      today: '2026-10-30',
      now
    })
    expect(result).toEqual({ removed: 0, tombstoned: 0, deferred: true, failed: false })
    expect((links as unknown as { remove: ReturnType<typeof vi.fn> }).remove).not.toHaveBeenCalled()
  })

  it('keeps the links when the tombstone write fails, so the next run can still write it', async () => {
    const links = { listBefore: vi.fn(async () => [link('2026-10-20'), link('2026-10-21')]), remove: vi.fn(async () => undefined) } as never
    const result = await pruneDailyBriefSessions({
      links,
      deleteSessions: vi.fn(async () => undefined),
      markAttemptCleaned: vi.fn()
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('disk')),
      today: '2026-10-30',
      now
    })
    expect(result).toEqual({ removed: 0, tombstoned: 1, deferred: false, failed: true })
    expect((links as unknown as { remove: ReturnType<typeof vi.fn> }).remove).not.toHaveBeenCalled()
  })
})
