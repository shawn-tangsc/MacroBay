import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { dailyBriefingPolicy, type BriefingGenerationTrace, type DailyBriefingDocument } from '../../../contracts/dailyBriefing'
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
  // 用户 2026-11-06：同一个时间、同一个窗口、同一个语言生成了两份简报。查这个槽的眼睛在这里：
  // 键是 (日期, 截止时刻, 语言)，窗口不进键，期号也不进键（期号是那一版的属性，不是它的身份）。
  it('finds the edition that occupies a (date, cutoff, language) slot, whoever its period is', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const cutoff = '2026-11-05T00:00:00.000Z'
    await store.put({
      ...edition('2026-11-06', '07:00 那版'),
      periodId: 'period_a',
      windowEnd: cutoff,
      document: {
        ...document('2026-11-06', '07:00 那版'),
        edition: { ...document('2026-11-06', '07:00 那版').edition, periodId: 'period_a', windowEnd: cutoff, windowHours: 24 }
      }
    })

    // 同一刻同一语言：即便窗口写的是 12h，这个槽也已经被占。
    expect(await store.editionAtCutoff?.('2026-11-06', 'zh-CN', cutoff)).toEqual({ periodId: 'period_a' })
    // 另一刻、另一语言都是空的。
    expect(await store.editionAtCutoff?.('2026-11-06', 'zh-CN', '2026-11-05T01:00:00.000Z')).toBeUndefined()
    expect(await store.editionAtCutoff?.('2026-11-06', 'en-US', cutoff)).toBeUndefined()
    expect(await store.editionAtCutoff?.('2026-11-05', 'zh-CN', cutoff)).toBeUndefined()
  })

  // 手动那一版必须落在自己的期号下，**而且不许动 default 那一期**。
  // 用户报的「选 8 点变成重跑 7 点」里，`periodId` 一路丢到 default，`put` 就把 07:00 那版覆盖了。
  it('files a manual edition under its own period and leaves the default edition untouched', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const manualPeriodId = 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf'
    await store.put({ ...edition('2026-11-05', '07:00 那版'), windowEnd: '2026-11-04T23:00:00.000Z' })
    const before = await store.get('2026-11-05', 'zh-CN')

    await store.put({
      ...edition('2026-11-05', '08:00 那版'),
      periodId: manualPeriodId,
      windowEnd: '2026-11-05T00:00:00.000Z',
      document: {
        ...document('2026-11-05', '08:00 那版'),
        edition: { ...document('2026-11-05', '08:00 那版').edition, periodId: manualPeriodId, windowEnd: '2026-11-05T00:00:00.000Z' }
      }
    })

    const after = await store.get('2026-11-05', 'zh-CN')
    expect(after?.document.edition.windowEnd).toBe(before?.document.edition.windowEnd)
    expect(after?.document.lede.text).toBe('07:00 那版')

    const manual = await store.get('2026-11-05', 'zh-CN', manualPeriodId)
    expect(manual?.document.edition.windowEnd).toBe('2026-11-05T00:00:00.000Z')
    expect(manual?.document.lede.text).toBe('08:00 那版')
  })

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

  it('deletes one language of one issue, keeps its attempt history and other days', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.put(edition('2026-10-30'))
    const englishDocument = document('2026-10-30')
    await store.put({
      ...edition('2026-10-30'),
      locale: 'en-US',
      document: { ...englishDocument, edition: { ...englishDocument.edition, locale: 'en-US' } }
    })
    await store.put(edition('2026-10-29'))
    await store.beginAttempt!({ date: '2026-10-30', locale: 'zh-CN', startedAt: '2026-10-30T00:00:00.000Z' })

    const removed = await store.deletePeriod!('2026-10-30', 'default', 'zh-CN')
    // 删的是**这一行**的记录（用户 2026-11-06 定 A 口径）：中文版正文 + 它自己那条尝试一起走；
    // 英文版还在，所以共用的大运行记录留着（删了它会把英文那行的运行信息也抹掉）。
    expect(removed).toEqual({ editions: 1, attempts: 1, periodRuns: 0 })
    expect(await store.get('2026-10-30', 'zh-CN')).toBeUndefined()
    expect(await store.get('2026-10-30', 'en-US')).toBeDefined()
    // The other day is untouched, and a repeat delete returns zeros instead of throwing.
    expect(await store.get('2026-10-29', 'zh-CN')).toBeDefined()
    expect(await store.deletePeriod!('2026-10-30', 'default', 'zh-CN')).toEqual({ editions: 0, attempts: 0, periodRuns: 0 })
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

it('keeps two issues of the same day apart, and leaves the old API on the default one', async () => {
  const store = createDailyBriefingSqliteStore(':memory:')
  await store.put(edition('2026-10-30', '第一期'))
  await store.put({ ...edition('2026-10-30', '第二期'), periodId: 'second' })

  // A caller that knows nothing about issues still reads the row it wrote.
  expect((await store.get('2026-10-30', 'zh-CN'))?.document.lede.text).toBe('第一期')
  expect((await store.get('2026-10-30', 'zh-CN', 'second'))?.document.lede.text).toBe('第二期')
  // Both issues are listed for the day; neither replaced the other.
  expect((await store.list('2026-10-30', '2026-10-30', 'zh-CN')).map((row) => row.document.lede.text).sort())
    .toEqual(['第一期', '第二期'])
})


describe('writing attempts', () => {
  let directory: string | undefined
  afterEach(() => {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
    directory = undefined
  })

  const trace = (finishedAt: string): BriefingGenerationTrace => ({
    attemptId: 'attempt',
    startedAt: '2026-11-02T00:00:00.000Z',
    finishedAt,
    state: 'failed',
    stages: [{ id: 'source', state: 'failed', startedAt: '2026-11-02T00:00:00.000Z', finishedAt }]
  } as BriefingGenerationTrace)

  it('appends one row per attempt and settles the same row instead of replacing it', async () => {
    directory = mkdtempSync(join(tmpdir(), 'briefing-attempts-'))
    const filePath = join(directory, 'daily-briefings.sqlite')
    const store = createDailyBriefingSqliteStore(filePath)
    const key = { date: '2026-11-02', locale: 'zh-CN' as const }

    const first = await store.beginAttempt!({ ...key, startedAt: '2026-11-02T00:00:00.000Z' })
    await store.finishAttempt!({ ...key, attemptNo: first, state: 'failed', failureCode: 'source-failed', finishedAt: '2026-11-02T00:01:00.000Z', trace: trace('2026-11-02T00:01:00.000Z') })
    // A failed attempt is the newest record, so it is what a later read shows.
    expect(await store.getAttempt?.(key.date, key.locale)).toMatchObject({ state: 'failed' })

    const second = await store.beginAttempt!({ ...key, startedAt: '2026-11-02T01:00:00.000Z' })
    await store.finishAttempt!({ ...key, attemptNo: second, state: 'succeeded', finishedAt: '2026-11-02T01:01:00.000Z' })

    expect([first, second]).toEqual([1, 2])
    // The successful attempt does not delete the failed one; the newest row has no trace of its own.
    expect(await store.getAttempt?.(key.date, key.locale)).toBeUndefined()

    const db = openSqliteDatabase(filePath)
    try {
      expect(db.prepare(`select attempt_no, state, failure_code, finished_at, trace_json is not null as has_trace
        from daily_briefing_attempts order by attempt_no`).all()).toEqual([
        { attempt_no: 1, state: 'failed', failure_code: 'source-failed', finished_at: '2026-11-02T00:01:00.000Z', has_trace: 1 },
        { attempt_no: 2, state: 'succeeded', failure_code: null, finished_at: '2026-11-02T01:01:00.000Z', has_trace: 0 }
      ])
    } finally {
      db.close()
    }
  })

  it('opens a row as running before any work, so an interrupted attempt still exists', async () => {
    directory = mkdtempSync(join(tmpdir(), 'briefing-attempts-'))
    const filePath = join(directory, 'daily-briefings.sqlite')
    const store = createDailyBriefingSqliteStore(filePath)
    await store.beginAttempt!({ date: '2026-11-02', locale: 'zh-CN', startedAt: '2026-11-02T00:00:00.000Z' })

    const db = openSqliteDatabase(filePath)
    try {
      expect(db.prepare('select attempt_no, state, finished_at from daily_briefing_attempts').all())
        .toEqual([{ attempt_no: 1, state: 'running', finished_at: null }])
    } finally {
      db.close()
    }
  })
})


describe('deleting one language', () => {
  it('removes that language\'s attempts, keeps the other edition and the shared run readable', async () => {
    // The failure mode this catches: a delete that forgot `where ... and locale = ?` removes the
    // whole issue and still reports success. Only the other edition's absence would show it — so the
    // assertions below are counts before/after and a read of the edition that must survive.
    const store = createDailyBriefingSqliteStore(':memory:')
    const englishDocument = document('2026-11-03')
    await store.put(edition('2026-11-03'))
    await store.put({
      ...edition('2026-11-03'),
      locale: 'en-US',
      document: { ...englishDocument, edition: { ...englishDocument.edition, locale: 'en-US' } }
    })
    await store.beginAttempt!({ date: '2026-11-03', locale: 'zh-CN', startedAt: '2026-11-03T00:00:00.000Z' })
    await store.beginAttempt!({ date: '2026-11-03', locale: 'en-US', startedAt: '2026-11-03T00:01:00.000Z' })
    await store.openPeriodRun!({
      date: '2026-11-03', periodId: 'default', expectedLocales: ['zh-CN', 'en-US'],
      primaryRequested: 'zh-CN', primaryUsed: 'zh-CN', snapshotId: 'bs_x', snapshotHash: 'h',
      contentVersion: 1, writingRounds: 1, direction: 'bearish', editionRows: [], state: 'published',
      startedAt: '2026-11-03T00:00:00.000Z'
    })
    const attemptsBefore = (await store.listAttempts!('2026-11-03', 'zh-CN', 'default')).length
    const runBefore = await store.getPeriodRun!('2026-11-03', 'default')

    const removed = await store.deletePeriod!('2026-11-03', 'default', 'zh-CN')

    // 1. The deleted language's edition is gone.
    expect(removed.editions).toBe(1)
    expect(await store.get('2026-11-03', 'zh-CN')).toBeUndefined()
    // 2. The other edition is still there and still readable.
    expect((await store.get('2026-11-03', 'en-US'))?.document.edition.locale).toBe('en-US')
    // 3. 中文版那条尝试跟着删掉；英文版那条还在；共用的大运行记录留着（英文版还读得到）。
    expect(removed.attempts).toBe(1)
    expect((await store.listAttempts!('2026-11-03', 'zh-CN', 'default')).length).toBe(attemptsBefore - 1)
    expect((await store.listAttempts!('2026-11-03', 'en-US', 'default')).length).toBe(1)
    expect(await store.getPeriodRun!('2026-11-03', 'default')).toEqual(runBefore)
  })
})

describe('period runs', () => {
  const run = (snapshotId: string, snapshotHash: string) => ({
    date: '2026-11-02',
    periodId: 'default',
    expectedLocales: ['zh-CN' as const],
    primaryRequested: 'zh-CN',
    primaryUsed: 'zh-CN' as const,
    snapshotId,
    snapshotHash,
    contentVersion: 1,
    writingRounds: 0,
    direction: 'bearish' as const,
    editionRows: ['market:btc', 'funds:etf-btc'],
    state: 'running' as const,
    startedAt: '2026-11-02T00:00:00.000Z'
  })

  it('replaces the run when the period is regenerated, and settles its state in place', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.openPeriodRun!(run('bs_first', 'hash-first'))
    // A regeneration replaces the editions, so the run has to describe the batch that produced them.
    await store.openPeriodRun!(run('bs_second', 'hash-second'))

    expect(await store.getPeriodRun!('2026-11-02')).toMatchObject({
      periodId: 'default', expectedLocales: ['zh-CN'], snapshotId: 'bs_second', snapshotHash: 'hash-second',
      state: 'running', direction: 'bearish', editionRows: ['market:btc', 'funds:etf-btc']
    })

    await store.settlePeriodRun!({ date: '2026-11-02', periodId: 'default', state: 'published', finishedAt: '2026-11-02T00:05:00.000Z', writingRounds: 1 })
    expect(await store.getPeriodRun!('2026-11-02')).toMatchObject({ state: 'published', writingRounds: 1, finishedAt: '2026-11-02T00:05:00.000Z' })
  })

  it('lists the runs of a date range, including one that wrote no edition at all', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.openPeriodRun!(run('bs_a', 'hash-a'))
    await store.openPeriodRun!({ ...run('bs_b', 'hash-b'), periodId: 'period_x' })
    await store.openPeriodRun!({ ...run('bs_c', 'hash-c'), date: '2026-11-01' })
    // Nothing published for any of them: the run row is the only trace, which is exactly the case
    // the list has to show.
    const listed = await store.listPeriodRuns!('2026-11-02', '2026-11-02')
    expect(listed.map((entry) => entry.periodId)).toEqual(['default', 'period_x'])
    expect(await store.get('2026-11-02', 'zh-CN', 'period_x')).toBeUndefined()
    // The range is respected, not "everything ever".
    expect((await store.listPeriodRuns!('2026-11-01', '2026-11-01')).map((entry) => entry.date)).toEqual(['2026-11-01'])
  })

  it('writes the edition and its settled attempt in one write', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.beginAttempt!({ date: '2026-11-02', locale: 'zh-CN', startedAt: '2026-11-02T00:00:00.000Z' })
    await store.publishEdition!(edition('2026-11-02'), {
      date: '2026-11-02', locale: 'zh-CN', attemptNo: 1, state: 'succeeded', finishedAt: '2026-11-02T00:01:00.000Z'
    })

    expect((await store.get('2026-11-02', 'zh-CN'))?.document.lede.text).toBe('今日要点。')
    expect(await store.getAttempt?.('2026-11-02', 'zh-CN')).toBeUndefined()
  })

  it('writes neither when the attempt cannot be settled', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.beginAttempt!({ date: '2026-11-02', locale: 'zh-CN', startedAt: '2026-11-02T00:00:00.000Z' })

    await expect(store.publishEdition!(edition('2026-11-02'), {
      date: '2026-11-02', locale: 'zh-CN', attemptNo: 1, state: 'bogus' as never, finishedAt: '2026-11-02T00:01:00.000Z'
    })).rejects.toThrow()

    // The edition must not exist without the attempt that wrote it.
    expect(await store.get('2026-11-02', 'zh-CN')).toBeUndefined()
  })
})


