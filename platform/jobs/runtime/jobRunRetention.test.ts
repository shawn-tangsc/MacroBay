import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createJobRunSqliteRepository } from './jobRunSqliteRepository'
import { jobRunRetentionPolicy, runJobRunRetention, scheduleJobRunRetention } from './jobRunRetention'
import type { JobRunRecord } from '../contracts/jobTypes'

const created: string[] = []
afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'job-retention-'))
  created.push(directory)
  const store = createJobRunSqliteRepository(join(directory, 'jobs.sqlite'))
  let sequence = 0
  const append = (definitionId: string, status: JobRunRecord['status'], createdAt: string): void => {
    sequence += 1
    store.upsertRun({
      id: `run-${sequence}`, definitionId, handlerId: `${definitionId}.handler`, owner: 'platform',
      title: definitionId, status, trigger: { kind: 'interval' }, payload: {}, attempt: 1, maxAttempts: 1,
      createdAt, startedAt: createdAt, completedAt: createdAt, logs: [{ at: createdAt, level: 'info', message: 'done' }]
    } as JobRunRecord)
  }
  return { store, append }
}

const now = '2026-10-08T00:00:00.000Z'
const withinWindow = '2026-09-20T00:00:00.000Z'
const outsideWindow = '2026-08-01T00:00:00.000Z'

describe('job run retention', () => {
  it('keeps runs inside the detail window and aggregates only the ones it removes', () => {
    const { store, append } = repository()
    append('collect.a', 'completed', withinWindow)
    append('collect.a', 'completed', outsideWindow)
    append('collect.a', 'failed', outsideWindow)
    append('collect.b', 'completed', outsideWindow)

    const result = runJobRunRetention({ store, now: () => now })

    expect(result.deletedRuns).toBe(3)
    expect(store.listRunPage({}).runs.map(run => run.id)).toEqual(['run-1'])
    expect(store.listRunAggregates()).toEqual([
      { day: '2026-08-01', definitionId: 'collect.a', runs: 2, failures: 1 },
      { day: '2026-08-01', definitionId: 'collect.b', runs: 1, failures: 0 }
    ])
    store.close()
  })

  it('is idempotent, so a repeated sweep cannot double count', () => {
    const { store, append } = repository()
    append('collect.a', 'completed', outsideWindow)
    append('collect.a', 'failed', outsideWindow)

    expect(runJobRunRetention({ store, now: () => now }).deletedRuns).toBe(2)
    expect(runJobRunRetention({ store, now: () => now }).deletedRuns).toBe(0)
    expect(store.listRunAggregates()).toEqual([{ day: '2026-08-01', definitionId: 'collect.a', runs: 2, failures: 1 }])
    store.close()
  })

  it('stops at the batch limit and reports that more work remains', () => {
    const { store, append } = repository()
    for (let index = 0; index < 5; index += 1) append('collect.a', 'completed', outsideWindow)

    const first = runJobRunRetention({ store, now: () => now, batchLimit: 2 })

    expect(first.deletedRuns).toBe(2)
    expect(first.hasMore).toBe(true)
    expect(store.listRunAggregates()).toEqual([{ day: '2026-08-01', definitionId: 'collect.a', runs: 2, failures: 0 }])
    expect(runJobRunRetention({ store, now: () => now, batchLimit: 2 }).deletedRuns).toBe(2)
    expect(runJobRunRetention({ store, now: () => now, batchLimit: 2 }).deletedRuns).toBe(1)
    expect(store.listRunPage({}).runs).toEqual([])
    expect(store.listRunAggregates()).toEqual([{ day: '2026-08-01', definitionId: 'collect.a', runs: 5, failures: 0 }])
    store.close()
  })

  it('sweeps once immediately and then on its interval, and survives a failing sweep', () => {
    const timers: { callback: () => void; cleared: boolean }[] = []
    let calls = 0
    const store = {
      purgeRunsOlderThan: () => {
        calls += 1
        if (calls === 2) throw new Error('transient')
        return { deletedRuns: 0, hasMore: false }
      }
    }
    const dispose = scheduleJobRunRetention(store, {
      setInterval: (callback) => { timers.push({ callback, cleared: false }); return 1 as unknown as ReturnType<typeof setInterval> },
      clearInterval: () => { for (const timer of timers) timer.cleared = true }
    })
    expect(calls).toBe(1)
    expect(() => timers[0]!.callback()).not.toThrow()
    expect(calls).toBe(2)
    dispose()
    expect(timers[0]!.cleared).toBe(true)
  })

  it('names the policy values the sweep depends on', () => {
    expect(jobRunRetentionPolicy.detailRetentionDays).toBe(30)
    expect(jobRunRetentionPolicy.batchLimit).toBeGreaterThan(0)
    expect(jobRunRetentionPolicy.sweepIntervalMs).toBeGreaterThan(0)
  })
})
