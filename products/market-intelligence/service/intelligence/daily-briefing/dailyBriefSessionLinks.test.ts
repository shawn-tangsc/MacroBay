import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'

const dir = () => mkdtempSync(join(tmpdir(), 'daily-brief-sessions-'))

const link = (date: string, locale: 'zh-CN' | 'en-US' = 'zh-CN', periodId = DEFAULT_PERIOD_ID) => ({
  editionDate: date, periodId, locale, sessionId: `session-${date}-${periodId}-${locale}`,
  state: 'accepted' as const, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`
})

describe('daily brief session links', () => {
  it('deletes every language of one issue, leaves other dates alone, and is idempotent', async () => {
    const store = createDailyBriefSessionLinkStore(join(dir(), 'links.sqlite'))
    await store.put(link('2026-10-30', 'zh-CN'))
    await store.put(link('2026-10-30', 'en-US'))
    await store.put(link('2026-10-30', 'zh-CN', 'evening'))
    await store.put(link('2026-10-29', 'zh-CN'))

    expect(await store.deletePeriod('2026-10-30', DEFAULT_PERIOD_ID)).toBe(2)
    expect(await store.findBySession('session-2026-10-30-default-en-US')).toBeUndefined()
    // Another period of the same day, and another day, keep their links.
    expect(await store.findBySession('session-2026-10-30-evening-zh-CN')).toBeDefined()
    expect(await store.findBySession('session-2026-10-29-default-zh-CN')).toBeDefined()
    // Retrying the same delete is how a partial failure is finished: it returns 0, not an error.
    expect(await store.deletePeriod('2026-10-30', DEFAULT_PERIOD_ID)).toBe(0)
  })

  it('finds by edition, lists before a date and removes only selected sessions', async () => {
    const store = createDailyBriefSessionLinkStore(join(dir(), 'links.sqlite'))
    await store.put(link('2026-10-30'))
    await store.put(link('2026-10-17'))
    await store.put(link('2026-10-30', 'en-US'))
    expect((await store.listByEdition('2026-10-30', DEFAULT_PERIOD_ID, 'zh-CN'))[0]?.sessionId).toContain('zh-CN')
    expect((await store.listBefore('2026-10-18')).map((row) => row.editionDate)).toEqual(['2026-10-17'])
    await store.remove(['session-2026-10-17-default-zh-CN'])
    expect(await store.findBySession('session-2026-10-17-default-zh-CN')).toBeUndefined()
    expect(await store.findBySession('session-2026-10-30-default-en-US')).toBeDefined()
  })

  it('keeps the periods of one day apart instead of reading one edition key', async () => {
    const store = createDailyBriefSessionLinkStore(join(dir(), 'links.sqlite'))
    await store.put({ ...link('2026-10-30'), sessionId: 'morning' })
    await store.put({ ...link('2026-10-30', 'zh-CN', 'evening'), sessionId: 'evening' })
    expect((await store.listByEdition('2026-10-30', DEFAULT_PERIOD_ID, 'zh-CN')).map((row) => row.sessionId)).toEqual(['morning'])
    expect((await store.listByEdition('2026-10-30', 'evening', 'zh-CN')).map((row) => row.sessionId)).toEqual(['evening'])
  })

  it('reads rows that stored the period inside the key as the default period, numbered in creation order', async () => {
    const path = join(dir(), 'links.sqlite')
    const legacy = openSqliteDatabase(path)
    legacy.exec(`create table daily_brief_session_links (
      session_id text primary key,
      edition_key text not null,
      edition_date text not null,
      locale text not null,
      state text not null,
      created_at text not null,
      updated_at text not null
    );`)
    legacy.exec(`insert into daily_brief_session_links values
      ('s-2', '2026-10-30:zh-CN', '2026-10-30', 'zh-CN', 'failed',    '2026-10-30T01:00:00.000Z', '2026-10-30T01:00:00.000Z'),
      ('s-1', '2026-10-30:zh-CN', '2026-10-30', 'zh-CN', 'accepted',  '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z'),
      ('s-3', '2026-10-29:en-US', '2026-10-29', 'en-US', 'accepted',  '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z');`)
    legacy.close()

    const store = createDailyBriefSessionLinkStore(path)
    const first = await store.listByEdition('2026-10-30', DEFAULT_PERIOD_ID, 'zh-CN')
    expect(first.map((row) => [row.sessionId, row.attemptNo, row.state])).toEqual([['s-1', 1, 'accepted'], ['s-2', 2, 'failed']])
    expect((await store.findBySession('s-3'))?.periodId).toBe(DEFAULT_PERIOD_ID)

    // Reopening the migrated file must not number anything twice.
    const again = createDailyBriefSessionLinkStore(path)
    expect((await again.listByEdition('2026-10-30', DEFAULT_PERIOD_ID, 'zh-CN')).map((row) => row.attemptNo)).toEqual([1, 2])
  })
})
