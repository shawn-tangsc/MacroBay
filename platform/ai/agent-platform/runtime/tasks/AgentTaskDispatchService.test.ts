import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { AgentChatRuntimeResult } from '../agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../../schemas/sessionSchemas'
import type { ScheduledTaskEntity } from '../../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../store/agentStore'
import { createAgentPersistentStore } from '../../store/agentPersistentStore'
import { updateScheduledAgentTask } from '../../store/agentRelationsStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from '../../services'
import { AgentTaskDispatchService } from './AgentTaskDispatchService'
import { countConsecutiveTerminalFailures } from './taskFailureCircuit'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'

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

const activeChannel: AgentChannelEntity = {
  id: 'channel-active',
  type: 'telegram',
  name: 'Telegram',
  agentId: agent.id,
  sessionId: null,
  workspace: { type: 'user', workspaceId: workspace.id },
  config: { bot_token: 'token' },
  isActive: true,
  activeChatIds: ['chat-1'],
  createdAt,
  updatedAt: createdAt
}

function createTask(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-1',
    agentId: agent.id,
    name: 'Scheduled Review',
    prompt: 'Run the scheduled review.',
    trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 2,
    workspace: { type: 'user', workspaceId: workspace.id },
    enabled: true,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

function runManualTask(dispatcher: AgentTaskDispatchService, task: ScheduledTaskEntity) {
  return dispatcher.runTask(task.agentId, task.id, task.revision ?? 1)
}

function createMemoryStateStore(initialState: AgentStoreState): AgentPlatformStateStore {
  let state = initialState
  return {
    getState: async () => state,
    update: async (updater) => {
      state = updater(state)
      return state
    },
    replace: async (nextState) => {
      state = nextState
      return state
    }
  }
}

function createRuntimeResult(
  sessionId: string,
  assistantText = 'Completed.',
  stats: AgentSessionMessageEntity['stats'] = null
): AgentChatRuntimeResult {
  const userMessage: AgentSessionMessageEntity = {
    id: 'message-user-1',
    sessionId,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'Run the scheduled review.' }] },
    searchableText: 'Run the scheduled review.',
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats,
    runtimeResumeToken: null,
    createdAt,
    updatedAt: createdAt
  }
  const assistantMessage: AgentSessionMessageEntity = {
    id: 'message-assistant-1',
    sessionId,
    role: 'assistant',
    data: { parts: [{ type: 'text', text: assistantText }] },
    searchableText: assistantText,
    status: 'success',
    modelId: agent.model,
    modelSnapshot: { id: 'model-a', name: 'Model A', provider: 'provider' },
    stats,
    runtimeResumeToken: 'resume-1',
    createdAt,
    updatedAt: createdAt
  }
  return {
    state: createAgentStoreState({
      agents: [agent],
      sessions: [],
      workspaces: [workspace],
      messagesBySessionId: { [sessionId]: [userMessage, assistantMessage] }
    }),
    userMessage,
    assistantMessage
  }
}

