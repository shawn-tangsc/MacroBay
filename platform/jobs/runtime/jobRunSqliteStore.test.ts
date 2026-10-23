import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJobRunSqliteStore } from './jobRunSqliteStore'
import { QUEUED_AT_RESTART_ERROR } from './jobRunStore'

const stores: Array<ReturnType<typeof createJobRunSqliteStore>> = []
const tempDirs: string[] = []

describe('jobRunSqliteStore', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const store of stores.splice(0)) {
      store.close()
    }
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('starts without decoding history and recovers every running page without decoding terminal JSON', async () => {
    const path = await createTempDatabasePath()
    const first = createStore(path)
    for (let index = 0; index < 2105; index += 1) {
      const run = first.createRun({ ...baseInput('derived'), payload: { kind: index < 2050 ? 'terminal-history' : 'active-history' } })
      if (index < 2050) first.markCompleted(run.id)
      else first.markRunning(run.id)
    }
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const parse = vi.spyOn(JSON, 'parse')
    const reopened = createStore(path)
    expect(parse.mock.calls.filter(([value]) => value.includes('history'))).toHaveLength(0)
    const recovered = reopened.recoverStaleRunningRuns()
    expect(recovered).toHaveLength(55)
    expect(new Set(recovered.map((run) => run.id)).size).toBe(55)
    expect(recovered.every((run) => run.status === 'failed')).toBe(true)
    expect(parse.mock.calls.filter(([value]) => value.includes('terminal-history'))).toHaveLength(0)
    expect(reopened.recoverStaleRunningRuns()).toEqual([])
    expect(reopened.getRun('run-sqlite-1')?.status).toBe('completed')
    expect(reopened.createRun(baseInput('new')).id).toBe('run-sqlite-2106')
  })

  it('uses a separate SQLite sequence so legacy run IDs remain untouched and new IDs stay unique', async () => {
    const path = await createTempDatabasePath()
    const first = createStore(path)
    first.createRun(baseInput('original'))
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const db = new DatabaseSync(path)
    const columns = (db.prepare('pragma table_info(job_runs)').all() as { name: string }[]).map((row) => row.name)
    const source = db.prepare(`select ${columns.join(',')} from job_runs where id = 'run-sqlite-1'`).get() as Record<string, unknown>
    for (const id of ['run-1', 'run-0010', 'run-200x', 'run-300.5', 'run--400', 'run-', 'run-500\n', 'run-9007199254740993']) {
      const values = columns.map((column) => column === 'id' ? id : source[column])
      db.prepare(`insert into job_runs (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`).run(...values as import('node:sqlite').SQLInputValue[])
    }
    db.close()
    const reopened = createStore(path)
    expect(reopened.createRun(baseInput('new')).id).toBe('run-sqlite-2')
    expect(reopened.createRun(baseInput('newer')).id).toBe('run-sqlite-3')
    expect(reopened.getRun('run-0010')?.definitionId).toBe('original')
  })

  it('allocates unique sequence IDs across a reopened store while retaining legacy rows', async () => {
    const path = await createTempDatabasePath()
    const first = createStore(path)
    const firstIds = [first.createRun(baseInput('a')).id, first.createRun(baseInput('b')).id]
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const second = createStore(path)
    const secondIds = [second.createRun(baseInput('c')).id, second.createRun(baseInput('d')).id]
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4)
    expect(firstIds).toEqual(['run-sqlite-1', 'run-sqlite-2'])
    expect(secondIds).toEqual(['run-sqlite-3', 'run-sqlite-4'])
    expect(second.getRun('run-1')).toBeUndefined()
  })

  it('allocates across simultaneous store instances without startup history reads', async () => {
    const path = await createTempDatabasePath()
    const first = createStore(path)
    const second = createStore(path)
    const ids = Array.from({ length: 30 }, (_, index) =>
      (index % 2 === 0 ? first : second).createRun(baseInput('multi-instance')).id)
    expect(new Set(ids).size).toBe(30)
    expect(ids[29]).toBe('run-sqlite-30')
    const third = createStore(path)
    expect(third.createRun(baseInput('reopened')).id).toBe('run-sqlite-31')
    expect(first.queryRunPage({ limit: 100 }).runs).toHaveLength(31)
  })

  it('opens and allocates without selecting or aggregating legacy history', async () => {
    const path = await createTempDatabasePath()
    const seed = createStore(path)
    seed.createRun(baseInput('seed'))
    seed.close()
    stores.splice(stores.indexOf(seed), 1)
    const originalPrepare = DatabaseSync.prototype.prepare
    const queries: string[] = []
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql) {
      queries.push(sql)
      return originalPrepare.call(this, sql)
    })
    const reopened = createStore(path)
    expect(reopened.createRun(baseInput('new')).id).toBe('run-sqlite-2')
    expect(queries.some((sql) => /max\s*\(|substr\s*\(|select\s+\*/i.test(sql))).toBe(false)
    expect(queries.filter((sql) => /from job_runs/i.test(sql)).every((sql) => /id glob \? limit 1/i.test(sql))).toBe(true)
  })

  it('recreates an initially missing sequence row and never falls back after allocation failure', async () => {
    const path = await createTempDatabasePath()
    const first = createStore(path)
    const db = new DatabaseSync(path)
    db.exec('delete from job_run_sequence')
    expect(first.createRun(baseInput('first')).id).toBe('run-sqlite-1')
    db.exec("create trigger deny_allocation before update on job_run_sequence begin select raise(abort, 'synthetic denial'); end")
    expect(() => first.createRun(baseInput('denied'))).toThrow('synthetic denial')
    expect(first.queryRunPage().runs).toHaveLength(1)
    db.exec('drop trigger deny_allocation')
    expect(first.createRun(baseInput('next')).id).toBe('run-sqlite-2')
    db.exec('delete from job_run_sequence')
    expect(() => first.createRun(baseInput('lost-sequence'))).toThrow('Job run sequence unavailable.')
    expect(first.queryRunPage().runs).toHaveLength(2)
    db.close()
  })

  it('persists run lifecycle updates, logs, progress, and query pages', () => {
    const store = createStore()
    const run = store.createRun({
      definitionId: 'platform.agent.task.task-1',
      handlerId: 'agent-task',
      owner: 'platform',
      title: 'Agent task',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1', agentId: 'agent-1' },
      maxAttempts: 2
    })

    store.markRunning(run.id)
    store.appendLog(run.id, {
      at: '2026-01-01T00:00:01.000Z',
      level: 'info',
      message: 'started',
      metadata: { taskId: 'task-1' }
    })
    store.setProgress(run.id, { current: 1, total: 2, message: 'halfway' })
    store.markCompleted(run.id)

    const loaded = store.getRun(run.id)
    const page = store.queryRunPage({
      owner: 'platform',
      statuses: ['completed'],
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1' },
      limit: 10
    })

    expect(loaded).toMatchObject({
      id: run.id,
      status: 'completed',
      progress: { current: 1, total: 2, message: 'halfway' },
      logs: [{ level: 'info', message: 'started', metadata: { taskId: 'task-1' } }]
    })
    expect(page.runs.map((item) => item.id)).toEqual([run.id])
  })

  it('persists cancellation reasons on cancelled runs', () => {
    const store = createStore()
    const run = store.createRun({
      definitionId: 'platform.agent.task.task-cancelled',
      handlerId: 'agent-task',
      owner: 'platform',
      title: 'Cancelled task',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-cancelled' },
      maxAttempts: 1
    })

    store.markCancelled(run.id, 'Cancelled by user.')

    expect(store.getRun(run.id)).toMatchObject({
      status: 'cancelled',
      lastError: 'Cancelled by user.'
    })
  })

  it('keeps retrying runs in running state when incrementing attempts', () => {
    const store = createStore()
    const run = store.createRun({
      definitionId: 'platform.agent.task.task-retrying',
      handlerId: 'agent-task',
      owner: 'platform',
      title: 'Retrying task',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-retrying' },
      maxAttempts: 2
    })

    store.markRunning(run.id)
    const retried = store.incrementAttempt(run.id)

    expect(retried).toMatchObject({
      id: run.id,
      attempt: 2,
      status: 'running'
    })
  })

  it('reopens persisted runs and continues the monotonic run id sequence', async () => {
    const path = await createTempDatabasePath()
    const firstStore = createStore(path)
    const firstRun = firstStore.createRun(baseInput('first'))
    firstStore.close()
    stores.splice(stores.indexOf(firstStore), 1)

    const secondStore = createStore(path)
    const secondRun = secondStore.createRun(baseInput('second'))

    expect(secondStore.getRun(firstRun.id)?.definitionId).toBe('first')
    expect(secondRun.id).toBe('run-sqlite-2')
  })

  it('recovers stale running runs after process restart', async () => {
    const path = await createTempDatabasePath()
    const firstStore = createStore(path)
    const run = firstStore.createRun(baseInput('stale'))
    firstStore.markRunning(run.id)
    firstStore.close()
    stores.splice(stores.indexOf(firstStore), 1)

    const secondStore = createStore(path)
    const recovered = secondStore.recoverStaleRunningRuns()

    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      id: run.id,
      status: 'failed',
      lastError: 'Job run interrupted by process restart.'
    })
  })

  it('settles runs that were still queued when the process stopped', async () => {
    const path = await createTempDatabasePath()
    const firstStore = createStore(path)
    const queued = firstStore.createRun(baseInput('queued'))
    // A `queued` row from a previous process is what this store used to keep forever.
    expect(queued.status).toBe('queued')
    firstStore.close()
    stores.splice(stores.indexOf(firstStore), 1)

    const secondStore = createStore(path)
    const recovered = secondStore.recoverStaleQueuedRuns()

    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      id: queued.id,
      status: 'cancelled',
      lastError: QUEUED_AT_RESTART_ERROR
    })
    expect(secondStore.getRun(queued.id)?.status).toBe('cancelled')
    expect(secondStore.recoverStaleQueuedRuns()).toEqual([])
  })
})

function createStore(path = ':memory:'): ReturnType<typeof createJobRunSqliteStore> {
  const store = createJobRunSqliteStore(path)
  stores.push(store)
  return store
}

async function createTempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'job-run-sqlite-store-'))
  tempDirs.push(dir)
  return join(dir, 'jobs.sqlite')
}

function baseInput(definitionId: string) {
  return {
    definitionId,
    handlerId: 'handler-1',
    owner: 'platform' as const,
    title: definitionId,
    trigger: { kind: 'manual' as const },
    payload: {},
    maxAttempts: 1
  }
}
