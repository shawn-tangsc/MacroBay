import { describe, expect, it, vi } from 'vitest'

import type { AgentPlatformServices } from '../../services'
import type { AgentEntity } from '../../schemas/agentSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../store/agentStore'
import { AgentTaskExecutionCoordinator } from './AgentTaskExecutionCoordinator'
import type { AgentTaskSchedulerRuntimeTask } from '../runtimeTypes'

const now = '2026-07-16T12:00:00.000Z'

const agent = (id: string): AgentEntity => ({
  id,
  type: 'claude-code',
  name: id,
  model: 'provider:model',
  modelName: 'Model',
  configuration: { permission_mode: 'bypassPermissions' },
  orderKey: id,
  createdAt: now,
  updatedAt: now
})

const session = (agentId: string): AgentSessionEntity => ({
  id: `session-${agentId}`,
  agentId,
  name: 'Session',
  workspaceId: 'workspace-1',
  workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'system', orderKey: 'workspace-1', createdAt: now, updatedAt: now },
  orderKey: `session-${agentId}`,
  createdAt: now,
  updatedAt: now
})

const task = (id: string, agentId = 'agent-1'): ScheduledTaskEntity => ({
  id,
  agentId,
  name: id,
  prompt: 'Run safely',
  trigger: { kind: 'interval', ms: 300_000 },
  timeoutMinutes: 30,
  workspace: { type: 'system' },
  enabled: true,
  status: 'active',
  revision: 1,
  createdAt: '2026-07-16T11:00:00.000Z',
  updatedAt: now
})

function createServices(initial: AgentStoreState): AgentPlatformServices {
  let state = initial
  const stateStore = {
    getState: async () => state,
    update: async (updater: (current: AgentStoreState) => AgentStoreState) => (state = updater(state)),
    replace: async (next: AgentStoreState) => (state = next)
  }
  const tasks = {
    addRunLog: async (log: TaskRunLogEntity) => {
      state = { ...state, taskRunLogs: [log, ...state.taskRunLogs] }
      return log
    },
    patchRunLog: async (runLogId: string, patch: Partial<TaskRunLogEntity>) => {
      const log = state.taskRunLogs.find((item) => item.id === runLogId)
      if (!log) return null
      const updated = { ...log, ...patch }
      state = { ...state, taskRunLogs: state.taskRunLogs.map((item) => item.id === runLogId ? updated : item) }
      return updated
    }
  }
  return { state: stateStore, tasks } as unknown as AgentPlatformServices
}

