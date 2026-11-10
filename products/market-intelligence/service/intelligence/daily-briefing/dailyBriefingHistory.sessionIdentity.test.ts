import { describe, expect, it } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStoredEdition } from './dailyBriefingService'
import { briefingHistorySummaries } from './dailyBriefingHistory'

/**
 * E9：会话身份是**期 × 语言**。历史列表给每一行问会话时，必须用**这一行自己的语言**，
 * 不能拿主语言去问——拿错了，英文版那一行的「打开会话」会指向中文会话，而界面上看不出来。
 *
 * 这一条只守「问谁」；「取最新正式身份」在 `dailyBriefEditorSessionPort.test.ts` 里守。
 */

const edition = (locale: DailyBriefingLocale): DailyBriefingStoredEdition => ({
  date: '2026-11-02',
  periodId: 'default',
  locale,
  generatedAt: '2026-11-02T00:00:00.000Z',
  windowStart: '2026-11-02T00:00:00.000Z',
  windowEnd: '2026-11-02T00:00:00.000Z',
  document: {
    schemaVersion: 1, policyVersion: 'daily-briefing.v1',
    edition: { date: '2026-11-02', locale, generatedAt: '2026-11-02T00:00:00.000Z', windowStart: '2026-11-02T00:00:00.000Z', windowEnd: '2026-11-02T00:00:00.000Z', timeZone: 'Asia/Shanghai' },
    status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
    lede: { source: 'template', text: '', generatedAt: '2026-11-02T00:00:00.000Z' },
    news: { items: [], macro: [], notes: {} },
    data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
    conclusion: null, next: { items: [] }, citations: [],
    provenance: { summaryId: null, readAt: '2026-11-02T00:00:00.000Z' }
  }
})

describe('the session lookup uses the row’s own language (E9)', () => {
  it('asks once per row with that row’s (date, periodId, locale) and attaches the answer to it', async () => {
    const asked: Array<{ date: string; periodId: string; locale: DailyBriefingLocale }> = []
    const editions = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [edition('zh-CN')],
      otherRows: [edition('en-US')],
      sessionId: async (date, periodId, locale) => {
        asked.push({ date, periodId, locale })
        return `session-${locale}`
      }
    })

    // 两行各问一次，各自带自己的语言（行的先后由期内的语言顺序决定，这里只钉「问的是谁」）。
    expect([...asked].sort((a, b) => a.locale.localeCompare(b.locale))).toEqual([
      { date: '2026-11-02', periodId: 'default', locale: 'en-US' },
      { date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }
    ])
    const byLocale = new Map(editions.map((row) => [row.locale, row.sessionId]))
    expect(byLocale.get('zh-CN')).toBe('session-zh-CN')
    expect(byLocale.get('en-US')).toBe('session-en-US')
  })

  it('does not ask at all when no lookup is wired, and leaves the rows without a session', async () => {
    const editions = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [edition('zh-CN')],
      otherRows: []
    })
    expect(editions.every((row) => row.sessionId === undefined)).toBe(true)
  })
})
