import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingPeriodRun, DailyBriefingStoredEdition } from './dailyBriefingService'
import { briefingHistorySummaries, briefingRailDates, readBriefingHistory } from './dailyBriefingHistory'

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

// 「这一期该有几种语言」现在问**期配置**，不再问运行记录（审计表不参与渲染）。
const summaries = (rows: readonly DailyBriefingStoredEdition[], expected: readonly ('zh-CN' | 'en-US')[]) =>
  briefingHistorySummaries({
    dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
    configuredLanguages: () => expected
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

  it('keeps a row for a run that already started, even before its journal exists', async () => {
    // 用户 2026-11-06：只要开始跑了就要留在 list 里。attempt 在开工前就写下了，比运行记录早一步——
    // 一次跑在冻结事实之前就挂掉时，只有 attempt、没有运行记录、也没有版次，这一行同样必须在。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{ date: '2026-11-02', periodId: '0faa8e15', locale: 'en-US', state: 'failed', startedAt: '2026-11-02T10:11:23.000Z' }],
      scheduledTime: () => undefined
    })
    expect(listed).toHaveLength(1)
    // 这一行属于**它自己的语言**：英文那一期失败，就是一行英文，不是中文那一版没生成。
    expect(listed[0]).toMatchObject({ date: '2026-11-02', periodId: '0faa8e15', locale: 'en-US', state: 'missing' })
    expect(listed[0]?.languages).toEqual([{ locale: 'en-US', state: 'missing', reason: 'run-failed' }])
    // 没有正文就没有正文派生量，也没有借来的计划时刻。
    expect(listed[0]?.generatedAt).toBeUndefined()
    expect(listed[0]?.scheduledTime).toBeUndefined()
  })

  it('gives a running row its identity from that attempt', async () => {
    // 用户 2026-11-06：手动发起的那一行在进行中显示「未记录 未记录 定时」——身份没接上、来源被猜成
    // "定时"。身份只认那一次的尝试（运行记录已不参与渲染）。
    const [row] = await briefingHistorySummaries({
      dates: ['2026-11-06'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{
        date: '2026-11-06', periodId: 'period_running', locale: 'zh-CN', state: 'running',
        startedAt: '2026-11-06T13:46:18.302Z', trigger: 'manual', windowHours: 24
      }],
      isRunning: () => true
    })
    expect(row).toMatchObject({
      periodId: 'period_running', state: 'missing', periodTime: '2026-11-06T13:46:18.302Z',
      periodKind: 'manual', runTrigger: 'manual', windowHours: 24
    })
  })

  it('gives a failed row its own time, trigger and window from that attempt', async () => {
    // 用户 2026-11-06：失败那一行以前只剩「这次失败 英文」，看不出是哪一次。时刻/来源/窗口必须来自
    // **这一次尝试**，不是默认期的 07:00、也不是当前设置。
    const [row] = await briefingHistorySummaries({
      dates: ['2026-11-06'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{
        date: '2026-11-06', periodId: 'period_failed', locale: 'en-US', state: 'failed',
        startedAt: '2026-11-06T10:11:23.763Z', trigger: 'manual', windowHours: 12
      }],
      scheduledTime: () => '07:00'
    })
    expect(row).toMatchObject({
      periodId: 'period_failed', locale: 'en-US', state: 'missing',
      periodTime: '2026-11-06T10:11:23.763Z', periodKind: 'manual',
      runTrigger: 'manual', windowHours: 12
    })
  })

  it('leaves the identity out when the attempt recorded none — 未记录, never backfilled', async () => {
    const [row] = await briefingHistorySummaries({
      dates: ['2026-11-06'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{
        date: '2026-11-06', periodId: 'period_legacy', locale: 'zh-CN', state: 'failed',
        startedAt: '2026-11-06T01:00:00.000Z'
      }],
      scheduledTime: () => '07:00'
    })
    expect(row?.periodTime).toBe('2026-11-06T01:00:00.000Z')
    expect(row?.runTrigger).toBeUndefined()
    expect(row?.windowHours).toBeUndefined()
  })

  it('shows no row for a run that succeeded but left no edition', async () => {
    // 用户 2026-11-06 的 5 个空壳行：同一天同槽位的后一版把前面几版的正文顶掉了，运行记录还在，
    // 于是被画成「未运行 / 这一期没有生成过」——"跑了却说没生成过"。
    // 跑成功却没有版次，只有两种可能：读者删了它，或同槽新版顶掉了它。两种都不出行。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-06'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [
        { date: '2026-11-06', periodId: 'period_early', locale: 'zh-CN', state: 'succeeded', startedAt: '2026-11-06T01:00:00.000Z' },
        { date: '2026-11-06', periodId: 'period_late', locale: 'en-US', state: 'failed', startedAt: '2026-11-06T02:00:00.000Z' }
      ],
      scheduledTime: () => undefined
    })
    expect(listed.map((row) => row.periodId)).toEqual(['period_late'])
  })

  it('does not split one run into two rows once it publishes', async () => {
    // 失败后重试成功：仍是同一 (日期, 期号, 语言) 的一行，状态从"没有正文"变成版次行。
    const retried = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN',
      primaryRows: [edition('zh-CN')], otherRows: [],
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', state: 'succeeded', startedAt: '2026-11-02T00:00:00.000Z' }],
      scheduledTime: () => '07:00'
    })
    expect(retried).toHaveLength(1)
    expect(retried[0]).toMatchObject({ periodId: 'default', locale: 'zh-CN', state: 'generated' })
  })

  it('still makes no row for a period that never ran', async () => {
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [], scheduledTime: () => '07:00'
    })
    expect(listed).toHaveLength(0)
  })

  it('shows no row at all for a run whose editions were all deleted', async () => {
    // 用户 2026-11-05 拍板：跑成功却没有版次 = 那一版被删了 → **整行不显示**，不解释也不留位。
    // 旧行为留一行"未运行"，读者看到的是"没跑过"，跟他刚删过的那件事对不上。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: [],
      otherRows: [],
      // 跑成功、版次被删：只有成功尝试，没有版次 → 整行不显示（审计表不参与）。
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', state: 'succeeded' as const, startedAt: '2026-11-02T00:00:00.000Z' }],
      attemptCount: vi.fn(async () => 5),
      scheduledTime: () => '07:00'
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
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', state: 'failed' as const, startedAt: '2026-11-02T00:00:00.000Z' }],
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

  const two = (rows: readonly DailyBriefingStoredEdition[], _runs: Record<string, ReturnType<typeof run>> = {}) =>
    briefingHistorySummaries({
      dates: ['2026-11-02'],
      primary: 'zh-CN',
      primaryRows: rows.filter((row) => row.locale === 'zh-CN'),
      otherRows: rows.filter((row) => row.locale === 'en-US')
    })

  it('sorts a day newest first, and resolves the same moment by periodId', async () => {
    const rows = [
      withPeriod('period_late', 'zh-CN', { periodTime: '2026-11-02T12:00:00.000Z' }),
      withPeriod('period_b', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' }),
      withPeriod('period_a', 'zh-CN', { periodTime: '2026-11-02T07:00:00.000Z' })
    ]
    const summaries = await two(rows, {})
    // 天内倒序：后来的在上；同刻（07:00 那两期）按 periodId 稳定序，方向同样反过来。
    expect(summaries.map((summary) => summary.periodId)).toEqual(['period_late', 'period_b', 'period_a'])
    // Not generatedAt: the late run finishing first must not reorder the day.
    const reordered = await two([...rows].reverse(), {})
    expect(reordered.map((summary) => summary.periodId)).toEqual(['period_late', 'period_b', 'period_a'])
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
    // 「该有中英两版」来自期配置；"在跑"来自活着的尝试 + 现场进度。
    const running = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      configuredLanguages: () => ['zh-CN', 'en-US'],
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'en-US', state: 'running' as const, startedAt: '2026-11-02T00:00:00.000Z' }],
      isRunning: () => true
    })
    expect(running[0]?.languages).toEqual([
      { locale: 'en-US', state: 'generating' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const dead = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      configuredLanguages: () => ['zh-CN', 'en-US'],
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'en-US', state: 'running' as const, startedAt: '2026-11-02T00:00:00.000Z' }],
      isRunning: () => false
    })
    expect(dead[0]?.languages).toEqual([
      // A stored `running` with no live process is an interrupted run, not a published partial one.
      { locale: 'en-US', state: 'missing', reason: 'run-interrupted' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const settled = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      configuredLanguages: () => ['zh-CN', 'en-US']
    })
    expect(settled[0]?.languages).toEqual([
      { locale: 'en-US', state: 'missing', reason: 'not-published' },
      { locale: 'zh-CN', state: 'published' }
    ])

    const failed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      configuredLanguages: () => ['zh-CN', 'en-US'],
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'en-US', state: 'failed' as const, startedAt: '2026-11-02T00:00:00.000Z' }]
    })
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

  // 没有版次的那一行由**尝试记录**驱动，运行记录（审计）不再参与。
  const onlyAttempts = (
    attempts: readonly Readonly<{ periodId: string; state: 'running' | 'failed' | 'succeeded'; locale?: 'zh-CN' | 'en-US'; startedAt?: string; failureCode?: string }>[],
    isRunning?: (date: string, periodId: string) => boolean
  ) => briefingHistorySummaries({
    dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [],
    attemptRuns: attempts.map((attempt) => ({
      date: '2026-11-02', periodId: attempt.periodId, locale: attempt.locale ?? 'zh-CN',
      state: attempt.state, startedAt: attempt.startedAt ?? '2026-11-02T00:00:00.000Z',
      ...(attempt.failureCode === undefined ? {} : { failureCode: attempt.failureCode })
    })),
    ...(isRunning ? { isRunning } : {})
  })

  it('gives a row its own period\'s planned time, and no planned time to a period that has no schedule', async () => {
    // 用户 2026-11-06 看到的「07:00 未运行」：那是一期 18:11 失败的英文手动期，却被贴上了默认期的
    // 计划时刻。计划时刻只属于**有排期的期**，手动期（UUID、配置表里没有行）没有。
    const at = '2026-11-02T00:00:00.000Z'
    const scheduled = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{ date: '2026-11-02', periodId: 'default', locale: 'zh-CN', state: 'failed' as const, startedAt: at }],
      scheduledTime: (periodId) => periodId === 'default' ? '07:00' : undefined
    })
    expect(scheduled[0]?.scheduledTime).toBe('07:00')

    const manual = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [], otherRows: [],
      attemptRuns: [{ date: '2026-11-02', periodId: 'period_manual_uuid', locale: 'en-US', state: 'failed' as const, startedAt: at }],
      scheduledTime: (periodId) => periodId === 'default' ? '07:00' : undefined
    })
    // 没有计划时刻，就没有那枚借来的时钟；"这次失败"由原因自己说。
    expect(manual[0]?.scheduledTime).toBeUndefined()
    // 语言标签说它当时想写哪一种（英文那版），不是界面语言：这一期没写中文版，不许假装有。
    expect(manual[0]?.languages).toEqual([{ locale: 'en-US', state: 'missing', reason: 'run-failed' }])
  })

  it('shows a failed run with a reason, and no body-derived number on the row', async () => {
    const [summary] = await onlyAttempts([{ periodId: 'period_crash', state: 'failed' }])
    expect(summary).toMatchObject({ periodId: 'period_crash', state: 'missing' })
    // A9.9: a row with no body may not carry any of the body's derived values. `startedAt` is not a
    // stand-in for `generatedAt`, and a nominal cutoff is not invented either.
    expect(summary?.generatedAt).toBeUndefined()
    expect(summary?.summaryLine).toBeUndefined()
    expect(summary?.direction).toBeUndefined()
    expect(summary?.readingsAvailable).toBeUndefined()
    expect(summary?.windowEnd).toBeUndefined()
    // 时刻来自**这次尝试自己的发起时刻**（不再借默认期的计划时刻），窗口没有就空着。
    expect(summary?.periodTime).toBe('2026-11-02T00:00:00.000Z')
    expect(summary?.windowHours).toBeUndefined()
    expect(summary?.scheduledTime).toBeUndefined()
    expect(summary?.languages).toEqual([{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }])
  })

  it('says "generating" only while the run is alive, and "interrupted" once the process is gone', async () => {
    const alive = await onlyAttempts([{ periodId: 'period_crash', state: 'running' }], () => true)
    expect(alive[0]?.languages).toEqual([{ locale: 'zh-CN', state: 'generating' }])

    // Same stored row after a crash and restart: nothing is running, so the row stops spinning and
    // says the run never finished — which is not the same statement as "it failed".
    const crashed = await onlyAttempts([{ periodId: 'period_crash', state: 'running' }], () => false)
    expect(crashed[0]?.languages).toEqual([{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }])
  })

  it('builds no row at all for a run the reader cancelled, and keeps the interrupted one', async () => {
    // `02` v2.176：读者取消 / 被自己连点顶掉 / 暂停原因缺失 —— 不是故障，**不建行**（A9.18 的唯一例外）；
    // 应用中途关闭（`run-interrupted`）要留行：那是系统侧的问题，读者得知道那天为什么没有。
    const [cancelled] = await onlyAttempts([{ periodId: 'period_cancelled', state: 'failed', failureCode: 'cancelled' }], undefined)
    expect(cancelled, '取消那次不许留行').toBeUndefined()

    const [interrupted] = await onlyAttempts([{ periodId: 'period_crash', state: 'running' }], () => false)
    expect(interrupted?.periodId).toBe('period_crash')
    expect(interrupted?.languages).toEqual([{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }])
  })

  it('says run-cancelled, not run-failed, when a cancelled run still has a row to explain', async () => {
    // 有版次的那一期后来又跑了一次、被读者取消：那一行照常显示正文，但语言的"没有这一版"理由
    // 必须是 `run-cancelled`——用 `run-failed` 顶替，就是把读者的动作写成故障。
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [edition('zh-CN')], otherRows: [],
      attemptRuns: [{
        date: '2026-11-02', periodId: 'default', locale: 'en-US', state: 'failed' as const,
        startedAt: '2026-11-02T00:00:00.000Z', failureCode: 'cancelled'
      }],
      configuredLanguages: () => ['zh-CN', 'en-US']
    })
    const row = listed.find((summary) => summary.periodId === 'default')
    expect(row?.languages).toEqual([
      { locale: 'en-US', state: 'missing', reason: 'run-cancelled' },
      { locale: 'zh-CN', state: 'published' }
    ])
  })

  it('never marks a generating or missing row as the current edition', async () => {
    const rows = [edition('zh-CN')]
    const listed = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: rows, otherRows: [],
      attemptRuns: [{ date: '2026-11-02', periodId: 'period_crash', locale: 'zh-CN', state: 'failed' as const, startedAt: '2026-11-02T00:00:00.000Z' }]
    })
    // 按身份取行，不按数组顺序：没有版次的那一行同样参与日内排序。
    const published = listed.find((row) => row.periodId === 'default')
    const failed = listed.find((row) => row.periodId === 'period_crash')
    expect(published?.isCurrent).toBe(true)
    expect(failed?.isCurrent).toBeUndefined()
    expect(listed.filter((summary) => summary.isCurrent)).toHaveLength(1)
  })

  it('keeps the day sorted by nominal cutoff, with the unknown-cutoff row last', async () => {
    const known = edition('zh-CN')
    const [first, second] = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [known], otherRows: [],
      // 没有时刻可排的那一行（该有却没有的排期期）排最后：它不能因为"时间不知道"冒充当天最早的一期。
      missedPeriods: [{ date: '2026-11-02', periodId: 'period_missed', locale: 'zh-CN' }]
    })
    expect(first?.periodId).toBe('default')
    expect(second?.periodId).toBe('period_missed')
  })
})
})

