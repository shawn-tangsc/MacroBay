import { describe, expect, it } from 'vitest'

import { createJobRuntime } from './jobRuntime'
import { createJobRunQueryService } from './jobRunQueryService'
import { createJobRunSqliteRepository } from './jobRunSqliteRepository'

describe('jobRunQueryService', () => {
  it('returns cloned paged job runs for Data API-style callers', async () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('noop', async () => {})
    const service = createJobRunQueryService({ runtime })

    const first = await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-1',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task 1',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1', agentId: 'agent-1' }
    })
    await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-2',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task 2',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1', agentId: 'agent-1' }
    })

    const page = await service.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1' },
      limit: 1
    })
    page.runs[0]!.logs.push({
      at: '2026-01-01T00:00:00.000Z',
      level: 'error',
      message: 'mutated outside runtime'
    })

    const nextPage = await service.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1' },
      cursor: page.nextCursor,
      limit: 1
    })
    const detail = await service.getRun(first.id)

    expect(page.runs).toHaveLength(1)
    expect(page.nextCursor).toBeTruthy()
    expect(nextPage.runs.map((run) => run.id)).toEqual([first.id])
    expect(detail?.logs).toEqual([])
  })

  it('returns null for missing run details', async () => {
    const runtime = createJobRuntime()
    const service = createJobRunQueryService({ runtime })

    await expect(service.getRun('missing-run')).resolves.toBeNull()
  })

  it('can read from a durable sqlite job run repository', async () => {
    const repository = createJobRunSqliteRepository(':memory:')
    try {
      const service = createJobRunQueryService({ runtime: repository })
      repository.upsertRun({
        id: 'run-1',
        definitionId: 'platform.agent.task.task-1',
        handlerId: 'agent-task',
        owner: 'platform',
        title: 'Agent task',
        status: 'completed',
        trigger: { kind: 'manual' },
        payload: { taskId: 'task-1' },
        attempt: 1,
        maxAttempts: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        progress: { current: 1, message: 'done' },
        logs: [{ at: '2026-01-01T00:00:01.000Z', level: 'info', message: 'done' }]
      })

      const page = await service.listRunPage({
        owner: 'platform',
        definitionIdPrefix: 'platform.agent.task.',
        payload: { taskId: 'task-1' },
        limit: 10
      })
      const detail = await service.getRun('run-1')

      expect(page.runs.map((run) => run.id)).toEqual(['run-1'])
      expect(detail?.progress).toEqual({ current: 1, message: 'done' })
    } finally {
      repository.close()
    }
  })
})
