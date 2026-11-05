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

  it('shows no row at all for a run whose editions were all deleted', async () => {
    // 用户 2026-11-05 拍板：跑成功却没有版次 = 那一版被删了 → **整行不显示**，不解释也不留位。
    // 旧行为留一行"未运行"，读者看到的是"没跑过"，跟他刚删过的那件事对不上。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [],
      otherRows: [],
      runs: [{ ...run(['zh-CN', 'en-US']), state: 'published' as const }],
      periodRun: vi.fn(async () => ({ ...run(['zh-CN', 'en-US']), state: 'published' as const })),
      attemptCount: vi.fn(async () => 5),
      scheduledTime: '07:00'
    })

    expect(listed).toHaveLength(0)
  })

  it('still reports a failed run as failed when nothing was published', async () => {
    // 失败是"发生过的事"，不是占位：没有版次也要留一行，带原因和重试入口。
    const [summary] = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [],
      otherRows: [],
      runs: [{ ...run(['zh-CN']), state: 'failed' as const }],
      periodRun: vi.fn(async () => ({ ...run(['zh-CN']), state: 'failed' as const })),
      attemptCount: vi.fn(async () => 2)
    })

    expect(summary?.state).toBe('missing')
    expect(summary?.attemptCount).toBe(2)
  })

describe('the list projection decides the row, once', () => {
  /** A stored edition whose document carries the period identity the run wrote. */
  const withPeriod = (
    periodId: string,
    locale: 'zh-CN' | 'en-US',
    identity: Readonly<{ periodTime: string; periodKind?: 'scheduled' | 'manual'; runTrigger?: 'scheduled' | 'catch-up' | 'retry' | 'manual'; generatedAt?: string }>
  ): DailyBriefingStoredEdition => {
    const base = edition(locale)
    return {
      ...base,
      periodId,
      generatedAt: identity.generatedAt ?? base.generatedAt,
      document: {
        ...base.document,
        edition: {
          ...base.document.edition,
          periodId,
          periodTime: identity.periodTime,
          periodKind: identity.periodKind ?? 'scheduled',
          runTrigger: identity.runTrigger ?? 'scheduled'
        }
      }
    }
  }

  const two = (rows: readonly DailyBriefingStoredEdition[], runs: Record<string, ReturnType<typeof run>>) =>
    briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: rows.filter((row) => row.locale === 'zh-CN'),
      otherRows: rows.filter((row) => row.locale === 'en-US'),
      periodRun: vi.fn(async (_date: string, periodId: string) => runs[periodId])
    })

  it('sorts a day by nominal cutoff, and resolves the same moment by periodId', async () => {
    const rows = [
      withPeriod('period_late', 'zh-CN', { periodTime: '2026-11-02T12:00:00.000Z' }),
      withPeriod('period_b', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' }),
      withPeriod('period_a', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })
    ]
    const summaries = await two(rows, {})
    expect(summaries.map((summary) => summary.periodId)).toEqual(['period_a', 'period_b', 'period_late'])
    // Not generatedAt: the late run finishing first must not reorder the day.
    const reordered = await two([...rows].reverse(), {})
    expect(reordered.map((summary) => summary.periodId)).toEqual(['period_a', 'period_b', 'period_late'])
  })

  it('hands the whole title to the row: the two-line clamp is CSS, not a data-layer slice', async () => {
    const long = 'Stablecoin contraction keeps the read defensive across every venue the desk covers today'
    const row = withPeriod('default', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })
    const [summary] = await two([{
      ...row,
      document: { ...row.document, lede: { ...row.document.lede, text: long } }
    }], {})
    // 80 characters used to be cut here, which made the clamp permanent and the copied text wrong.
    expect(summary?.summaryLine).toBe(long)
    expect(summary?.summaryLine?.length).toBeGreaterThan(80)
  })

  it('copies the identity each edition wrote, kind and trigger included', async () => {
    const [summary] = await two([withPeriod('period_x', 'zh-CN', {
      periodTime: '2026-11-02T07:00:00.000Z', periodKind: 'manual', runTrigger: 'retry'
    })], {})
    expect(summary).toMatchObject({
      periodId: 'period_x',
      periodTime: '2026-11-02T07:00:00.000Z',
      periodKind: 'manual',
      runTrigger: 'retry'
    })
    expect(summary?.isCurrent).toBe(true)
  })

  it('offers each language with its three-state, and names the reason for a missing one', async () => {
    const rows = [withPeriod('default', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })]
    // "Generating" follows the live registry: a stored run still marked running with no live process
    // is a dead run, and the row must not spin forever.
    const settledRun = { ...run(['zh-CN', 'en-US']), state: 'partial' as const }
    const running = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      periodRun: vi.fn(async () => settledRun),
      isRunning: () => true
    })
    expect(running[0]?.languages).toEqual([
      { locale: 'en-US', state: 'generating' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const dead = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      periodRun: vi.fn(async () => ({ ...run(['zh-CN', 'en-US']), state: 'running' as const })),
      isRunning: () => false
    })
    expect(dead[0]?.languages).toEqual([
      // A stored `running` with no live process is an interrupted run, not a published partial one.
      { locale: 'en-US', state: 'missing', reason: 'run-interrupted' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const settled = await two(rows, { default: settledRun })
    expect(settled[0]?.languages).toEqual([
      { locale: 'en-US', state: 'missing', reason: 'not-published' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const failed = await two(rows, { default: { ...run(['zh-CN', 'en-US']), state: 'failed' } })
    expect(failed[0]?.languages).toEqual([
      { locale: 'en-US', state: 'missing', reason: 'run-failed' },
      { locale: 'zh-CN', state: 'published' }
    ])
  })

  it('shows the languages old rows actually had, not every supported language', async () => {
    // r18 data: one day one period, both versions stored under `default`. Two badges, not four.
    const rows = [
      withPeriod('default', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' }),
      withPeriod('default', 'en-US', { periodTime: '2026-11-02T07:00:00.000Z' })
    ]
    const summaries = await two(rows, {})
    expect(summaries[0]?.languages).toEqual([
      { locale: 'en-US', state: 'published' },
      { locale: 'zh-CN', state: 'published' }
    ])
  })

  it('marks a period whose configuration is gone, without dropping its history', async () => {
    const summaries = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [withPeriod('period_gone', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })],
      otherRows: [],
      periodPresence: (periodId) => periodId === 'period_gone' ? 'absent' as const : 'found' as const
    })
    expect(summaries[0]?.periodDeleted).toBe(true)
    expect(summaries[0]?.state).toBe('generated')

    // "Could not read the configuration" is not "the period is gone": no mark is written.
    const unreadable = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN',
      primaryRows: [withPeriod('period_gone', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })],
      otherRows: [],
      periodPresence: () => 'unreadable'
    })
    expect(unreadable[0]?.periodDeleted).toBeUndefined()
  })

  it('shows no row for a period that never ran at all', async () => {
    // 从来没有运行记录 → 不显示（"今天 13:00 那期还没到点"不再占一行；排期在设置页看）。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: []
    })
    expect(listed).toHaveLength(0)
  })


  it('lets a manual period be the current edition, and keeps it there by kind', async () => {
    const rows = [
      withPeriod('period_sched', 'zh-CN', { periodTime: '2026-11-02T12:30:00.000Z', generatedAt: '2026-11-02T12:31:00.000Z' }),
      withPeriod('period_manual', 'zh-CN', {
        periodTime: '2026-11-02T21:53:00.000Z', periodKind: 'manual', runTrigger: 'manual',
        generatedAt: '2026-11-02T21:54:00.000Z'
      })
    ]
    const summaries = await two(rows, {})
    const current = summaries.filter((summary) => summary.isCurrent)
    // B1: the current edition is decided by generatedAt, never by the kind of period.
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ periodId: 'period_manual', periodKind: 'manual' })
    // The reverse assertion: a reader that filters "scheduled only" would have no current row here,
    // which is exactly what this test refuses.
    expect(summaries.filter((summary) => summary.periodKind === 'scheduled' && summary.isCurrent)).toHaveLength(0)
  })

  it('marks exactly one current edition per day: the latest generatedAt, not the latest cutoff', async () => {
    const rows = [
      withPeriod('period_early', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z', generatedAt: '2026-11-02T09:00:00.000Z' }),
      withPeriod('period_late', 'zh-CN', { periodTime: '2026-11-02T12:00:00.000Z', generatedAt: '2026-11-02T12:01:00.000Z' })
    ]
    const summaries = await two(rows, {})
    expect(summaries.filter((summary) => summary.isCurrent).map((summary) => summary.periodId)).toEqual(['period_late'])
  })
})

