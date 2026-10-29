import { describe, expect, it } from 'vitest'

import { dailyBriefingPolicy, type DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingSqliteStore } from './dailyBriefingStore'

const document = (date: string, text = '今日要点。'): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date, locale: 'zh-CN', generatedAt: `${date}T00:30:00.000Z`,
    windowStart: `${date}T00:00:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text, generatedAt: `${date}T00:30:00.000Z` },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: `${date}T00:30:00.000Z` }
})

const edition = (date: string, text?: string) => ({
  date,
  locale: 'zh-CN' as const,
  generatedAt: `${date}T00:30:00.000Z`,
  windowStart: `${date}T00:00:00.000Z`,
  windowEnd: `${date}T00:30:00.000Z`,
  document: document(date, text)
})

describe('daily briefing store', () => {
  it('puts, gets and lists within a date range', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.put(edition('2026-10-30'))
    await store.put(edition('2026-10-29'))
    await store.put(edition('2026-10-20'))

    expect((await store.get('2026-10-30', 'zh-CN'))?.document.edition.date).toBe('2026-10-30')
    const rows = await store.list('2026-10-29', '2026-10-30', 'zh-CN')
    expect(rows.map((row) => row.date)).toEqual(['2026-10-29', '2026-10-30'])
    expect(await store.get('2026-10-01', 'zh-CN')).toBeUndefined()
  })

  it('replaces the same day rather than stacking editions', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.put(edition('2026-10-30', 'first'))
    await store.put(edition('2026-10-30', 'second'))
    expect((await store.get('2026-10-30', 'zh-CN'))?.document.lede.text).toBe('second')
    expect(await store.list('2026-10-30', '2026-10-30', 'zh-CN')).toHaveLength(1)
  })

  it('prunes rows before the retention cutoff', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.put(edition('2026-10-30'))
    await store.put(edition('2026-10-16'))
    await store.prune('2026-10-17')
    expect(await store.get('2026-10-16', 'zh-CN')).toBeUndefined()
    expect(await store.get('2026-10-30', 'zh-CN')).toBeDefined()
  })

  it('refuses a document above the shared IPC/storage budget', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const huge = document('2026-10-30', 'x'.repeat(dailyBriefingPolicy.maximumBytes))
    await expect(store.put({
      date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
      windowStart: '2026-10-30T00:00:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', document: huge
    })).rejects.toThrow('daily-briefing-document-too-large')
  })

  it('keeps languages in separate rows', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.put(edition('2026-10-30'))
    await store.put({
      ...edition('2026-10-30'),
      locale: 'en-US' as const,
      document: { ...document('2026-10-30'), edition: { ...document('2026-10-30').edition, locale: 'en-US' as const } }
    })
    expect(await store.list('2026-10-30', '2026-10-30', 'zh-CN')).toHaveLength(1)
    expect(await store.list('2026-10-30', '2026-10-30', 'en-US')).toHaveLength(1)
  })
})
