import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { JobRunRecord } from '../contracts/jobTypes'
import { createJobRunSqliteRepository } from './jobRunSqliteRepository'

const repositories: Array<ReturnType<typeof createJobRunSqliteRepository>> = []

describe('jobRunSqliteRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const repository of repositories.splice(0)) {
      repository.close()
    }
  })

  it('bounds SQLite returned rows and JSON decoding to the requested page', () => {
    const repository = createRepository()
    for (let index = 0; index < 2500; index += 1) {
      repository.upsertRun(runFixture({ id: `run-${index}`, payload: { marker: 'derived-history' } }))
    }
    const probe = new DatabaseSync(':memory:')
    const prototype = Object.getPrototypeOf(probe.prepare('select 1'))
    const original = prototype.all
    let returnedRows = 0
    vi.spyOn(prototype, 'all').mockImplementation(function (this: object, ...args: unknown[]) {
      const rows = original.apply(this, args)
      returnedRows += rows.length
      return rows
    })
    const parse = vi.spyOn(JSON, 'parse')
    const page = repository.listRunPage({ limit: 20 })
    expect(page.runs).toHaveLength(20)
    expect(page.nextCursor).not.toBeNull()
    expect(returnedRows).toBeLessThanOrEqual(21)
    expect(parse.mock.calls.filter(([value]) => value.includes('derived-history'))).toHaveLength(20)
    probe.close()
  })

  it('caps finite large pages at 1000 with continuation and preserves limit normalization', () => {
    const repository = createRepository()
    for (let index = 0; index < 1005; index += 1) repository.upsertRun(runFixture({ id: `run-${index}` }))
    const page = repository.listRunPage({ limit: 5000 })
    expect(page.runs).toHaveLength(1000)
    expect(repository.listRunPage({ limit: 5000, cursor: page.nextCursor }).runs).toHaveLength(5)
    for (const limit of [undefined, NaN, Infinity, -Infinity]) {
      expect(repository.listRunPage({ limit }).runs).toHaveLength(20)
    }
    for (const limit of [-1, 0, 0.5]) expect(repository.listRunPage({ limit })).toEqual({ runs: [], nextCursor: null })
  })

  it('filters persisted payload types and literal special-character keys before pagination', () => {
    const repository = createRepository()
    const key = 'a."[0]\\key'
    const values = [null, false, 0, true, 1, '1', '', { x: 1 }, [1]]
    for (let index = 0; index < values.length; index += 1) {
      repository.upsertRun(runFixture({ id: `run-${index}`, payload: { [key]: values[index] } }))
    }
    repository.upsertRun(runFixture({ id: 'run-missing', payload: {} }))
    for (let index = 0; index < 7; index += 1) {
      expect(repository.listRunPage({ payload: { [key]: values[index] }, limit: 1 }).runs.map((run) => run.id))
        .toEqual([`run-${index}`])
    }
    expect(repository.listRunPage({ payload: { [key]: undefined } }).runs.map((run) => run.id)).toEqual(['run-missing'])
    for (const value of [{ x: 1 }, [1], NaN, Infinity, -0]) {
      expect(repository.listRunPage({ payload: { [key]: value } }).runs).toEqual([])
    }
    expect(repository.listRunPage({ payload: { [key]: true }, cursor: 'run-8' }).runs).toEqual([])
    expect(repository.listRunPage({ cursor: 'missing' }).runs).toEqual([])
  })

  it('matches persisted JSON numbers with JS precision without matching other primitive types', () => {
    const repository = createRepository()
    const values = [0, 1, 9007199254740991, 9007199254740992, 9007199254740994, 1000000000000000100, 1000000000000000300, 1e-12, 0.25, 1e18, 1e300, Number.MAX_VALUE, Number.MIN_VALUE]
    for (const [index, value] of values.entries()) {
      repository.upsertRun(runFixture({ id: `run-${index}`, payload: { value } }))
      expect(() => repository.listRunPage({ payload: { value } })).not.toThrow()
      expect(repository.listRunPage({ payload: { value } }).runs.map((run) => run.id)).toEqual([`run-${index}`])
    }
    repository.upsertRun(runFixture({ id: 'run-bool', payload: { value: true } }))
    repository.upsertRun(runFixture({ id: 'run-string', payload: { value: '1' } }))
    repository.upsertRun(runFixture({ id: 'run-null', payload: { value: null } }))
    repository.upsertRun(runFixture({ id: 'run-missing', payload: {} }))
    expect(repository.listRunPage({ payload: { value: true } }).runs.map((run) => run.id)).toEqual(['run-bool'])
    expect(repository.listRunPage({ payload: { value: 1 } }).runs.map((run) => run.id)).toEqual(['run-1'])
    expect(repository.listRunPage({ payload: { value: '1' } }).runs.map((run) => run.id)).toEqual(['run-string'])
    expect(repository.listRunPage({ payload: { value: null } }).runs.map((run) => run.id)).toEqual(['run-null'])
    expect(repository.listRunPage({ payload: { value: undefined } }).runs.map((run) => run.id)).toEqual(['run-missing'])
  })

  it('preserves scope, escaped prefix and scoped cursor while paging sparse payload matches', () => {
    const repository = createRepository()
    for (let index = 0; index < 90; index += 1) {
      repository.upsertRun(runFixture({ id: `run-${String(index).padStart(3, '0')}`, definitionId: 'scope_%\\job',
        payload: { match: index % 30 === 0 }, productId: 'test-product' }))
    }
    repository.upsertRun(runFixture({ id: 'run-z', definitionId: 'scope-other', payload: { match: true } }))
    const query = { definitionIdPrefix: 'scope_%\\', productId: 'test-product', payload: { match: true }, limit: 1 }
    const first = repository.listRunPage(query)
    const second = repository.listRunPage({ ...query, cursor: first.nextCursor })
    const third = repository.listRunPage({ ...query, cursor: second.nextCursor })
    expect([first.runs[0]?.id, second.runs[0]?.id, third.runs[0]?.id]).toEqual(['run-060', 'run-030', 'run-000'])
    expect(third.nextCursor).toBeNull()
    expect(repository.listRunPage({ ...query, cursor: 'run-z' }).runs).toEqual([])
  })

  it('pages mixed legacy and SQLite IDs in lexical order without duplicates or scope escape', () => {
    const repository = createRepository()
    const ids = ['run-1', 'run-10', 'run-9', 'run-sqlite-1', 'run-sqlite-10', 'run-sqlite-2']
    for (const id of ids) repository.upsertRun(runFixture({ id, owner: 'platform' }))
    repository.upsertRun(runFixture({ id: 'run-sqlite-3', owner: 'product' }))
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const page = repository.listRunPage({ owner: 'platform', cursor, limit: 2 })
      collected.push(...page.runs.map((run) => run.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(collected).toEqual([...ids].sort().reverse())
    expect(new Set(collected).size).toBe(ids.length)
    expect(repository.listRunPage({ owner: 'platform', cursor: 'run-sqlite-3' }).runs).toEqual([])
  })

  it('upserts and reloads durable job runs with json fields preserved', () => {
    const repository = createRepository()
    const run = runFixture({
      id: 'run-1',
      definitionId: 'platform.agent.task.task-1',
      payload: { taskId: 'task-1', nested: { runLogId: 'log-1' } },
      progress: { current: 1, total: 2, message: 'halfway' },
      logs: [
        {
          at: '2026-01-01T00:00:01.000Z',
          level: 'info',
          message: 'started',
          metadata: { taskId: 'task-1' }
        }
      ]
    })

    repository.upsertRun(run)

    expect(repository.getRun('run-1')).toEqual(run)
  })

  it('returns cloned run records so callers cannot mutate persisted state', () => {
    const repository = createRepository()
    repository.upsertRun(
      runFixture({
        id: 'run-1',
        payload: { taskId: 'task-1' },
        logs: [{ at: '2026-01-01T00:00:01.000Z', level: 'info', message: 'started' }]
      })
    )

    const loaded = repository.getRun('run-1')
    loaded?.logs.push({ at: '2026-01-01T00:00:02.000Z', level: 'error', message: 'mutated' })
    if (loaded?.payload && typeof loaded.payload === 'object' && !Array.isArray(loaded.payload)) {
      ;(loaded.payload as Record<string, unknown>).taskId = 'mutated'
    }

    expect(repository.getRun('run-1')?.logs).toHaveLength(1)
    expect(repository.getRun('run-1')?.payload).toEqual({ taskId: 'task-1' })
  })

  it('filters durable runs by owner, status, definition, and payload metadata', () => {
    const repository = createRepository()
    repository.upsertRun(
      runFixture({
        id: 'run-1',
        definitionId: 'platform.agent.task.task-1',
        status: 'completed',
        payload: { taskId: 'task-1', agentId: 'agent-1' }
      })
    )
    repository.upsertRun(
      runFixture({
        id: 'run-2',
        definitionId: 'platform.agent.task.task-2',
        status: 'failed',
        payload: { taskId: 'task-2', agentId: 'agent-1' },
        lastError: 'failed'
      })
    )
    repository.upsertRun(
      runFixture({
        id: 'run-3',
        definitionId: 'product-job',
        owner: 'product',
        productId: 'sample-product',
        status: 'completed',
        payload: { taskId: 'task-1', agentId: 'agent-1' }
      })
    )

    const page = repository.listRunPage({
      owner: 'platform',
      statuses: ['completed'],
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1', agentId: 'agent-1' },
      limit: 10
    })

    expect(page.runs.map((run) => run.id)).toEqual(['run-1'])
    expect(page.nextCursor).toBeNull()
  })

  it('paginates durable runs with stable run id cursors using recent-first ordering', () => {
    const repository = createRepository()
    repository.upsertRun(runFixture({ id: 'run-1', definitionId: 'platform.agent.task.first' }))
    repository.upsertRun(runFixture({ id: 'run-2', definitionId: 'platform.agent.task.second' }))
    repository.upsertRun(runFixture({ id: 'run-3', definitionId: 'platform.agent.task.third' }))

    const firstPage = repository.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      limit: 2
    })
    const secondPage = repository.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.runs.map((run) => run.id)).toEqual(['run-3', 'run-2'])
    expect(firstPage.nextCursor).toBe('run-2')
    expect(secondPage.runs.map((run) => run.id)).toEqual(['run-1'])
    expect(secondPage.nextCursor).toBeNull()
  })
})

function createRepository(): ReturnType<typeof createJobRunSqliteRepository> {
  const repository = createJobRunSqliteRepository(':memory:')
  repositories.push(repository)
  return repository
}

function runFixture(input: Partial<JobRunRecord> & { id: string }): JobRunRecord {
  return {
    id: input.id,
    definitionId: input.definitionId ?? 'platform.agent.task.task-1',
    handlerId: input.handlerId ?? 'agent-task',
    owner: input.owner ?? 'platform',
    productId: input.productId,
    title: input.title ?? 'Agent task',
    status: input.status ?? 'queued',
    trigger: input.trigger ?? { kind: 'manual' },
    payload: input.payload ?? {},
    concurrencyKey: input.concurrencyKey,
    attempt: input.attempt ?? 1,
    maxAttempts: input.maxAttempts ?? 1,
    createdAt: input.createdAt ?? '2026-01-01T00:00:00.000Z',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    lastError: input.lastError,
    progress: input.progress,
    logs: input.logs ?? []
  }
}