describe('a run that wrote no edition still gets a row', () => {
  const emptyDayRun = (state: 'running' | 'failed', periodId = 'period_crash'): DailyBriefingPeriodRun => ({
    ...run(['zh-CN']),
    periodId,
    state
  })

  const onlyRuns = (runs: readonly DailyBriefingPeriodRun[], isRunning?: (date: string, periodId: string) => boolean) =>
    briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [], runs,
      ...(isRunning ? { isRunning } : {})
    })

  it('shows a failed run with a reason, and no body-derived number on the row', async () => {
    const [summary] = await onlyRuns([emptyDayRun('failed')])
    expect(summary).toMatchObject({ periodId: 'period_crash', state: 'missing' })
    // A9.9: a row with no body may not carry any of the body's derived values. `startedAt` is not a
    // stand-in for `generatedAt`, and a nominal cutoff is not invented either.
    expect(summary?.generatedAt).toBeUndefined()
    expect(summary?.summaryLine).toBeUndefined()
    expect(summary?.direction).toBeUndefined()
    expect(summary?.readingsAvailable).toBeUndefined()
    expect(summary?.windowEnd).toBeUndefined()
    expect(summary?.periodTime).toBeUndefined()
    expect(summary?.languages).toEqual([{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }])
  })

  it('says "generating" only while the run is alive, and "interrupted" once the process is gone', async () => {
    const alive = await onlyRuns([emptyDayRun('running')], () => true)
    expect(alive[0]?.languages).toEqual([{ locale: 'zh-CN', state: 'generating' }])

    // Same stored row after a crash and restart: nothing is running, so the row stops spinning and
    // says the run never finished — which is not the same statement as "it failed".
    const crashed = await onlyRuns([emptyDayRun('running')], () => false)
    expect(crashed[0]?.languages).toEqual([{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }])
  })

  it('never marks a generating or missing row as the current edition', async () => {
    const rows = [edition('zh-CN')]
    const [published, failed] = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      runs: [emptyDayRun('failed')]
    })
    expect(published?.isCurrent).toBe(true)
    expect(failed?.isCurrent).toBeUndefined()
    expect([published, failed].filter((summary) => summary?.isCurrent)).toHaveLength(1)
  })

  it('keeps the day sorted by nominal cutoff, with the unknown-cutoff row last', async () => {
    const known = edition('zh-CN')
    const [first, second] = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [known], otherRows: [],
      runs: [emptyDayRun('failed')]
    })
    expect(first?.periodId).toBe('default')
    expect(second?.periodId).toBe('period_crash')
  })
})
})