describe('tombstones', () => {
  it('clears the trace and keeps the row, and says zero when the row is already gone', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const key = { date: '2026-11-02', locale: 'zh-CN' as const }
    const attemptNo = await store.beginAttempt!({ ...key, startedAt: '2026-11-02T00:00:00.000Z' })
    await store.finishAttempt!({
      ...key, attemptNo, state: 'failed', failureCode: 'source-failed',
      finishedAt: '2026-11-02T00:01:00.000Z',
      trace: {
        attemptId: 'attempt', startedAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:01:00.000Z',
        state: 'failed',
        stages: [{ id: 'source', state: 'failed', startedAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:01:00.000Z' }]
      } as never
    })
    expect(await store.getAttempt?.(key.date, key.locale)).toMatchObject({ state: 'failed' })

    // The row stays; only its trace is cleared, and the moment is recorded.
    expect(await store.markAttemptCleaned!({ editionDate: key.date, periodId: 'default', locale: key.locale, attemptNo, cleanedAt: '2026-11-09T08:10:00.000Z' })).toBe(1)
    expect(await store.getAttempt?.(key.date, key.locale)).toBeUndefined()
    expect(await store.listAttempts!(key.date, key.locale)).toEqual([{
      attemptNo, state: 'failed', failureCode: 'source-failed',
      startedAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:01:00.000Z',
      cleanedAt: '2026-11-09T08:10:00.000Z'
    }])

    // The 14-day sweep removed the row: the tombstone has nowhere to go, and that is a success.
    await store.prune('2026-11-03')
    expect(await store.markAttemptCleaned!({ editionDate: key.date, periodId: 'default', locale: key.locale, attemptNo, cleanedAt: '2026-11-10T08:10:00.000Z' })).toBe(0)
  })

  it('marks the newest attempt when no number is given, and never deletes a row', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const key = { date: '2026-11-02', locale: 'zh-CN' as const }
    await store.beginAttempt!({ ...key, startedAt: '2026-11-02T00:00:00.000Z' })
    await store.beginAttempt!({ ...key, startedAt: '2026-11-02T01:00:00.000Z' })

    expect(await store.markAttemptCleaned!({ editionDate: key.date, periodId: 'default', locale: key.locale, cleanedAt: '2026-11-09T08:10:00.000Z' })).toBe(1)
    const rows = await store.listAttempts!(key.date, key.locale)
    expect(rows.map((row) => row.attemptNo)).toEqual([2, 1])
    expect(rows[0]?.cleanedAt).toBe('2026-11-09T08:10:00.000Z')
    expect(rows[1]?.cleanedAt).toBeUndefined()
  })
})