describe('the rail draws a head only where the day has a trace', () => {
  const dates = ['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02']

  it('keeps a day with a run but no editions (the reader deleted that edition)', () => {
    // 11/05 型：两条运行记录、版次已被删 → 天头在、共 0 期、展开后一个兜底项。
    const listed = briefingRailDates({
      dates,
      editionDates: new Set(['2026-11-04']),
      runDates: new Set(['2026-11-05']),
      today: '2026-11-05'
    })
    // 新到旧（用户 2026-11-05 定：天头倒序，今天在最上）。
    expect(listed).toEqual(['2026-11-04', '2026-11-05'])
  })

  it('lets today in even with no edition and no run, and nothing else', () => {
    // 成对断言：今天放行一天（否则 07:00 前打开列表从昨天开始，读者以为列表坏了）；
    // 昨天及更早同样空的日子**不出现**——只写前一条等于给"14 天全铺"留口子。
    const listed = briefingRailDates({
      dates,
      editionDates: new Set(),
      runDates: new Set(),
      today: '2026-11-05'
    })
    expect(listed).toEqual(['2026-11-05'])
  })

  it('never counts "the schedule covers this day" as a trace', () => {
    // 排期每天都配（07:00 天天都有），按它算等于每天都成立。
    const listed = briefingRailDates({ dates, editionDates: new Set(), runDates: new Set(), today: '2026-10-01' })
    expect(listed).toEqual([])
  })
})

