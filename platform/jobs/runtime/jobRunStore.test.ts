import { describe, expect, it } from 'vitest'

import type { JobRunRecord } from '../contracts/jobTypes'
import { createJobRunStore } from './jobRunStore'

describe('jobRunStore', () => {
  it('creates queued runs and transitions to terminal states', () => {
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'job-1',
      handlerId: 'handler-1',
      owner: 'product',
      productId: 'sample-product',
      title: 'Test Job',
      trigger: { kind: 'manual' },
      payload: { id: 1 },
      maxAttempts: 2
    })

    expect(run.status).toBe('queued')

    const running = store.markRunning(run.id)
    expect(running?.status).toBe('running')

    const completed = store.markCompleted(run.id)
    expect(completed?.status).toBe('completed')
    expect(completed?.completedAt).toBeTruthy()
  })

  it('recovers stale running runs as failed on startup', () => {
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'job-1',
      handlerId: 'handler-1',
      owner: 'platform',
      title: 'Stale',
      trigger: { kind: 'startup' },
      payload: {},
      maxAttempts: 1
    })
    store.markRunning(run.id)

    const recovered = store.recoverStaleRunningRuns()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.status).toBe('failed')
    expect(recovered[0]?.lastError).toContain('interrupted')
  })

  it('settles a queued run left by a previous process instead of leaving it queued forever', () => {
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'job-1',
      handlerId: 'handler-1',
      owner: 'product',
      productId: 'sample-product',
      title: 'Queued at restart',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })
    const finished = store.createRun({
      definitionId: 'job-2',
      handlerId: 'handler-1',
      owner: 'product',
      title: 'Already finished',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })
    store.markRunning(finished.id)
    store.markCompleted(finished.id)

    const recovered = store.recoverStaleQueuedRuns()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ id: run.id, status: 'cancelled' })
    expect(recovered[0]?.lastError).toContain('still queued')
    expect(store.getRun(finished.id)?.status).toBe('completed')
    // Idempotent: a second startup finds nothing left to settle.
    expect(store.recoverStaleQueuedRuns()).toEqual([])
  })

  it('appends logs and progress snapshots', () => {
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'job-1',
      handlerId: 'handler-1',
      owner: 'platform',
      title: 'Logs',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })

    store.appendLog(run.id, { level: 'info', message: 'started' })
    store.setProgress(run.id, { current: 1, total: 2, message: 'halfway' })

    const updated = store.getRun(run.id)
    expect(updated?.logs).toHaveLength(1)
    expect(updated?.progress).toEqual({ current: 1, total: 2, message: 'halfway' })
  })

  it('stores cancellation reasons on cancelled runs', () => {
    const store = createJobRunStore()
    const run = store.createRun(baseInput('cancelled'))

    store.markCancelled(run.id, 'Cancelled by user.')

    expect(store.getRun(run.id)).toMatchObject({
      status: 'cancelled',
      lastError: 'Cancelled by user.'
    })
  })

  it('keeps retrying runs in running state when incrementing attempts', () => {
    const store = createJobRunStore()
    const run = store.createRun(baseInput('retrying'))

    store.markRunning(run.id)
    const retried = store.incrementAttempt(run.id)

    expect(retried).toMatchObject({
      id: run.id,
      attempt: 2,
      status: 'running'
    })
  })

  it('lists recent runs in reverse chronological order', () => {
    const store = createJobRunStore()
    const first = store.createRun(baseInput('first'))
    const second = store.createRun(baseInput('second'))

    const recent = store.listRecentRuns(10)
    expect(recent.map((run: JobRunRecord) => run.definitionId)).toEqual([second.definitionId, first.definitionId])
  })

  it('queries recent runs by owner, status, definition, and payload metadata', () => {
    const store = createJobRunStore()
    const first = store.createRun({
      ...baseInput('platform.agent.task.task-run-1'),
      payload: {
        taskId: 'task-1',
        runLogId: 'task-run-1',
        agentId: 'agent-1'
      }
    })
    store.markCompleted(first.id)
    const second = store.createRun({
      ...baseInput('platform.agent.task.task-run-2'),
      payload: {
        taskId: 'task-2',
        runLogId: 'task-run-2',
        agentId: 'agent-1'
      }
    })
    store.markFailed(second.id, 'failed')
    store.createRun({
      ...baseInput('product-job'),
      owner: 'product',
      productId: 'sample-product',
      payload: { taskId: 'task-1' }
    })

    const runs = store.queryRuns({
      owner: 'platform',
      statuses: ['completed'],
      definitionIdPrefix: 'platform.agent.task.',
      payload: {
        agentId: 'agent-1',
        taskId: 'task-1'
      },
      limit: 10
    })

    expect(runs.map((run) => run.id)).toEqual([first.id])
  })

  it('paginates queried runs with a stable run id cursor', () => {
    const store = createJobRunStore()
    const first = store.createRun(baseInput('platform.agent.task.first'))
    const second = store.createRun(baseInput('platform.agent.task.second'))
    const third = store.createRun(baseInput('platform.agent.task.third'))

    const firstPage = store.queryRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      limit: 2
    })
    const secondPage = store.queryRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.runs.map((run) => run.id)).toEqual([third.id, second.id])
    expect(firstPage.nextCursor).toBe(second.id)
    expect(secondPage.runs.map((run) => run.id)).toEqual([first.id])
    expect(secondPage.nextCursor).toBeNull()
  })
})

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
