import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'

const dir = () => mkdtempSync(join(tmpdir(), 'daily-brief-sessions-'))
const link = (date: string, locale: 'zh-CN' | 'en-US' = 'zh-CN') => ({
  editionKey: `${date}:${locale}`, sessionId: `session-${date}-${locale}`, editionDate: date, locale,
  state: 'accepted' as const, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`
})

describe('daily brief session links', () => {
  it('finds by edition, lists before a date and removes only selected sessions', async () => {
    const store = createDailyBriefSessionLinkStore(join(dir(), 'links.sqlite'))
    await store.put(link('2026-10-30'))
    await store.put(link('2026-10-17'))
    await store.put(link('2026-10-18', 'en-US'))
    expect((await store.find('2026-10-30:zh-CN'))?.sessionId).toContain('2026-10-30')
    expect((await store.listBefore('2026-10-18')).map((row) => row.editionDate)).toEqual(['2026-10-17'])
    await store.remove(['session-2026-10-17-zh-CN'])
    expect(await store.find('2026-10-17:zh-CN')).toBeUndefined()
    expect(await store.find('2026-10-18:en-US')).toBeDefined()
  })
})
