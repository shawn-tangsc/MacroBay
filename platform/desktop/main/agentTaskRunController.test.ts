import { describe, expect, it, vi } from 'vitest'

import type { JobRunQueryService, JobRunRecord, JobRuntime } from '../../jobs'
import { createAgentTaskRunController } from './agentTaskRunController'

describe('agentTaskRunController', () => {
  it('cancels a running platform task job by run log id', async () => {
    const runningJob: JobRunRecord = {
      id: 'run-1',
      definitionId: 'platform.agent.task.task-run-1',
      handlerId: 'platform.agent.task.run',
      owner: 'platform',
      title: 'Agent task',
      status: 'running',
      trigger: { kind: 'manual' },
      payload: { runLogId: 'task-run-1', taskId: 'task-1', agentId: 'agent-1' },
      attempt: 1,
      maxAttempts: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      logs: []
    }
    const jobRuntime = {
      cancel: vi.fn()
    } as unknown as Pick<JobRuntime, 'cancel'>
    const jobs: JobRunQueryService = {
      getRun: vi.fn(async () => null),
      listRunPage: vi.fn(async () => ({
        runs: [runningJob],
        nextCursor: null
      }))
    }
    const controller = createAgentTaskRunController({ jobs, jobRuntime })

    await expect(controller.cancelTaskRun('task-run-1')).resolves.toEqual({
      runLogId: 'task-run-1',
      jobRunId: 'run-1',
      cancelled: true
    })
    expect(jobs.listRunPage).toHaveBeenCalledWith({
      owner: 'platform',
      handlerId: 'platform.agent.task.run',
      statuses: ['queued', 'running'],
      payload: { runLogId: 'task-run-1' },
      limit: 1
    })
    expect(jobRuntime.cancel).toHaveBeenCalledWith('run-1', {
      kind: 'cancelled',
      message: 'Cancelled by user.'
    })
  })

  it('returns cancelled false when no queued or running job matches the run log id', async () => {
    const jobRuntime = {
      cancel: vi.fn()
    } as unknown as Pick<JobRuntime, 'cancel'>
    const jobs: JobRunQueryService = {
      getRun: vi.fn(async () => null),
      listRunPage: vi.fn(async () => ({
        runs: [],
        nextCursor: null
      }))
    }
    const controller = createAgentTaskRunController({ jobs, jobRuntime })

    await expect(controller.cancelTaskRun('task-run-missing')).resolves.toEqual({
      runLogId: 'task-run-missing',
      jobRunId: null,
      cancelled: false
    })
    expect(jobRuntime.cancel).not.toHaveBeenCalled()
  })
})
