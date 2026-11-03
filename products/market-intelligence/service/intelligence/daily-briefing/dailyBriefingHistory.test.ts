import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingPeriodRun, DailyBriefingStoredEdition } from './dailyBriefingService'
import { briefingHistorySummaries } from './dailyBriefingHistory'

/**
 * Guard: "incomplete" comes from the run's intent, not from counting the rows that exist.
 *
 * If someone later replaces this with a locale count, the first case below goes red: one published
 * language is indistinguishable from a single-language edition by counting alone.
 */

const edition = (locale: 'zh-CN' | 'en-US', date = '2026-11-02'): DailyBriefingStoredEdition => ({
  date,
  periodId: 'default',
  locale,
  generatedAt: `${date}T00:00:00.000Z`,
  windowStart: `${date}T00:00:00.000Z`,
  windowEnd: `${date}T00:00:00.000Z`,
  document: {
    schemaVersion: 1, policyVersion: 'daily-briefing.v1',
    edition: { date, locale, generatedAt: `${date}T00:00:00.000Z`, windowStart: `${date}T00:00:00.000Z`, windowEnd: `${date}T00:00:00.000Z`, timeZone: 'Asia/Shanghai' },
    status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
    lede: { source: 'template', text: '', generatedAt: `${date}T00:00:00.000Z` },
    news: { items: [], macro: [], notes: {} },
    data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
    conclusion: null, next: { items: [] }, citations: [],
    provenance: { summaryId: null, readAt: `${date}T00:00:00.000Z` }
  }
})

const run = (expectedLocales: readonly ('zh-CN' | 'en-US')[]): DailyBriefingPeriodRun => ({
  date: '2026-11-02', periodId: 'default', expectedLocales,
  primaryRequested: 'zh-CN', primaryUsed: 'zh-CN',
  snapshotId: 'bs_x', snapshotHash: 'h', contentVersion: 1, writingRounds: 1,
  direction: 'undecided', editionRows: [], state: 'running', startedAt: '2026-11-02T00:00:00.000Z'
})

const summaries = (rows: readonly DailyBriefingStoredEdition[], expected: readonly ('zh-CN' | 'en-US')[]) =>
  briefingHistorySummaries({
    dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
    periodRun: vi.fn(async () => run(expected))
  })

describe('history rows take incompleteness from the run', () => {
  it('marks one published language of a two-language period as partial', async () => {
    const [summary] = await summaries([edition('zh-CN')], ['zh-CN', 'en-US'])
    expect(summary?.state).toBe('partial')
    expect(summary?.expectedLocales).toEqual(['zh-CN', 'en-US'])
  })

  it('keeps a single-language period that published as generated', async () => {
    const [summary] = await summaries([edition('zh-CN')], ['zh-CN'])
    expect(summary?.state).toBe('generated')
  })

  it('treats a run whose editions were all deleted as not run, not as failed or partial', async () => {
    // The reader emptied this issue. The run succeeded, the attempts are history: the row describes
    // what is true now — no edition — and must not blame the pipeline or point at a missing version.
    const [summary] = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [],
      otherRows: [],
      periodRun: vi.fn(async () => ({ ...run(['zh-CN', 'en-US']), state: 'published' as const })),
      attemptCount: vi.fn(async () => 5),
      scheduledTime: '07:00'
    })

    expect(summary?.state).toBe('missing')
    expect(summary?.attemptCount).toBeUndefined()
    expect(summary?.scheduledTime).toBe('07:00')
  })

  it('still reports a failed run as failed when nothing was published', async () => {
    const [summary] = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [],
      otherRows: [],
      periodRun: vi.fn(async () => ({ ...run(['zh-CN']), state: 'failed' as const })),
      attemptCount: vi.fn(async () => 2)
    })

    expect(summary?.state).toBe('missing')
    expect(summary?.attemptCount).toBe(2)
  })
})
