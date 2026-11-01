import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { JobRunRecord } from '../contracts/jobTypes'
import { createJobRunSqliteRepository, type JobRunSqliteRepository } from './jobRunSqliteRepository'
import { createJobRunSqliteStore } from './jobRunSqliteStore'
import { createJobRunStore } from './jobRunStore'
import { createJobRuntime } from './jobRuntime'
import { runJobRunRetention } from './jobRunRetention'

const temporaryDirectories: string[] = []
const repositories: Array<JobRunSqliteRepository | ReturnType<typeof createJobRunSqliteStore>> = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Seeds run details, then folds them into daily counters so the read path has history to answer with. */
function seed(entries: ReadonlyArray<{ definitionId: string; status: JobRunRecord['status']; createdAt: string }>) {
  const directory = mkdtempSync(join(tmpdir(), 'job-aggregates-'))
  temporaryDirectories.push(directory)
  const repository = createJobRunSqliteRepository(join(directory, 'jobs.sqlite'))
  repositories.push(repository)
  entries.forEach((entry, index) => {
    repository.upsertRun(runFixture({ id: `run-${index + 1}`, ...entry }))
  })
  // Everything in this fixture is older than the detail window, so one sweep folds it all.
  repository.purgeRunsOlderThan('2999-01-01T00:00:00.000Z', 500)
  return repository
}

function runFixture(input: {
  id: string
  definitionId: string
  status: JobRunRecord['status']
  createdAt: string
}): JobRunRecord {
  return {
    id: input.id,
    definitionId: input.definitionId,
    handlerId: `${input.definitionId}.handler`,
    owner: 'platform',
    title: input.definitionId,
    status: input.status,
    trigger: { kind: 'interval', intervalMs: 60_000, anchor: 'lastStart' },
    payload: {},
    attempt: 1,
    maxAttempts: 1,
    createdAt: input.createdAt,
    startedAt: input.createdAt,
    completedAt: input.createdAt,
    logs: []
  }
}

describe('daily run aggregates read path', () => {
  it('answers in day-then-definition order regardless of the order rows were folded in', () => {
    const repository = seed([
      { definitionId: 'collect.b', status: 'failed', createdAt: '2026-07-02T09:00:00.000Z' },
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-02T09:00:00.000Z' },
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-01T09:00:00.000Z' }
    ])

    expect(repository.listRunAggregates()).toEqual([
      { day: '2026-07-01', definitionId: 'collect.a', runs: 1, failures: 0 },
      { day: '2026-07-02', definitionId: 'collect.a', runs: 1, failures: 0 },
      { day: '2026-07-02', definitionId: 'collect.b', runs: 1, failures: 1 }
    ])
  })

  it('treats the day window as half-open so a caller cannot be one day off at either end', () => {
    const repository = seed([
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-01T23:59:59.000Z' },
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-02T00:00:00.000Z' },
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-03T00:00:00.000Z' }
    ])

    expect(repository.listRunAggregates({ fromDay: '2026-07-01', toDay: '2026-07-03' }).map(row => row.day))
      .toEqual(['2026-07-01', '2026-07-02'])
    // Only the lower bound: everything from that day on, including the day itself.
    expect(repository.listRunAggregates({ fromDay: '2026-07-02' }).map(row => row.day)).toEqual(['2026-07-02', '2026-07-03'])
    // Only the upper bound: everything before it, never including it.
    expect(repository.listRunAggregates({ toDay: '2026-07-02' }).map(row => row.day)).toEqual(['2026-07-01'])
    expect(repository.listRunAggregates({ fromDay: '2026-07-03', toDay: '2026-07-03' })).toEqual([])
  })

  it('matches the definition prefix literally, so a wildcard character in an id stays literal', () => {
    const repository = seed([
      { definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-01T01:00:00.000Z' },
      { definitionId: 'collectx.a', status: 'completed', createdAt: '2026-07-01T01:00:00.000Z' },
      { definitionId: 'collect_a', status: 'completed', createdAt: '2026-07-01T01:00:00.000Z' },
      { definitionId: 'dailybrief.a', status: 'completed', createdAt: '2026-07-01T01:00:00.000Z' }
    ])

    expect(repository.listRunAggregates({ definitionIdPrefix: 'collect.' }).map(row => row.definitionId))
      .toEqual(['collect.a'])
    // `_` is a LIKE wildcard, but a definition prefix is not a pattern: it must not match collectXa.
    expect(repository.listRunAggregates({ definitionIdPrefix: 'collect_' }).map(row => row.definitionId))
      .toEqual(['collect_a'])
  })

  it('rejects a malformed day instead of quietly widening the answer to every day', () => {
    const repository = seed([{ definitionId: 'collect.a', status: 'completed', createdAt: '2026-07-01T01:00:00.000Z' }])

    expect(() => repository.listRunAggregates({ fromDay: '2026/07/01' })).toThrow(/fromDay/)
    expect(() => repository.listRunAggregates({ toDay: '2026-07-01T00:00:00.000Z' })).toThrow(/toDay/)
  })

  it('still answers for a day whose detail rows the retention window has already dropped', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-aggregates-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'jobs.sqlite')
    const seeder = createJobRunSqliteRepository(path)
    seeder.upsertRun(runFixture({ id: 'run-1', definitionId: 'collect.a', status: 'completed', createdAt: '2026-08-01T06:00:00.000Z' }))
    seeder.upsertRun(runFixture({ id: 'run-2', definitionId: 'collect.a', status: 'failed', createdAt: '2026-08-01T07:00:00.000Z' }))
    seeder.close()

    const store = createJobRunSqliteStore(path)
    repositories.push(store)
    const runtime = createJobRuntime({ store })

    // Detail 31 days old: the retention sweep removes it, so `listRuns` cannot answer any more.
    expect(runJobRunRetention({ store, now: () => '2026-09-01T00:00:00.000Z' }).deletedRuns).toBe(2)
    expect(runtime.listRuns({ definitionId: 'collect.a' })).toEqual([])

    // The daily counters survive that sweep, and the platform read path still answers for that day.
    expect(runtime.listRunAggregates({ fromDay: '2026-08-01', toDay: '2026-08-02' })).toEqual({
      state: 'available',
      rows: [{ day: '2026-08-01', definitionId: 'collect.a', runs: 2, failures: 1 }]
    })
  })

  it('says the memory store cannot answer instead of returning an empty history', () => {
    const runtime = createJobRuntime()

    expect(createJobRunStore().listRunAggregates()).toEqual({
      state: 'unavailable',
      reason: 'memory-store-has-no-aggregates',
      rows: []
    })
    expect(runtime.listRunAggregates()).toEqual({
      state: 'unavailable',
      reason: 'memory-store-has-no-aggregates',
      rows: []
    })
  })
})