describe('tombstones stay inside their own period', () => {
  it('does not touch the attempt of another issue on the same day', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const base = { date: '2026-11-02', locale: 'zh-CN' as const }
    const morning = await store.beginAttempt!({ ...base, periodId: 'p_morning', startedAt: '2026-11-02T00:00:00.000Z' })
    const evening = await store.beginAttempt!({ ...base, periodId: 'p_evening', startedAt: '2026-11-02T12:00:00.000Z' })

    expect(await store.markAttemptCleaned!({ editionDate: base.date, periodId: 'p_morning', locale: base.locale, attemptNo: morning, cleanedAt: '2026-11-09T08:10:00.000Z' })).toBe(1)
    expect((await store.listAttempts!(base.date, base.locale, 'p_morning'))[0]?.cleanedAt).toBe('2026-11-09T08:10:00.000Z')
    // The evening issue is a different attempt row; cleaning the morning one must not reach it.
    expect((await store.listAttempts!(base.date, base.locale, 'p_evening'))[0]?.cleanedAt).toBeUndefined()
    expect(evening).toBe(1)

    // Listing for one issue never mixes in the other.
    expect((await store.listAttempts!(base.date, base.locale, 'p_evening')).map((row) => row.attemptNo)).toEqual([evening])
    expect((await store.listAttempts!(base.date, base.locale, 'p_morning')).map((row) => row.attemptNo)).toEqual([morning])
  })
})