describe('AgentTaskExecutionCoordinator', () => {
  it('persists one queued due run before dispatch and prevents duplicate admission', async () => {
    const services = createServices(createAgentStoreState({ agents: [agent('agent-1')], sessions: [session('agent-1')], tasks: [task('task-1')] }))
    const dispatchQueuedRun = vi.fn(async () => undefined)
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await Promise.all([coordinator.enqueueDueTask('task-1'), coordinator.enqueueDueTask('task-1')])
    const state = await services.state.getState()

    expect(state.taskRunLogs).toEqual([expect.objectContaining({ scheduleId: 'task-1', status: 'running' })])
    expect(dispatchQueuedRun).toHaveBeenCalledOnce()
  })

  it('prevents duplicate due admission across independent coordinators sharing one store', async () => {
    const services = createServices(createAgentStoreState({ agents: [agent('agent-1')], sessions: [session('agent-1')], tasks: [task('task-1')] }))
    const dispatchQueuedRun = vi.fn(async () => undefined)
    const first = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })
    const second = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await Promise.all([first.enqueueDueTask('task-1'), second.enqueueDueTask('task-1')])

    expect((await services.state.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ scheduleId: 'task-1', status: 'running' })
    ])
    expect(dispatchQueuedRun).toHaveBeenCalledOnce()
  })

  it('claims a pre-existing queued run only once across independent coordinator drains', async () => {
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1')],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: [{
        id: 'queued-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'task-1',
        startedAt: now, durationMs: 0, status: 'queued'
      }]
    }))
    const firstDispatch = vi.fn(async () => undefined)
    const secondDispatch = vi.fn(async () => undefined)
    const first = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun: firstDispatch })
    const second = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun: secondDispatch })

    await Promise.all([first.drain(), second.drain()])

    expect(firstDispatch.mock.calls.length + secondDispatch.mock.calls.length).toBe(1)
    expect((await services.state.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: 'queued-run', status: 'running' })
    ])
  })

  it('releases a failed dispatch claim and continues draining later queued work', async () => {
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1'), agent('agent-2')],
      sessions: [session('agent-1'), session('agent-2')],
      tasks: [task('first', 'agent-1'), task('second', 'agent-2')],
      taskRunLogs: [
        { id: 'first-run', scheduleId: 'first', agentId: 'agent-1', taskNameSnapshot: 'first', startedAt: now, durationMs: 0, status: 'queued' },
        { id: 'second-run', scheduleId: 'second', agentId: 'agent-2', taskNameSnapshot: 'second', startedAt: now, durationMs: 0, status: 'queued' }
      ]
    }))
    const dispatchQueuedRun = vi.fn(async ({ runLog }: { task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity }) => {
      if (runLog.id === 'first-run') throw new Error('terminal failure already persisted')
    })
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await coordinator.drain()
    await Promise.resolve()
    await coordinator.drain()

    expect(dispatchQueuedRun).toHaveBeenCalledWith(expect.objectContaining({ runLog: expect.objectContaining({ id: 'first-run' }) }))
    expect(dispatchQueuedRun).toHaveBeenCalledWith(expect.objectContaining({ runLog: expect.objectContaining({ id: 'second-run' }) }))
  })

  it('bounds starts to three global runs and one running run per Agent', async () => {
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1'), agent('agent-2'), agent('agent-3'), agent('agent-4')],
      sessions: [session('agent-1'), session('agent-2'), session('agent-3'), session('agent-4')],
      tasks: [task('one', 'agent-1'), task('two', 'agent-1'), task('three', 'agent-2'), task('four', 'agent-3'), task('five', 'agent-4')]
    }))
    const resolveDispatches: Array<() => void> = []
    const dispatchQueuedRun = vi.fn((_input: { task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity }) =>
      new Promise<void>((resolve) => resolveDispatches.push(resolve))
    )
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await Promise.all(['one', 'two', 'three', 'four', 'five'].map((taskId) => coordinator.enqueueDueTask(taskId)))

    expect(dispatchQueuedRun).toHaveBeenCalledTimes(3)
    expect(dispatchQueuedRun.mock.calls.map(([input]) => input.task.agentId)).toEqual(expect.arrayContaining(['agent-1', 'agent-2', 'agent-3']))
    expect(dispatchQueuedRun.mock.calls.map(([input]) => input.task.agentId)).not.toEqual(expect.arrayContaining(['agent-4']))
    for (const resolve of resolveDispatches) resolve()
    await coordinator.drain()
  })

  it('marks stale queued and running runs cancelled during startup recovery', async () => {
    const staleRuns: TaskRunLogEntity[] = [
      { id: 'queued-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'Task', startedAt: now, durationMs: 0, status: 'queued' },
      { id: 'running-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'Task', startedAt: now, durationMs: 0, status: 'running' }
    ]
    const services = createServices(createAgentStoreState({ agents: [agent('agent-1')], sessions: [session('agent-1')], tasks: [task('task-1')], taskRunLogs: staleRuns }))
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun: vi.fn() })

    await coordinator.recoverAfterRestart()
    const recovered = await services.state.getState()

    expect(recovered.taskRunLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'queued-run', status: 'cancelled', terminalReason: 'runtime-restarted' }),
      expect.objectContaining({ id: 'running-run', status: 'cancelled', terminalReason: 'runtime-restarted' })
    ]))
  })

  it('blocks a due admission after sixty starts for the same Agent in one hour', async () => {
    const recentRuns: TaskRunLogEntity[] = Array.from({ length: 60 }, (_, index) => ({
      id: `run-${index}`,
      scheduleId: `old-task-${index}`,
      agentId: 'agent-1',
      taskNameSnapshot: 'Old task',
      startedAt: now,
      durationMs: 1,
      status: 'completed'
    }))
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1')],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: recentRuns
    }))
    const dispatchQueuedRun = vi.fn()
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await expect(coordinator.enqueueDueTask('task-1')).resolves.toBeNull()
    expect(dispatchQueuedRun).not.toHaveBeenCalled()
    expect((await services.state.getState()).taskRunLogs).toHaveLength(60)
  })

  it('does not count policy-blocked queued cancellations toward the hourly start budget', async () => {
    const policyBlockedRuns: TaskRunLogEntity[] = Array.from({ length: 60 }, (_, index) => ({
      id: `policy-blocked-${index}`,
      scheduleId: `blocked-task-${index}`,
      agentId: 'agent-1',
      taskNameSnapshot: 'Blocked task',
      startedAt: now,
      durationMs: 0,
      status: 'cancelled',
      terminalReason: 'policy-blocked'
    }))
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1')],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: policyBlockedRuns
    }))
    const dispatchQueuedRun = vi.fn(async () => undefined)
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await expect(coordinator.enqueueDueTask('task-1')).resolves.toEqual(expect.objectContaining({ status: 'queued' }))
    expect(dispatchQueuedRun).toHaveBeenCalledOnce()
  })

  it('counts actual current-hour starts instead of old queued admission times', async () => {
    const currentStarts: TaskRunLogEntity[] = Array.from({ length: 60 }, (_, index) => ({
      id: `started-${index}`,
      scheduleId: `started-task-${index}`,
      agentId: 'agent-1',
      taskNameSnapshot: 'Started task',
      startedAt: now,
      durationMs: 1,
      status: 'completed'
    }))
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1')],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: [
        ...currentStarts,
        {
          id: 'old-queued-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'task-1',
          startedAt: '2026-07-16T10:00:00.000Z', durationMs: 0, status: 'queued'
        }
      ]
    }))
    const dispatchQueuedRun = vi.fn()
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await coordinator.drain()

    expect(dispatchQueuedRun).not.toHaveBeenCalled()
    expect((await services.state.getState()).taskRunLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-queued-run', status: 'cancelled', terminalReason: 'policy-blocked' })
    ]))
  })

  it('cancels a queued run as policy-blocked when autonomy changes before dispatch', async () => {
    const services = createServices(createAgentStoreState({
      agents: [agent('agent-1')],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: [{
        id: 'queued-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'task-1',
        startedAt: now, durationMs: 0, status: 'queued'
      }]
    }))
    await services.state.update((state) => ({
      ...state,
      agents: state.agents.map((item) => item.id === 'agent-1'
        ? { ...item, configuration: { permission_mode: 'default' } }
        : item)
    }))
    const dispatchQueuedRun = vi.fn()
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await coordinator.drain()

    expect(dispatchQueuedRun).not.toHaveBeenCalled()
    expect((await services.state.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: 'queued-run', status: 'cancelled', terminalReason: 'policy-blocked' })
    ])
  })

  it('claims a queued run when an outdated blocked snapshot is resumed before the fresh claim', async () => {
    const pausedState = createAgentStoreState({
      agents: [{ ...agent('agent-1'), configuration: { permission_mode: 'default' } }],
      sessions: [session('agent-1')],
      tasks: [task('task-1')],
      taskRunLogs: [{
        id: 'queued-run', scheduleId: 'task-1', agentId: 'agent-1', taskNameSnapshot: 'task-1',
        startedAt: now, durationMs: 0, status: 'queued'
      }]
    })
    const services = createServices(pausedState)
    const getState = services.state.getState
    let returnedPausedSnapshot = false
    services.state.getState = async () => {
      if (!returnedPausedSnapshot) {
        returnedPausedSnapshot = true
        const snapshot = await getState()
        await services.state.update((state) => ({ ...state, agents: [agent('agent-1')] }))
        return snapshot
      }
      return getState()
    }
    const dispatchQueuedRun = vi.fn(async () => undefined)
    const coordinator = new AgentTaskExecutionCoordinator({ services, now: () => now, dispatchQueuedRun })

    await coordinator.drain()

    expect(dispatchQueuedRun).toHaveBeenCalledOnce()
    expect((await services.state.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: 'queued-run', status: 'running' })
    ])
  })
})
