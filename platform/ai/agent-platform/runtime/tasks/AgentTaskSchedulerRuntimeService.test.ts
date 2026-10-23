import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { ScheduledTaskEntity } from '../../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState } from '../../store/agentStore'
import { AgentTaskSchedulerRuntimeService } from './AgentTaskSchedulerRuntimeService'

const createdAt = '2026-01-01T10:00:00.000Z'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Autonomous Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  configuration: { permission_mode: 'bypassPermissions' },
  createdAt,
  updatedAt: createdAt,
  orderKey: 'agent-1'
}

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

function createTask(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-default',
    agentId: agent.id,
    name: 'Task',
    prompt: 'Run',
    trigger: { kind: 'interval', ms: 10 * 60 * 1000 },
    timeoutMinutes: 2,
    workspace: { type: 'system' },
    enabled: true,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentTaskSchedulerRuntimeService', () => {
  it('hands due work to the queued coordinator when one is configured', async () => {
    const state = createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [createTask()] })
    const enqueueDueTask = vi.fn(async () => undefined)
    const dispatchDueTask = vi.fn(async () => undefined)
    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      enqueueDueTask,
      dispatchDueTask
    })

    await runtime.reconcile()

    expect(enqueueDueTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-default' }))
    expect(dispatchDueTask).not.toHaveBeenCalled()
  })

  it('builds and broadcasts scheduler snapshots from platform task state', () => {
    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z'
    })
    const listener = vi.fn()
    runtime.subscribe(listener)

    runtime.syncFromState(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ id: 'task-due' })]
      })
    )

    expect(runtime.getSnapshot().dueTaskIds).toEqual(['task-due'])
    expect(runtime.listDueTasks().map((task) => task.taskId)).toEqual(['task-due'])
    expect(listener).toHaveBeenCalledTimes(1)

    runtime.syncFromState(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ id: 'task-due', enabled: false })]
      })
    )

    expect(runtime.getSnapshot().dueTaskIds).toEqual([])
    expect(runtime.listDueTasks()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('reconciles due tasks on a timer and does not redispatch while the updated state is no longer due', async () => {
    vi.useFakeTimers()

    let state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-due',
          trigger: { kind: 'interval', ms: 60_000 },
          createdAt: '2026-01-01T10:29:00.000Z',
          updatedAt: '2026-01-01T10:29:00.000Z'
        })
      ]
    })
    const dispatchDueTask = vi.fn(async () => {
      state = createAgentStoreState({
        ...state,
        taskRunLogs: [
          {
            id: 'run-1',
            scheduleId: 'task-due',
            startedAt: '2026-01-01T10:30:00.000Z',
            durationMs: 0,
            status: 'running'
          }
        ]
      })
    })

    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 1_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.runOnlyPendingTimersAsync()

    expect(dispatchDueTask).toHaveBeenCalledTimes(1)
    expect(runtime.listDueTasks()).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(dispatchDueTask).toHaveBeenCalledTimes(1)

    runtime.stop()
  })

  it('continues dispatching later due tasks when one due task fails', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [createTask({ id: 'task-a' }), createTask({ id: 'task-b' })]
    })
    const dispatchDueTask = vi.fn(async (task: { taskId: string }) => {
      if (task.taskId === 'task-a') {
        throw new Error('task-a failed')
      }
    })

    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 1_000,
      maximumDelayMs: 60_000
    })

    await expect(runtime.reconcile()).resolves.toBeUndefined()

    expect(dispatchDueTask).toHaveBeenCalledTimes(2)
    expect(dispatchDueTask.mock.calls.map(([task]) => task.taskId)).toEqual(['task-a', 'task-b'])
  })

  it('keeps the reconcile timer alive after a due task dispatch failure', async () => {
    vi.useFakeTimers()

    let currentNow = '2026-01-01T10:30:00.000Z'
    let attempts = 0
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [createTask({ id: 'task-due' })]
    })
    const dispatchDueTask = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('first attempt failed')
      }
    })

    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => currentNow,
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 60_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(dispatchDueTask).toHaveBeenCalledTimes(1)

    currentNow = '2026-01-01T10:31:00.000Z'
    await vi.advanceTimersByTimeAsync(60_000)

    expect(dispatchDueTask).toHaveBeenCalledTimes(2)

    runtime.stop()
  })

  it('does not reschedule the reconcile timer after stop is called during an in-flight reconcile', async () => {
    vi.useFakeTimers()

    let releaseDispatch: (() => void) | null = null
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [createTask({ id: 'task-due' })]
    })
    const dispatchDueTask = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          releaseDispatch = resolve
        })
    )

    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 60_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(dispatchDueTask).toHaveBeenCalledTimes(1)

    runtime.stop()
    ;(releaseDispatch as (() => void) | null)?.()
    await vi.runAllTicks()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(dispatchDueTask).toHaveBeenCalledTimes(1)
  })

  it('can start scheduling again after being stopped', async () => {
    vi.useFakeTimers()

    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [createTask({ id: 'task-restart' })]
    })
    const dispatchDueTask = vi.fn(async () => {})

    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 60_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    runtime.stop()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(dispatchDueTask).toHaveBeenCalledTimes(0)

    runtime.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(dispatchDueTask).toHaveBeenCalledTimes(1)

    runtime.stop()
  })

  it('reconciles implicit heartbeat tasks from agent configuration', async () => {
    vi.useFakeTimers()

    const heartbeatAgent: AgentEntity = {
      ...agent,
      configuration: {
        permission_mode: 'default',
        heartbeat_enabled: true,
        heartbeat_interval: 15
      }
    }
    const mainSession = {
      id: 'session-main',
      agentId: heartbeatAgent.id,
      name: 'Main',
      workspaceId: workspace.id,
      workspace,
      orderKey: 'session-main',
      createdAt,
      updatedAt: '2026-01-01T10:05:00.000Z'
    }

    const state = createAgentStoreState({
      agents: [heartbeatAgent],
      workspaces: [workspace],
      sessions: [mainSession]
    })

    const dispatchDueTask = vi.fn(async () => {})
    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:20:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 1_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.runOnlyPendingTimersAsync()

    expect(dispatchDueTask).toHaveBeenCalledTimes(1)
    expect(dispatchDueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'heartbeat:agent-1:workspace-1',
        executionKind: 'heartbeat',
        sourceSessionId: 'session-main',
        prompt: '__heartbeat__'
      })
    )

    runtime.stop()
  })

  it('recovers after-startup tasks on the first startup reconcile when the overdue window matches', async () => {
    vi.useFakeTimers()

    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [
        createTask({
          id: 'task-after-startup',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 25, 0, 0) },
          catchUpPolicy: { kind: 'after-startup', minutes: 10 }
        })
      ]
    })

    const dispatchDueTask = vi.fn(async () => {})
    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => '2026-01-01T10:30:00.000Z',
      startupAt: '2026-01-01T10:30:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 1_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.runOnlyPendingTimersAsync()

    expect(dispatchDueTask).toHaveBeenCalledTimes(1)
    expect(dispatchDueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-after-startup',
        isDue: true
      })
    )

    runtime.stop()
  })

  it('skips missed heartbeat work on startup until the next future interval slot', async () => {
    vi.useFakeTimers()

    let currentNow = '2026-01-01T10:20:00.000Z'
    const heartbeatAgent: AgentEntity = {
      ...agent,
      configuration: {
        permission_mode: 'default',
        heartbeat_enabled: true,
        heartbeat_interval: 15
      }
    }
    const mainSession = {
      id: 'session-main',
      agentId: heartbeatAgent.id,
      name: 'Main',
      workspaceId: workspace.id,
      workspace,
      orderKey: 'session-main',
      createdAt,
      updatedAt: '2026-01-01T10:05:00.000Z'
    }
    const state = createAgentStoreState({
      agents: [heartbeatAgent],
      workspaces: [workspace],
      sessions: [mainSession]
    })

    const dispatchDueTask = vi.fn(async () => {})
    const runtime = new AgentTaskSchedulerRuntimeService({
      now: () => currentNow,
      startupAt: '2026-01-01T10:20:00.000Z',
      getAgentState: async () => state,
      dispatchDueTask,
      minimumDelayMs: 1_000,
      maximumDelayMs: 60_000
    })

    runtime.start()
    await vi.runOnlyPendingTimersAsync()

    expect(dispatchDueTask).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().tasksById['heartbeat:agent-1:workspace-1']).toMatchObject({
      nextRunAt: '2026-01-01T10:30:00.000Z',
      isDue: false
    })

    currentNow = '2026-01-01T10:30:00.000Z'
    await vi.advanceTimersByTimeAsync(60_000)

    expect(dispatchDueTask).toHaveBeenCalledTimes(1)
    expect(dispatchDueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'heartbeat:agent-1:workspace-1',
        executionKind: 'heartbeat'
      })
    )

    runtime.stop()
  })
})
