import { describe, expect, it, vi } from 'vitest'

import type { CreateTaskDto, Trigger, UpdateTaskDto } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobRunQuery } from '@platform/jobs'

import {
  cancelTaskRunViaApi,
  createTaskViaApi,
  deleteTaskViaApi,
  getTaskDeliveryAttemptsViaApi,
  getTaskAutomationPolicyViaApi,
  getTaskDeliveryReadinessViaApi,
  getTaskLogsViaApi,
  listTaskJobPageViaApi,
  listTaskMutationAuditsViaApi,
  listTaskPageViaApi,
  listTasksViaApi,
  previewTaskScheduleViaApi,
  retryTaskDeliveryViaApi,
  runTaskViaApi,
  updateTaskAutomationPolicyViaApi,
  updateTaskViaApi
} from './agentTaskDataApi'

describe('agentTaskDataApi', () => {
  it('routes task settings calls through generic platform agent IPC', async () => {
    const createTask = vi.fn(async () => ({ id: 'task-1' }))
    const updateTask = vi.fn(async () => ({ id: 'task-1', enabled: false }))
    const deleteTask = vi.fn(async () => true)
    const platform = { agents: { createTask, updateTask, deleteTask } } as unknown as Window['platform']
    const createDto: CreateTaskDto = {
      name: 'Task',
      prompt: 'Run',
      trigger: { kind: 'interval', ms: 60000 },
      workspace: { type: 'system' }
    }
    const updateDto: UpdateTaskDto = { enabled: false }

    await expect(createTaskViaApi(platform, 'agent-1', createDto)).resolves.toEqual({ id: 'task-1' })
    await expect(updateTaskViaApi(platform, 'agent-1', 'task-1', 4, updateDto)).resolves.toEqual({
      id: 'task-1',
      enabled: false
    })
    await expect(deleteTaskViaApi(platform, 'agent-1', 'task-1', 5)).resolves.toBe(true)

    expect(createTask).toHaveBeenCalledWith('agent-1', createDto)
    expect(updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { expectedRevision: 4, patch: updateDto })
    expect(deleteTask).toHaveBeenCalledWith('agent-1', 'task-1', { expectedRevision: 5 })
  })

  it('routes task logs, manual run, cancel, and job read-model calls through generic platform IPC', async () => {
    const listTasks = vi.fn(async () => ({ tasks: [{ id: 'task-1' }], total: 1 }))
    const getTaskLogs = vi.fn(async () => ({ logs: [{ id: 'run-1' }], total: 1 }))
    const runTask = vi.fn(async () => ({ taskId: 'task-1', runLogId: 'run-2' }))
    const cancelTaskRun = vi.fn(async () => ({ runLogId: 'run-1', jobRunId: 'job-1', cancelled: true }))
    const listRunPage = vi.fn(async () => ({ runs: [{ id: 'job-1' }], nextCursor: null }))
    const query: JobRunQuery = { owner: 'platform', payload: { runLogId: 'run-1' }, limit: 1 }
    const platform = {
      agents: { listTasks, getTaskLogs, runTask, cancelTaskRun },
      jobs: { listRunPage }
    } as unknown as Window['platform']

    await expect(listTasksViaApi(platform, 'agent-1', { limit: 20 })).resolves.toEqual({
      tasks: [{ id: 'task-1' }],
      total: 1
    })
    await expect(getTaskLogsViaApi(platform, 'agent-1', 'task-1', { limit: 10 })).resolves.toEqual({
      logs: [{ id: 'run-1' }],
      total: 1
    })
    await expect(runTaskViaApi(platform, 'agent-1', 'task-1', 6)).resolves.toEqual({ taskId: 'task-1', runLogId: 'run-2' })
    await expect(cancelTaskRunViaApi(platform, 'run-1')).resolves.toEqual({
      runLogId: 'run-1',
      jobRunId: 'job-1',
      cancelled: true
    })
    await expect(listTaskJobPageViaApi(platform, query)).resolves.toEqual({ runs: [{ id: 'job-1' }], nextCursor: null })

    expect(listTasks).toHaveBeenCalledWith('agent-1', { limit: 20 })
    expect(getTaskLogs).toHaveBeenCalledWith('agent-1', 'task-1', { limit: 10 })
    expect(runTask).toHaveBeenCalledWith('agent-1', 'task-1', { expectedRevision: 6 })
    expect(cancelTaskRun).toHaveBeenCalledWith('run-1')
    expect(listRunPage).toHaveBeenCalledWith(query)
  })

  it('routes schedule preview, channel readiness, bounded delivery attempts, and target retry through task IPC', async () => {
    const previewTaskSchedule = vi.fn(async () => ({ ok: true, nextRunAt: '2026-07-17T09:00:00.000Z' }))
    const getTaskDeliveryReadiness = vi.fn(async () => [{ channelId: 'channel-1', status: 'ready' }])
    const getTaskDeliveryAttempts = vi.fn(async () => ({ attempts: [{ id: 'attempt-1' }], total: 101 }))
    const retryTaskDelivery = vi.fn(async () => ({ delivered: 1, failed: 0, skipped: 0, unknown: 0 }))
    const platform = {
      agents: { previewTaskSchedule, getTaskDeliveryReadiness, getTaskDeliveryAttempts, retryTaskDelivery }
    } as unknown as Window['platform']
    const trigger: Trigger = { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }

    await expect(previewTaskScheduleViaApi(platform, trigger)).resolves.toEqual({ ok: true, nextRunAt: '2026-07-17T09:00:00.000Z' })
    await expect(getTaskDeliveryReadinessViaApi(platform, 'agent-1', 'task-1')).resolves.toEqual([
      { channelId: 'channel-1', status: 'ready' }
    ])
    await expect(getTaskDeliveryAttemptsViaApi(platform, 'agent-1', 'run-1', { limit: 20, offset: 20 })).resolves.toEqual({
      attempts: [{ id: 'attempt-1' }], total: 101
    })
    await expect(retryTaskDeliveryViaApi(platform, 'agent-1', 'run-1', 'attempt-1')).resolves.toEqual({
      delivered: 1, failed: 0, skipped: 0, unknown: 0
    })

    expect(previewTaskSchedule).toHaveBeenCalledWith(trigger)
    expect(getTaskDeliveryReadiness).toHaveBeenCalledWith('agent-1', 'task-1')
    expect(getTaskDeliveryAttempts).toHaveBeenCalledWith('agent-1', 'run-1', { limit: 20, offset: 20 })
    expect(retryTaskDelivery).toHaveBeenCalledWith('agent-1', 'run-1', 'attempt-1')
  })

  it('routes bounded task settings queries and policy updates through existing task IPC', async () => {
    const listTaskPage = vi.fn(async () => ({ tasks: [{ id: 'task-1' }], total: 1 }))
    const listTaskMutationAudits = vi.fn(async () => ({ audits: [{ id: 'audit-1' }], total: 1 }))
    const getTaskAutomationPolicy = vi.fn(async () => ({ preset: 'balanced', policy: { maxActiveTasksPerAgent: 30 } }))
    const updateTaskAutomationPolicy = vi.fn(async () => ({ preset: 'conservative', policy: { maxActiveTasksPerAgent: 10 } }))
    const platform = { agents: { listTaskPage, listTaskMutationAudits, getTaskAutomationPolicy, updateTaskAutomationPolicy } } as unknown as Window['platform']

    await expect(listTaskPageViaApi(platform, { status: 'active', limit: 50 })).resolves.toMatchObject({ total: 1 })
    await expect(listTaskMutationAuditsViaApi(platform, { taskId: 'task-1', limit: 20, offset: 0 })).resolves.toMatchObject({ total: 1 })
    await expect(getTaskAutomationPolicyViaApi(platform)).resolves.toMatchObject({ preset: 'balanced' })
    await expect(updateTaskAutomationPolicyViaApi(platform, 'conservative')).resolves.toMatchObject({ preset: 'conservative' })

    expect(listTaskPage).toHaveBeenCalledWith({ status: 'active', limit: 50 })
    expect(listTaskMutationAudits).toHaveBeenCalledWith({ taskId: 'task-1', limit: 20, offset: 0 })
    expect(getTaskAutomationPolicy).toHaveBeenCalledOnce()
    expect(updateTaskAutomationPolicy).toHaveBeenCalledWith({ policyPreset: 'conservative' })
  })
})
