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
    state: 'running' as const,
    startedAt: '2026-11-02T00:00:00.000Z'
  })

  it('replaces the run when the period is regenerated, and settles its state in place', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    await store.openPeriodRun!(run('bs_first', 'hash-first'))
    // A regeneration replaces the editions, so the run has to describe the batch that produced them.
    await store.openPeriodRun!(run('bs_second', 'hash-second'))

    expect(await store.getPeriodRun!('2026-11-02')).toMatchObject({
      periodId: 'default', expectedLocales: ['zh-CN'], snapshotId: 'bs_second', snapshotHash: 'hash-second', state: 'running'
    })

    await store.settlePeriodRun!({ date: '2026-11-02', periodId: 'default', state: 'published', finishedAt: '2026-11-02T00:05:00.000Z', writingRounds: 1 })
    expect(await store.getPeriodRun!('2026-11-02')).toMatchObject({ state: 'published', writingRounds: 1, finishedAt: '2026-11-02T00:05:00.000Z' })
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
