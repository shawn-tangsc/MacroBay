// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

const api = vi.hoisted(() => ({
  getAttempts: vi.fn(),
  getLogs: vi.fn()
}))

vi.mock('../../agents/agentTaskDataApi', () => ({
  getTaskDeliveryAttemptsViaApi: api.getAttempts,
  getTaskLogsViaApi: api.getLogs
}))

import { loadTaskRunSnapshots } from './taskAutomationTaskRuns'

describe('loadTaskRunSnapshots', () => {
  afterEach(() => {
    api.getAttempts.mockReset()
    api.getLogs.mockReset()
  })

  it('loads the latest run and its delivery counts for every loaded task', async () => {
    api.getLogs.mockImplementation(async (_platform, _agentId, taskId) => ({
      logs: [{ id: `run-${taskId}`, status: 'completed', startedAt: '2026-07-17T08:00:00.000Z' }],
      total: 1
    }))
    api.getAttempts.mockImplementation(async (_platform, _agentId, runLogId) => ({
      attempts: runLogId === 'run-task-1'
        ? [
            { id: 'attempt-1', taskId: 'task-1', status: 'delivered' },
            { id: 'attempt-2', taskId: 'task-1', status: 'failed' },
            { id: 'attempt-3', taskId: 'task-1', status: 'pending' },
            { id: 'attempt-4', taskId: 'task-1', status: 'skipped-no-active-target' },
            { id: 'attempt-5', taskId: 'task-1', status: 'unknown-after-send' }
          ]
        : [{ id: 'attempt-6', taskId: 'task-2', status: 'delivered' }],
      total: 1
    }))

    const snapshots = await loadTaskRunSnapshots(window.platform, [task('task-1'), task('task-2')])

    expect(api.getLogs).toHaveBeenCalledWith(window.platform, 'task-1-agent', 'task-1', { limit: 1 })
    expect(api.getAttempts).toHaveBeenCalledWith(window.platform, 'task-1-agent', 'run-task-1', { limit: 50, offset: 0 })
    expect(snapshots['task-1']).toEqual({
      status: 'completed',
      at: '2026-07-17T08:00:00.000Z',
      health: { delivered: 1, failed: 1, pending: 1, skipped: 1, unknown: 1 }
    })
    expect(snapshots['task-2']?.health.delivered).toBe(1)
  })

  it('omits a task whose latest run could not be read instead of failing the whole page', async () => {
    api.getLogs.mockImplementation(async (_platform, _agentId, taskId) => {
      if (taskId === 'task-broken') throw new Error('sqlite-busy /private/secret')
      return { logs: [{ id: 'run-ok' }], total: 1 }
    })
    api.getAttempts.mockResolvedValue({ attempts: [], total: 0 })

    const snapshots = await loadTaskRunSnapshots(window.platform, [task('task-broken'), task('task-ok')])

    expect(Object.keys(snapshots)).toEqual(['task-ok'])
  })

  it('reports a task without any run log as having no snapshot health', async () => {
    api.getLogs.mockResolvedValue({ logs: [], total: 0 })

    const snapshots = await loadTaskRunSnapshots(window.platform, [task('task-1')])

    expect(snapshots['task-1']).toBeUndefined()
    expect(api.getAttempts).not.toHaveBeenCalled()
  })
})

function task(id: string): ScheduledTaskEntity {
  return {
    id,
    agentId: `${id}-agent`,
    name: id,
    prompt: 'Run',
    trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 5,
    workspace: { type: 'system' },
    enabled: true,
    status: 'active',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z'
  }
}