describe('the history window never cuts off a day that has an edition', () => {
  const store = (rows: readonly DailyBriefingStoredEdition[]) => ({
    list: vi.fn(async (from: string, to: string, locale: 'zh-CN' | 'en-US') =>
      rows.filter((row) => row.date >= from && row.date <= to && row.locale === locale)),
    getPeriodRun: vi.fn(async () => undefined),
    listAttempts: vi.fn(async () => [])
  })

  // `02` v2.129 G2：读者日历的 11/05，而一版落了 11/06（截止时刻在读者时区跨了日）。
  // 窗口右端只到"今天"时那一版一天都显示不出来，页面写「共 0 期」——比失败更像失败。
  it('keeps a day filed after "today" and shows its edition', async () => {
    const fixture = store([edition('zh-CN', '2026-11-06')])
    const listed = await readBriefingHistory({
      store: fixture, locale: 'zh-CN', today: '2026-11-05', retentionDays: 14, scheduledTime: () => '07:00'
    })
    expect(listed.editions.map((summary) => summary.date)).toContain('2026-11-06')
    expect(listed.dates).toContain('2026-11-06')
    // 往右多问一天，往左一天都不多问：14 天可见范围不放宽。
    expect(fixture.list).toHaveBeenCalledWith('2026-10-23', '2026-11-06', 'zh-CN')
    expect(listed.dates).not.toContain('2026-10-22')
  })

  it('does not put an empty day after today into the rail', async () => {
    // 多问的那一天只在**有东西**时出现；否则列表每天凭空多一行空日子。
    const listed = await readBriefingHistory({
      store: store([edition('zh-CN', '2026-11-05')]),
      locale: 'zh-CN', today: '2026-11-05', retentionDays: 14, scheduledTime: () => '07:00'
    })
    expect(listed.dates).not.toContain('2026-11-06')
    expect(listed.dates).toContain('2026-11-05')
  })
})