describe('AgentTaskDispatchService', () => {
  it('consumes a coordinator-owned queued run without creating a second run log', async () => {
    const task = createTask()
    const queuedRun = {
      id: 'queued-run-1',
      scheduleId: task.id,
      agentId: agent.id,
      taskNameSnapshot: task.name,
      startedAt: '2026-01-01T10:30:00.000Z',
      durationMs: 0,
      status: 'queued' as const
    }
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      tasks: [task],
      taskRunLogs: [queuedRun]
    })))
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage: async (request) => createRuntimeResult(request.sessionId) },
      now: () => '2026-01-01T10:30:00.000Z'
    })
    const runtimeTask = buildAgentTaskSchedulerSnapshot(await services.state.getState(), {
      now: '2026-01-01T10:30:00.000Z'
    }).tasksById[task.id]!

    await dispatcher.dispatchQueuedRun({ task: runtimeTask, runLog: queuedRun })

    const state = await services.state.getState()
    expect(state.taskRunLogs).toHaveLength(1)
    expect(state.taskRunLogs[0]).toMatchObject({ id: queuedRun.id, status: 'completed' })
  })

  it.each([1, 2, 3])('keeps a manual run completed when notification %s throws', async (throwAt) => {
    const task = createTask()
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] })))
    let calls = 0
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage }, onStateChanged: async () => { if (++calls === throwAt) throw new Error('notify-failed') } })
    await expect(dispatcher.runTask(agent.id, task.id, task.revision ?? 1)).resolves.toMatchObject({ taskId: task.id })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect((await services.state.getState()).taskRunLogs).toEqual([expect.objectContaining({ status: 'completed' })])
  })

  it('keeps a heartbeat run terminal when its notification throws', async () => {
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })))
    const heartbeat = { taskId: 'heartbeat:agent-1:workspace-1', sourceTaskId: null, sourceSessionId: null, agentId: agent.id, executionKind: 'heartbeat' as const, name: 'heartbeat', prompt: '__heartbeat__', workspace: { type: 'user' as const, workspaceId: workspace.id }, trigger: { kind: 'interval' as const, ms: 300_000 }, status: 'active' as const, timeoutMinutes: 2, enabled: true, isRunnable: true, isDue: true, exhausted: false, runtimeStatus: 'due' as const, runtimeBlockReason: null, nextRunAt: null, lastRunAt: null, lastRunLogId: null, failureStreak: 0, circuitBroken: false, subscribedChannelIds: [], activeChannelIds: [], inactiveChannelIds: [] }
    const dispatcher = new AgentTaskDispatchService({ services, runtime: { sendMessage: vi.fn() }, readHeartbeat: async () => null, onStateChanged: async () => { throw new Error('notify-failed') } })
    await dispatcher.dispatchRuntimeTask(heartbeat)
    expect((await services.state.getState()).taskRunLogs).toEqual([expect.objectContaining({ status: 'completed', resultPreview: 'Skipped (no file)' })])
  })
  it('creates a fresh session, sends the task prompt through the runtime, and finalizes the run log', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const onStateChanged = vi.fn()
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId)
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      onStateChanged
    })

    await runManualTask(dispatcher, createTask())

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(createdSession?.agentId).toBe(agent.id)
    expect(createdSession?.name).toBe('Scheduled Review')
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent.id,
        sessionId: createdSession?.id,
        text: 'Run the scheduled review.'
      })
    )
    expect(nextState.taskRunLogs).toHaveLength(1)
    expect(nextState.taskRunLogs[0]).toMatchObject({
      scheduleId: 'task-1',
      agentId: agent.id,
      taskNameSnapshot: 'Scheduled Review',
      sessionId: createdSession?.id,
      status: 'completed'
    })
    expect(onStateChanged).toHaveBeenCalled()
  })

  it('renders documented task prompt variables before sending a scheduled turn to the runtime', async () => {
    const task = createTask({
      name: 'Daily Review',
      prompt: 'Run {task_name} on {date} at {time} ({timezone}).',
      trigger: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }
    })
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    )
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await runManualTask(dispatcher, task)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Run Daily Review on 2026-01-01 at 18:30 (Asia/Shanghai).' })
    )
  })

  it('best-effort prewarms the fresh task session before sending the task prompt', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId)
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        prewarmSession,
        sendMessage
      },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await runManualTask(dispatcher, createTask())

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(prewarmSession).toHaveBeenCalledWith({
      agentId: agent.id,
      sessionId: createdSession?.id
    })
    expect(prewarmSession.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0] ?? Infinity
    )
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent.id,
        sessionId: createdSession?.id,
        text: 'Run the scheduled review.'
      })
    )
  })

  it('reports scheduled task lifecycle and assistant output through the job bridge', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active', 'channel-inactive'] })],
        channels: [activeChannel, { ...activeChannel, id: 'channel-inactive', isActive: false }],
        channelTaskSubscriptions: [
          { channelId: 'channel-active', taskId: 'task-1' },
          { channelId: 'channel-inactive', taskId: 'task-1' }
        ]
      })
    )
    const services = createAgentPlatformServices(store)
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({
        jobRunId: 'job-run-1',
        signal: new AbortController().signal
      })),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId, 'Bridge output')
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge
    })

    await runManualTask(dispatcher, createTask())

    const nextState = await services.state.getState()
    const runLog = nextState.taskRunLogs[0]
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(jobBridge.startTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        agentId: agent.id,
        runLogId: runLog?.id,
        timeoutMinutes: 2,
        payload: expect.objectContaining({
          agentId: agent.id,
          prompt: 'Run the scheduled review.',
          timeoutMinutes: 2,
          workspace: { type: 'user', workspaceId: workspace.id }
        })
      })
    )
    expect(jobBridge.completeTaskRun).toHaveBeenCalledWith({
      jobRunId: 'job-run-1',
      taskId: 'task-1',
      runLogId: runLog?.id,
      sessionId: createdSession?.id,
      output: 'Bridge output'
    })
    expect(jobBridge.failTaskRun).not.toHaveBeenCalled()
    expect(jobBridge.cancelTaskRun).not.toHaveBeenCalled()
  })

  it('cancels the runtime turn and run log when the job bridge abort signal fires', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({
        jobRunId: 'job-run-1',
        signal: controller.signal
      })),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const cancelMessage = vi.fn(() => true)
    const sendMessage = vi.fn(
      async () =>
        new Promise<AgentChatRuntimeResult>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Task run was aborted.'))
            },
            { once: true }
          )
          controller.abort({
            kind: 'cancelled',
            message: 'Cancelled by user.'
          })
        })
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage, cancelMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge
    })

    await expect(runManualTask(dispatcher, createTask())).rejects.toThrow('Task run was aborted.')

    const nextState = await services.state.getState()
    const runLog = nextState.taskRunLogs[0]
    expect(cancelMessage).toHaveBeenCalledWith(expect.any(String), {
      kind: 'runtime-stop',
      message: 'Cancelled by user.'
    })
    expect(runLog).toMatchObject({
      scheduleId: 'task-1',
      status: 'cancelled',
      error: 'Cancelled by user.'
    })
    expect(jobBridge.cancelTaskRun).toHaveBeenCalledWith({
      jobRunId: 'job-run-1',
      taskId: 'task-1',
      runLogId: runLog?.id,
      sessionId: nextState.sessions[0]?.id,
      reason: 'Cancelled by user.',
      reasonKind: 'cancelled'
    })
    expect(jobBridge.failTaskRun).not.toHaveBeenCalled()
    expect(jobBridge.completeTaskRun).not.toHaveBeenCalled()
  })

  it('keeps jobs authoritative for cancellation after the coordinator starts a queued run', async () => {
    const task = createTask()
    const queuedRun = {
      id: 'queued-job-run', scheduleId: task.id, agentId: agent.id, taskNameSnapshot: task.name,
      startedAt: '2026-01-01T10:30:00.000Z', durationMs: 0, status: 'queued' as const
    }
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({
      agents: [agent], workspaces: [workspace], tasks: [task], taskRunLogs: [queuedRun]
    })))
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({ jobRunId: 'job-queued-1', signal: controller.signal })),
      completeTaskRun: vi.fn(),
      failTaskRun: vi.fn(),
      cancelTaskRun: vi.fn()
    }
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        sendMessage: async () => {
          controller.abort({ kind: 'cancelled', message: 'Cancelled from the job.' })
          throw new Error('Task run was aborted.')
        },
        cancelMessage: vi.fn(() => true)
      },
      jobBridge,
      now: () => '2026-01-01T10:30:00.000Z'
    })
    const runtimeTask = buildAgentTaskSchedulerSnapshot(await services.state.getState(), {
      now: '2026-01-01T10:30:00.000Z'
    }).tasksById[task.id]!

    await expect(dispatcher.dispatchQueuedRun({ task: runtimeTask, runLog: queuedRun })).rejects.toThrow('Task run was aborted.')
    expect((await services.state.getState()).taskRunLogs).toEqual([
      expect.objectContaining({ id: queuedRun.id, status: 'cancelled', error: 'Cancelled from the job.' })
    ])
    expect(jobBridge.cancelTaskRun).toHaveBeenCalledWith(expect.objectContaining({ jobRunId: 'job-queued-1', runLogId: queuedRun.id }))
  })

  it('marks the run cancelled without sending a runtime message when the job aborts before send starts', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => {
        controller.abort({
          kind: 'cancelled',
          message: 'Job cancelled.'
        })
        return {
          jobRunId: 'job-run-1',
          signal: controller.signal
        }
      }),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId)
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { prewarmSession, sendMessage, cancelMessage: vi.fn(() => false) },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge
    })

    await expect(runManualTask(dispatcher, createTask())).rejects.toThrow('Job cancelled.')

    const nextState = await services.state.getState()
    expect(prewarmSession).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(nextState.taskRunLogs[0]).toMatchObject({
      scheduleId: 'task-1',
      status: 'cancelled',
      error: 'Job cancelled.'
    })
  })

  it('records timeout-aborted task runs as failed and delivers the timeout reason', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({
        jobRunId: 'job-run-1',
        signal: controller.signal
      })),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const deliverTaskResult = vi.fn(async () => undefined)
    const sendMessage = vi.fn(
      async () =>
        new Promise<AgentChatRuntimeResult>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Task run was aborted.'))
            },
            { once: true }
          )
          controller.abort({
            kind: 'timeout',
            message: 'Job timed out after 120000ms.'
          })
        })
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage, cancelMessage: vi.fn(() => true) },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge,
      deliverTaskResult
    })

    await expect(
      dispatcher.dispatchRuntimeTask({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        sourceSessionId: null,
        agentId: agent.id,
        executionKind: 'scheduled',
        name: 'Scheduled Review',
        prompt: 'Run the scheduled review.',
        workspace: { type: 'user', workspaceId: workspace.id },
        trigger: { kind: 'interval', ms: 60_000 },
        status: 'active',
        enabled: true,
        isRunnable: true,
        isDue: true,
        exhausted: false,
        runtimeStatus: 'due',
        nextRunAt: '2026-01-01T10:30:00.000Z',
        lastRunAt: null,
        lastRunLogId: null,
        subscribedChannelIds: ['channel-active'],
        activeChannelIds: ['channel-active'],
        inactiveChannelIds: [],
        timeoutMinutes: 2,
        failureStreak: 0,
        circuitBroken: false
      })
    ).rejects.toThrow('Task run was aborted.')

    const nextState = await services.state.getState()
    const runLog = nextState.taskRunLogs[0]
    expect(runLog).toMatchObject({
      scheduleId: 'task-1',
      status: 'failed',
      error: 'Job timed out after 120000ms.'
    })
    expect(jobBridge.failTaskRun).toHaveBeenCalledWith({
      jobRunId: 'job-run-1',
      taskId: 'task-1',
      runLogId: runLog?.id,
      sessionId: nextState.sessions[0]?.id,
      error: 'Job timed out after 120000ms.'
    })
    expect(jobBridge.cancelTaskRun).not.toHaveBeenCalled()
    expect(deliverTaskResult).toHaveBeenCalledWith({
      taskId: 'task-1',
      taskNameSnapshot: 'Scheduled Review',
      sourceTaskId: 'task-1',
      agentId: agent.id,
      sessionId: nextState.sessions[0]?.id,
      runLogId: runLog?.id,
      channelIds: ['channel-active'],
      status: 'failed',
      text: '',
      error: 'Job timed out after 120000ms.'
    })
  })

  it('records shutdown-aborted task runs as cancelled and preserves the shutdown reason kind', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask()]
      })
    )
    const services = createAgentPlatformServices(store)
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({
        jobRunId: 'job-run-1',
        signal: controller.signal
      })),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const deliverTaskResult = vi.fn(async () => undefined)
    const sendMessage = vi.fn(
      async () =>
        new Promise<AgentChatRuntimeResult>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Task run was aborted.'))
            },
            { once: true }
          )
          controller.abort({
            kind: 'shutdown',
            message: 'Stopped by runtime shutdown.'
          })
        })
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage, cancelMessage: vi.fn(() => true) },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge,
      deliverTaskResult
    })

    await expect(runManualTask(dispatcher, createTask())).rejects.toThrow('Task run was aborted.')

    const nextState = await services.state.getState()
    const runLog = nextState.taskRunLogs[0]
    expect(runLog).toMatchObject({
      scheduleId: 'task-1',
      status: 'cancelled',
      error: 'Stopped by runtime shutdown.'
    })
    expect(jobBridge.cancelTaskRun).toHaveBeenCalledWith({
      jobRunId: 'job-run-1',
      taskId: 'task-1',
      runLogId: runLog?.id,
      sessionId: nextState.sessions[0]?.id,
      reason: 'Stopped by runtime shutdown.',
      reasonKind: 'shutdown'
    })
    expect(jobBridge.failTaskRun).not.toHaveBeenCalled()
    expect(deliverTaskResult).not.toHaveBeenCalled()
  })

  it('records a failed run log when runtime dispatch throws', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask()]
      })
    )
    const services = createAgentPlatformServices(store)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('runtime failed')
        })
      },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(runManualTask(dispatcher, createTask())).rejects.toThrow('runtime failed')

    const nextState = await services.state.getState()
    expect(nextState.sessions).toHaveLength(1)
    expect(nextState.taskRunLogs).toHaveLength(1)
    expect(nextState.taskRunLogs[0]).toMatchObject({
      scheduleId: 'task-1',
      status: 'failed',
      error: 'runtime failed'
    })
  })

  it('stores bounded result metadata while preserving full assistant output for delivery', async () => {
    const assistantText = `Summary: ${'x'.repeat(240)}`
    const expectedPreview = `${assistantText.slice(0, 197)}...`
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const deliverTaskResult = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId, assistantText, { promptTokens: 12, completionTokens: 8, totalTokens: 20 })
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      deliverTaskResult
    })

    await dispatcher.dispatchRuntimeTask({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      sourceSessionId: null,
      agentId: agent.id,
      executionKind: 'scheduled',
      name: 'Scheduled Review',
      prompt: 'Run the scheduled review.',
      workspace: { type: 'user', workspaceId: workspace.id },
      trigger: { kind: 'interval', ms: 60_000 },
      status: 'active',
      enabled: true,
      isRunnable: true,
      isDue: true,
      exhausted: false,
      runtimeStatus: 'due',
      nextRunAt: '2026-01-01T10:30:00.000Z',
      lastRunAt: null,
      lastRunLogId: null,
      subscribedChannelIds: ['channel-active'],
      activeChannelIds: ['channel-active'],
      inactiveChannelIds: [],
      timeoutMinutes: 2,
      failureStreak: 0,
      circuitBroken: false
    })

    const nextState = await services.state.getState()
    expect(nextState.taskRunLogs[0]).toMatchObject({
      status: 'completed',
      resultPreview: expectedPreview,
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      resultCharCount: assistantText.length,
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }
    })
    expect(deliverTaskResult).toHaveBeenCalledWith(expect.objectContaining({ text: assistantText }))
  })

  it('delivers successful scheduled task results to active subscribed channels', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active', 'channel-inactive'] })],
        channels: [activeChannel, { ...activeChannel, id: 'channel-inactive', isActive: false }],
        channelTaskSubscriptions: [
          { channelId: 'channel-active', taskId: 'task-1' },
          { channelId: 'channel-inactive', taskId: 'task-1' }
        ]
      })
    )
    const services = createAgentPlatformServices(store)
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId)
    )
    const deliverTaskResult = vi.fn(async () => undefined)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      deliverTaskResult
    })

    await dispatcher.dispatchRuntimeTask({
      taskId: 'task-1',
      sourceTaskId: 'task-1',
      sourceSessionId: null,
      agentId: agent.id,
      executionKind: 'scheduled',
      name: 'Scheduled Review',
      prompt: 'Run the scheduled review.',
      workspace: { type: 'user', workspaceId: workspace.id },
      trigger: { kind: 'interval', ms: 60_000 },
      status: 'active',
      enabled: true,
      isRunnable: true,
      isDue: true,
      exhausted: false,
      runtimeStatus: 'due',
      nextRunAt: '2026-01-01T10:30:00.000Z',
      lastRunAt: null,
      lastRunLogId: null,
      subscribedChannelIds: ['channel-active', 'channel-inactive'],
      activeChannelIds: ['channel-active'],
      inactiveChannelIds: ['channel-inactive'],
      timeoutMinutes: 2,
      failureStreak: 0,
      circuitBroken: false
    })

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(deliverTaskResult).toHaveBeenCalledWith({
      taskId: 'task-1',
      taskNameSnapshot: 'Scheduled Review',
      sourceTaskId: 'task-1',
      agentId: agent.id,
      sessionId: createdSession?.id,
      runLogId: nextState.taskRunLogs[0]?.id,
      channelIds: ['channel-active'],
      status: 'completed',
      text: 'Completed.',
      error: null
    })
  })

  it('delivers failed scheduled task results to active subscribed channels before rethrowing', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const deliverTaskResult = vi.fn(async () => undefined)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('runtime failed')
        })
      },
      now: () => '2026-01-01T10:30:00.000Z',
      deliverTaskResult
    })

    await expect(
      dispatcher.dispatchRuntimeTask({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        sourceSessionId: null,
        agentId: agent.id,
        executionKind: 'scheduled',
        name: 'Scheduled Review',
        prompt: 'Run the scheduled review.',
        workspace: { type: 'user', workspaceId: workspace.id },
        trigger: { kind: 'interval', ms: 60_000 },
        status: 'active',
        enabled: true,
        isRunnable: true,
        isDue: true,
        exhausted: false,
        runtimeStatus: 'due',
        nextRunAt: '2026-01-01T10:30:00.000Z',
        lastRunAt: null,
        lastRunLogId: null,
        subscribedChannelIds: ['channel-active'],
        activeChannelIds: ['channel-active'],
        inactiveChannelIds: [],
        timeoutMinutes: 2,
        failureStreak: 0,
        circuitBroken: false
      })
    ).rejects.toThrow('runtime failed')

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(deliverTaskResult).toHaveBeenCalledWith({
      taskId: 'task-1',
      taskNameSnapshot: 'Scheduled Review',
      sourceTaskId: 'task-1',
      agentId: agent.id,
      sessionId: createdSession?.id,
      runLogId: nextState.taskRunLogs[0]?.id,
      channelIds: ['channel-active'],
      status: 'failed',
      text: '',
      error: 'runtime failed'
    })
  })

  it('delivers cancelled scheduled task results to active subscribed channels before rethrowing', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask({ channelIds: ['channel-active'] })],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: 'task-1' }]
      })
    )
    const services = createAgentPlatformServices(store)
    const controller = new AbortController()
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({
        jobRunId: 'job-run-1',
        signal: controller.signal
      })),
      completeTaskRun: vi.fn(async () => undefined),
      failTaskRun: vi.fn(async () => undefined),
      cancelTaskRun: vi.fn(async () => undefined)
    }
    const deliverTaskResult = vi.fn(async () => undefined)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        sendMessage: vi.fn(async () => {
          controller.abort({
            kind: 'cancelled',
            message: 'Cancelled by user.'
          })
          throw new Error('Task run was aborted.')
        }),
        cancelMessage: vi.fn(() => true)
      },
      now: () => '2026-01-01T10:30:00.000Z',
      jobBridge,
      deliverTaskResult
    })

    await expect(
      dispatcher.dispatchRuntimeTask({
        taskId: 'task-1',
        sourceTaskId: 'task-1',
        sourceSessionId: null,
        agentId: agent.id,
        executionKind: 'scheduled',
        name: 'Scheduled Review',
        prompt: 'Run the scheduled review.',
        workspace: { type: 'user', workspaceId: workspace.id },
        trigger: { kind: 'interval', ms: 60_000 },
        status: 'active',
        enabled: true,
        isRunnable: true,
        isDue: true,
        exhausted: false,
        runtimeStatus: 'due',
        nextRunAt: '2026-01-01T10:30:00.000Z',
        lastRunAt: null,
        lastRunLogId: null,
        subscribedChannelIds: ['channel-active'],
        activeChannelIds: ['channel-active'],
        inactiveChannelIds: [],
        timeoutMinutes: 2,
        failureStreak: 0,
        circuitBroken: false
      })
    ).rejects.toThrow('Task run was aborted.')

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(deliverTaskResult).toHaveBeenCalledWith({
      taskId: 'task-1',
      taskNameSnapshot: 'Scheduled Review',
      sourceTaskId: 'task-1',
      agentId: agent.id,
      sessionId: createdSession?.id,
      runLogId: nextState.taskRunLogs[0]?.id,
      channelIds: ['channel-active'],
      status: 'cancelled',
      text: '',
      error: 'Cancelled by user.'
    })
  })

  it('manually runs an existing task through the scheduler dispatch chain with active channel metadata', async () => {
    const task = createTask({
      nextRun: '2026-01-01T12:00:00.000Z',
      channelIds: ['channel-active']
    })
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [task],
        channels: [activeChannel],
        channelTaskSubscriptions: [{ channelId: 'channel-active', taskId: task.id }]
      })
    )
    const services = createAgentPlatformServices(store)
    const deliverTaskResult = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId, 'Manual output')
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      deliverTaskResult
    })

    await dispatcher.runTask(agent.id, task.id, task.revision ?? 1)

    const nextState = await services.state.getState()
    const createdSession = nextState.sessions[0] as AgentSessionEntity | undefined
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent.id,
        sessionId: createdSession?.id,
        text: task.prompt
      })
    )
    expect(nextState.taskRunLogs[0]).toMatchObject({
      scheduleId: task.id,
      sessionId: createdSession?.id,
      status: 'completed',
      resultPreview: 'Manual output'
    })
    expect(deliverTaskResult).toHaveBeenCalledWith({
      taskId: task.id,
      taskNameSnapshot: 'Scheduled Review',
      sourceTaskId: task.id,
      agentId: agent.id,
      sessionId: createdSession?.id,
      runLogId: nextState.taskRunLogs[0]?.id,
      channelIds: ['channel-active'],
      status: 'completed',
      text: 'Manual output',
      error: null
    })
  })

  it('rejects manual task runs while the latest persisted run log is still running', async () => {
    const task = createTask()
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [task],
        taskRunLogs: [
          {
            id: 'task-run-running',
            scheduleId: task.id,
            startedAt: '2026-01-01T10:20:00.000Z',
            durationMs: 0,
            status: 'running'
          }
        ]
      })
    )
    const services = createAgentPlatformServices(store)
    const sendMessage = vi.fn(async (request: { agentId: string; sessionId: string; text: string; runId?: string }) =>
      createRuntimeResult(request.sessionId)
    )
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(dispatcher.runTask(agent.id, task.id, task.revision ?? 1)).rejects.toThrow()

    const nextState = await services.state.getState()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(nextState.sessions).toHaveLength(0)
    expect(nextState.taskRunLogs).toHaveLength(1)
  })

  it('rechecks a fresh running log before manual dispatch and does not start a second job', async () => {
    const task = createTask()
    const initialState = createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] })
    const freshState = {
      ...initialState,
      taskRunLogs: [
        {
          id: 'task-run-racing',
          scheduleId: task.id,
          startedAt: '2026-01-01T10:30:00.000Z',
          durationMs: 0,
          status: 'running' as const
        }
      ]
    }
    let reads = 0
    const store: AgentPlatformStateStore = {
      getState: async () => (++reads === 1 ? initialState : freshState),
      update: async (updater) => updater(freshState),
      replace: async (state) => state
    }
    const services = createAgentPlatformServices(store)
    const jobBridge = {
      startTaskRun: vi.fn(),
      completeTaskRun: vi.fn(),
      failTaskRun: vi.fn(),
      cancelTaskRun: vi.fn()
    }
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage: vi.fn() },
      jobBridge,
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(dispatcher.runTask(agent.id, task.id, task.revision ?? 1)).rejects.toThrow()
    expect(jobBridge.startTaskRun).not.toHaveBeenCalled()
  })

  it('claims one task execution while concurrent manual run-now requests overlap', async () => {
    const task = createTask()
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    const services = createAgentPlatformServices(store)
    let releaseSend: (() => void) | undefined
    let markSendStarted: (() => void) | undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    const sendMessage = vi.fn(async (request: { sessionId: string }) => {
      if (sendMessage.mock.calls.length === 1) {
        markSendStarted?.()
        await new Promise<void>((resolve) => {
          releaseSend = resolve
        })
      }
      return createRuntimeResult(request.sessionId)
    })
    const jobBridge = {
      startTaskRun: vi.fn(async () => ({ jobRunId: 'job-run-1' })),
      completeTaskRun: vi.fn(),
      failTaskRun: vi.fn(),
      cancelTaskRun: vi.fn()
    }
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      jobBridge,
      now: () => '2026-01-01T10:30:00.000Z'
    })
    const outcomes = Promise.allSettled([dispatcher.runTask(agent.id, task.id, task.revision ?? 1), dispatcher.runTask(agent.id, task.id, task.revision ?? 1)])

    await sendStarted
    expect(releaseSend).toBeTypeOf('function')
    releaseSend?.()
    const results = await outcomes

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'task-not-runnable' })
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(jobBridge.startTaskRun).toHaveBeenCalledTimes(1)
    const nextState = await services.state.getState()
    expect(nextState.sessions).toHaveLength(1)
    expect(nextState.taskRunLogs).toHaveLength(1)
  })

  it('atomically admits one of two independent dispatchers sharing a fallback store', async () => {
    const task = createTask()
    const store = createAgentPersistentStore(undefined, {
      agents: [agent],
      workspaces: [workspace],
      tasks: [task]
    })
    const servicesOne = createAgentPlatformServices(store)
    const servicesTwo = createAgentPlatformServices(store)
    let releaseSend: (() => void) | undefined
    let markSendStarted: (() => void) | undefined
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    const runtimeSend = vi.fn(async (request: { sessionId: string }) => {
      markSendStarted?.()
      await new Promise<void>((resolve) => {
        releaseSend = resolve
      })
      return createRuntimeResult(request.sessionId)
    })
    const jobStart = vi.fn(async () => ({ jobRunId: 'job-fallback-1' }))
    const dispatcherOne = new AgentTaskDispatchService({
      services: servicesOne,
      runtime: { sendMessage: runtimeSend },
      jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() }
    })
    const dispatcherTwo = new AgentTaskDispatchService({
      services: servicesTwo,
      runtime: { sendMessage: runtimeSend },
      jobBridge: { startTaskRun: jobStart, completeTaskRun: vi.fn(), failTaskRun: vi.fn(), cancelTaskRun: vi.fn() }
    })

    const outcomes = Promise.allSettled([
      dispatcherOne.runTask(agent.id, task.id, task.revision ?? 1),
      dispatcherTwo.runTask(agent.id, task.id, task.revision ?? 1)
    ])
    await sendStarted
    releaseSend?.()
    const results = await outcomes

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'task-not-runnable' })
    })
    const finalState = await store.getState()
    expect(finalState.taskRunLogs).toHaveLength(1)
    expect(finalState.taskRunLogs.filter((run) => run.status === 'running')).toHaveLength(0)
    expect(finalState.sessions).toHaveLength(1)
    expect(runtimeSend).toHaveBeenCalledTimes(1)
    expect(jobStart).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['completed once', createTask({ trigger: { kind: 'once', at: Date.UTC(2026, 0, 1, 10, 5) }, enabled: false, status: 'completed' }), agent],
    ['user paused', createTask({ enabled: false, status: 'paused', pauseReason: 'user' }), agent],
    ['failure-circuit paused', createTask({ enabled: false, status: 'paused', pauseReason: 'failure-circuit' }), agent],
    ['autonomy disabled', createTask(), { ...agent, configuration: { permission_mode: 'default' as const } }]
  ])('rejects manual run-now for a %s task without creating task execution state', async (_label, task, taskAgent) => {
    const store = createMemoryStateStore(
      createAgentStoreState({ agents: [taskAgent], workspaces: [workspace], tasks: [task] })
    )
    const services = createAgentPlatformServices(store)
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const jobBridge = {
      startTaskRun: vi.fn(),
      completeTaskRun: vi.fn(),
      failTaskRun: vi.fn(),
      cancelTaskRun: vi.fn()
    }
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      jobBridge,
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(dispatcher.runTask(task.agentId, task.id, task.revision ?? 1)).rejects.toThrow()

    const nextState = await services.state.getState()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(jobBridge.startTaskRun).not.toHaveBeenCalled()
    expect(nextState.sessions).toHaveLength(0)
    expect(nextState.taskRunLogs).toHaveLength(0)
  })

  it('rejects malformed legacy schedules before a dispatcher creates execution state', async () => {
    const task = createTask({ trigger: { kind: 'once', at: Number.MAX_SAFE_INTEGER } })
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    const services = createAgentPlatformServices(store, {
      taskAutomation: { now: () => new Date('2026-07-16T10:00:00.000Z') }
    })
    const sendMessage = vi.fn()
    const sessionCreate = vi.spyOn(services.sessions, 'create')
    const jobStart = vi.fn()
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      jobBridge: {
        startTaskRun: jobStart,
        completeTaskRun: vi.fn(),
        failTaskRun: vi.fn(),
        cancelTaskRun: vi.fn()
      },
      now: () => '2026-07-16T10:00:00.000Z'
    })

    await expect(dispatcher.runTask(agent.id, task.id, task.revision ?? 1)).rejects.toMatchObject({
      code: 'task-not-runnable'
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(jobStart).not.toHaveBeenCalled()
    expect((await services.state.getState()).taskRunLogs).toHaveLength(0)
  })

  it('runs a valid future task manually even when it is not due', async () => {
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const task = createTask({ trigger: { kind: 'once', at: nowMs + 60 * 60 * 1000 } })
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    const services = createAgentPlatformServices(store, { taskAutomation: { now: () => new Date(nowMs) } })
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const sessionCreate = vi.spyOn(services.sessions, 'create')
    const jobStart = vi.fn(async () => ({ jobRunId: 'job-non-due' }))
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      jobBridge: {
        startTaskRun: jobStart,
        completeTaskRun: vi.fn(),
        failTaskRun: vi.fn(),
        cancelTaskRun: vi.fn()
      },
      now: () => nowIso
    })

    await expect(dispatcher.runTask(agent.id, task.id, task.revision ?? 1)).resolves.toMatchObject({ taskId: task.id })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sessionCreate).toHaveBeenCalledTimes(1)
    expect(jobStart).toHaveBeenCalledTimes(1)
    const runs = (await services.state.getState()).taskRunLogs
    expect(runs).toHaveLength(1)
    expect(runs).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(runs.filter((run) => run.status === 'running')).toHaveLength(0)
  })

  it('does not let required-revision manual admission bypass the fresh runnable gate', async () => {
    const task = createTask({ enabled: false, status: 'paused', pauseReason: 'user' })
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    const services = createAgentPlatformServices(store)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage: vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId)) },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(runManualTask(dispatcher, task)).rejects.toThrow()

    const nextState = await services.state.getState()
    expect(nextState.sessions).toHaveLength(0)
    expect(nextState.taskRunLogs).toHaveLength(0)
  })

  it('skips a due snapshot when autonomy is disabled before scheduled dispatch begins', async () => {
    const task = createTask()
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace], tasks: [task] }))
    const services = createAgentPlatformServices(store)
    const staleRuntimeTask = buildAgentTaskSchedulerSnapshot(await services.state.getState(), {
      now: '2026-01-01T10:30:00.000Z'
    }).tasksById[task.id]
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await services.state.update((state) => ({
      ...state,
      agents: state.agents.map((item) => (item.id === agent.id ? { ...item, configuration: { permission_mode: 'default' } } : item))
    }))
    await dispatcher.dispatchDueTask(staleRuntimeTask)

    const nextState = await services.state.getState()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(nextState.sessions).toHaveLength(0)
    expect(nextState.taskRunLogs).toHaveLength(0)
  })

  it('skips heartbeat dispatch without creating a session when the workspace has no heartbeat content', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace]
      })
    )
    const services = createAgentPlatformServices(store)
    const sendMessage = vi.fn()
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      readHeartbeat: vi.fn(async () => null)
    })

    await dispatcher.dispatchRuntimeTask({
      taskId: 'heartbeat:agent-1:workspace-1',
      sourceTaskId: null,
      sourceSessionId: 'session-main',
      agentId: agent.id,
      executionKind: 'heartbeat',
      name: 'heartbeat',
      prompt: '__heartbeat__',
      workspace: { type: 'user', workspaceId: workspace.id },
      trigger: { kind: 'interval', ms: 15 * 60 * 1000 },
      status: 'active',
      enabled: true,
      isRunnable: true,
      isDue: true,
      exhausted: false,
      runtimeStatus: 'due',
      nextRunAt: '2026-01-01T10:30:00.000Z',
      lastRunAt: null,
      lastRunLogId: null,
      subscribedChannelIds: [],
      activeChannelIds: [],
      inactiveChannelIds: [],
      timeoutMinutes: 2,
      failureStreak: 0,
      circuitBroken: false
    })

    const nextState = await services.state.getState()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(nextState.sessions).toHaveLength(0)
    expect(nextState.taskRunLogs).toHaveLength(1)
    expect(nextState.taskRunLogs.find((log) => log.scheduleId === 'heartbeat:agent-1:workspace-1')).toMatchObject({
      scheduleId: 'heartbeat:agent-1:workspace-1',
      status: 'completed',
      resultPreview: 'Skipped (no file)'
    })
  })

  it('skips concurrent heartbeat dispatch for the same task while its first run is active', async () => {
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace]
      })
    )
    const services = createAgentPlatformServices(store)
    let releaseHeartbeat: (() => void) | undefined
    let markHeartbeatRead: (() => void) | undefined
    const heartbeatRead = new Promise<void>((resolve) => {
      markHeartbeatRead = resolve
    })
    const sendMessage = vi.fn(async (request: { sessionId: string }) => createRuntimeResult(request.sessionId))
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: { sendMessage },
      now: () => '2026-01-01T10:30:00.000Z',
      readHeartbeat: vi.fn(async () => {
        markHeartbeatRead?.()
        await new Promise<void>((resolve) => {
          releaseHeartbeat = resolve
        })
        return 'Check status.'
      })
    })
    const heartbeatTask = {
      taskId: 'heartbeat:agent-1:workspace-1',
      sourceTaskId: null,
      sourceSessionId: 'session-main',
      agentId: agent.id,
      executionKind: 'heartbeat' as const,
      name: 'heartbeat',
      prompt: '__heartbeat__',
      workspace: { type: 'user' as const, workspaceId: workspace.id },
      trigger: { kind: 'interval' as const, ms: 15 * 60 * 1000 },
      status: 'active' as const,
      enabled: true,
      isRunnable: true,
      isDue: true,
      exhausted: false,
      runtimeStatus: 'due' as const,
      nextRunAt: '2026-01-01T10:30:00.000Z',
      lastRunAt: null,
      lastRunLogId: null,
      subscribedChannelIds: [],
      activeChannelIds: [],
      inactiveChannelIds: [],
      timeoutMinutes: 2,
      failureStreak: 0,
      circuitBroken: false
    }

    const first = dispatcher.dispatchRuntimeTask(heartbeatTask)
    await heartbeatRead
    await dispatcher.dispatchRuntimeTask(heartbeatTask)
    releaseHeartbeat?.()
    await first

    const nextState = await services.state.getState()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(nextState.sessions).toHaveLength(1)
    expect(nextState.taskRunLogs).toHaveLength(1)
  })

  it('pauses a task after the third failure and resets only its failure circuit when resumed', async () => {
    const firstFailure = '2026-01-01T10:10:00.000Z'
    const secondFailure = '2026-01-01T10:20:00.000Z'
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace],
        tasks: [createTask()],
        taskRunLogs: [
          {
            id: 'run-previous-2',
            scheduleId: 'task-1',
            sessionId: 'session-previous-2',
            startedAt: secondFailure,
            durationMs: 500,
            status: 'failed',
            error: 'second'
          },
          {
            id: 'run-previous-1',
            scheduleId: 'task-1',
            startedAt: firstFailure,
            durationMs: 500,
            status: 'failed',
            error: 'first'
          }
        ]
      })
    )
    const services = createAgentPlatformServices(store)
    const dispatcher = new AgentTaskDispatchService({
      services,
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('runtime failed')
        })
      },
      now: () => '2026-01-01T10:30:00.000Z'
    })

    await expect(runManualTask(dispatcher, createTask())).rejects.toThrow('runtime failed')

    const nextState = await services.state.getState()
    expect(
      nextState.taskRunLogs.map((log) => ({ id: log.id, startedAt: log.startedAt, status: log.status }))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'failed', startedAt: '2026-01-01T10:30:00.000Z' }),
        expect.objectContaining({ status: 'failed', startedAt: secondFailure }),
        expect.objectContaining({ status: 'failed', startedAt: firstFailure })
      ])
    )
    expect(countConsecutiveTerminalFailures(nextState.taskRunLogs)).toBe(3)
    expect(nextState.taskRunLogs.find((log) => log.id === 'run-previous-2')).toMatchObject({
      sessionId: 'session-previous-2',
      startedAt: secondFailure,
      status: 'failed',
      error: 'second'
    })
    expect(nextState.tasks[0]).toMatchObject({
      id: 'task-1',
      enabled: false,
      status: 'paused',
      pauseReason: 'failure-circuit',
      revision: 2
    })
    expect(nextState.taskRunLogs.find((log) => log.error === 'runtime failed')).toMatchObject({
      scheduleId: 'task-1',
      status: 'failed',
      error: 'runtime failed'
    })

    const resumedState = updateScheduledAgentTask(nextState, 'task-1', { enabled: true })
    const resumedTask = resumedState.tasks[0]
    const snapshot = buildAgentTaskSchedulerSnapshot(resumedState, {
      now: new Date(Date.parse(resumedTask.failureResetAt ?? '') + 60_000).toISOString()
    })

    expect(resumedTask).toMatchObject({
      enabled: true,
      status: 'active',
      pauseReason: null,
      revision: 3
    })
    expect(resumedTask.failureResetAt).toEqual(expect.any(String))
    expect(snapshot.tasksById['task-1']).toMatchObject({
      failureStreak: 0,
      circuitBroken: false,
      isRunnable: true,
      isDue: true
    })
  })

})
