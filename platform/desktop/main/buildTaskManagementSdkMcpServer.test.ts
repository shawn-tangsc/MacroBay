import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import { TaskManagementToolRuntimeService } from '../../ai/agent-platform/runtime/tasks/TaskManagementToolRuntimeService'
import { TaskAutomationCommandService } from '../../ai/agent-platform/runtime/tasks/TaskAutomationCommandService'
import type { AgentEntity } from '../../ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../ai/agent-platform/schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../../ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { AgentPlatformStateStore } from '../../ai/agent-platform/services'
import { buildTaskManagementSdkMcpServer } from './buildTaskManagementSdkMcpServer'

const createdAt = '2026-01-01T00:00:00.000Z'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Autonomous Agent',
  model: 'provider:model',
  modelName: 'Model',
  configuration: { permission_mode: 'bypassPermissions' },
  orderKey: 'agent-1',
  createdAt,
  updatedAt: createdAt
}

const otherAgent: AgentEntity = {
  ...agent,
  id: 'agent-2',
  name: 'Other autonomous Agent',
  orderKey: 'agent-2'
}

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'system',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: agent.id,
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt,
  updatedAt: createdAt
}

function task(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-1',
    agentId: agent.id,
    name: 'Task',
    prompt: 'Private prompt',
    trigger: { kind: 'interval', ms: 300_000 },
    timeoutMinutes: 30,
    workspace: { type: 'system' },
    enabled: true,
    status: 'active',
    revision: 2,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

function run(overrides: Partial<TaskRunLogEntity> = {}): TaskRunLogEntity {
  return {
    id: 'run-1',
    scheduleId: 'task-1',
    agentId: agent.id,
    startedAt: createdAt,
    durationMs: 0,
    status: 'running',
    ...overrides
  }
}

function createStore(initial: AgentStoreState): AgentPlatformStateStore {
  let state = initial
  return {
    getState: async () => state,
    update: async (updater) => (state = updater(state)),
    replace: async (next) => (state = next)
  }
}

function createFixture(state: AgentStoreState) {
  const store = createStore(state)
  const commands = new TaskAutomationCommandService({
    store,
    now: () => new Date('2026-01-02T00:00:00.000Z'),
    defaultTimezone: 'UTC',
    getPolicyPreset: async () => 'balanced'
  })
  const runtime = new TaskManagementToolRuntimeService({ store, commands })
  const composition: AgentRuntimeComposition = {
    agentId: agent.id,
    sessionId: session.id,
    agentType: 'claude-code',
    instructions: null,
    modelId: agent.model,
    modelName: agent.modelName,
    permissionMode: 'bypassPermissions',
    workspacePath: '/tmp/workspace',
    workspaceType: 'system',
    environment: {},
    tools: { all: [], enabled: [], disabled: [] },
    mcp: { sources: [], servers: [] },
    skills: { agentId: agent.id, skills: [], toolIds: [] },
    taskManagement: runtime.getAgentRuntime(state, agent.id)
  }
  const sdk = {
    tool: vi.fn((name, description, schema, handler) => ({ name, description, schema, handler })),
    createSdkMcpServer: vi.fn((input) => input)
  }

  return { commands, composition, runtime, sdk, store }
}

function handlerFor(
  sdk: ReturnType<typeof createFixture>['sdk'],
  toolName: string
): (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const call = sdk.tool.mock.calls.find(([name]) => name === toolName)
  if (!call) throw new Error(`Missing tool ${toolName}`)
  return call[3] as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
}

describe('buildTaskManagementSdkMcpServer', () => {
  it('forwards autonomous task descriptors, records actor provenance, and excludes run-now', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    }))
    const emitChunk = vi.fn()
    const execute = vi.spyOn(commands, 'execute')

    const server = await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun: vi.fn() }),
      emitChunk,
      loadSdkHelpers: async () => sdk
    })

    expect(server?.name).toBe('agent-task-management')
    const names = sdk.tool.mock.calls.map(([name]) => name)
    expect(names).toEqual(expect.arrayContaining(composition.taskManagement!.toolNames))
    expect(names).toContain('scheduled_task_cancel_run')
    expect(names).not.toContain('scheduled_task_run_now')
    const createDescriptor = composition.taskManagement!.tools.find((tool) => tool.name === 'scheduled_task_create')!
    expect(sdk.tool.mock.calls.find(([name]) => name === 'scheduled_task_create')?.[2]).toEqual(createDescriptor.inputSchema)

    const result = await handlerFor(sdk, 'scheduled_task_create')({
      name: 'Created from SDK',
      prompt: 'Run safely',
      trigger: { kind: 'interval', ms: 300_000 },
      workspace: { type: 'system' }
    })

    expect(result.isError).toBeUndefined()
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'create',
      actor: expect.objectContaining({ kind: 'agent', agentId: agent.id, sessionId: session.id })
    }))
    const actor = execute.mock.calls[0]?.[0].actor
    expect(actor).toMatchObject({ kind: 'agent', toolCallId: expect.stringMatching(/^task-tool-call-/) })
    expect(emitChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-input-start', toolName: 'scheduled_task_create' }))
    expect(emitChunk).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-output-available' }))
  })

  it('forwards run-now to the Task 8 queued coordinator adapter', async () => {
    const store = createStore(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()]
    }))
    const commands = new TaskAutomationCommandService({
      store,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      defaultTimezone: 'UTC',
      getPolicyPreset: async () => 'balanced'
    })
    const enqueueRun = vi.fn(async () => ({ taskId: 'task-1', runLogId: 'queued-run-1' }))
    const runtime = new TaskManagementToolRuntimeService({
      store,
      commands,
      runTask: enqueueRun
    })
    const composition: AgentRuntimeComposition = {
      agentId: agent.id,
      sessionId: session.id,
      agentType: 'claude-code',
      instructions: null,
      modelId: agent.model,
      modelName: agent.modelName,
      permissionMode: 'bypassPermissions',
      workspacePath: '/tmp/workspace',
      workspaceType: 'system',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: agent.id, skills: [], toolIds: [] },
      taskManagement: runtime.getAgentRuntime(await store.getState(), agent.id)
    }
    const sdk = {
      tool: vi.fn((name, description, schema, handler) => ({ name, description, schema, handler })),
      createSdkMcpServer: vi.fn((input) => input)
    }

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => null,
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    await expect(handlerFor(sdk, 'scheduled_task_run_now')({
      taskId: 'task-1',
      expectedRevision: 2
    })).resolves.toEqual({
      content: [{ type: 'text', text: JSON.stringify({ taskId: 'task-1', runLogId: 'queued-run-1', status: 'queued' }) }]
    })
    expect(enqueueRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: agent.id,
      taskId: 'task-1',
      expectedRevision: 2,
      actor: expect.objectContaining({ kind: 'agent', agentId: agent.id, sessionId: session.id })
    }))
  })

  it('cancels only a current caller-owned run after task revision validation', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const cancelTaskRun = vi.fn(async () => ({ runLogId: 'run-1', jobRunId: 'job-1', cancelled: true }))

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    await expect(handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })).resolves.toEqual({
      content: [{ type: 'text', text: JSON.stringify({ taskId: 'task-1', runLogId: 'run-1', cancelled: true }) }]
    })
    expect(cancelTaskRun).toHaveBeenCalledWith({
      runLogId: 'run-1',
      actor: expect.objectContaining({
        kind: 'agent',
        agentId: agent.id,
        sessionId: session.id,
        toolCallId: expect.stringMatching(/^task-tool-call-/)
      })
    })
  })

  it.each([
    ['returns false', async () => ({ cancelled: false }), 'task-not-runnable'],
    ['throws a host error', async () => { throw new Error('disk-full /private/path secret') }, 'task-internal-error']
  ])('records rejected cancellation when the host controller %s', async (_case, cancel, errorCode) => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const prepareCancelRun = vi.spyOn(commands, 'prepareCancelRun')
    const recordCancelRunOutcome = vi.spyOn(commands, 'recordCancelRunOutcome')
    const cancelTaskRun = vi.fn(cancel)

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    const result = await handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })
    expect(result).toEqual({ content: [{ type: 'text', text: errorCode }], isError: true })
    expect(prepareCancelRun).toHaveBeenCalledOnce()
    expect(cancelTaskRun).toHaveBeenCalledOnce()
    expect(recordCancelRunOutcome).toHaveBeenCalledWith(expect.any(Object), {
      outcome: 'rejected',
      errorCode
    })
    expect(JSON.stringify(result)).not.toContain('disk-full')
    expect(JSON.stringify(result)).not.toContain('/private/path')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it.each([
    ['accepts cancellation', async () => ({ cancelled: true }), { outcome: 'accepted' }],
    ['refuses cancellation', async () => ({ cancelled: false }), { outcome: 'rejected', errorCode: 'task-not-runnable' }],
    ['throws during cancellation', async () => { throw new Error('host secret /private/path') }, { outcome: 'rejected', errorCode: 'task-internal-error' }]
  ])('does not reverse or duplicate the host outcome when audit persistence fails after it %s', async (_case, cancel, outcome) => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const cancelTaskRun = vi.fn(cancel)
    const recordCancelRunOutcome = vi
      .spyOn(commands, 'recordCancelRunOutcome')
      .mockRejectedValueOnce(new Error('disk-full /private/audit.sqlite secret'))

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    const result = await handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })
    expect(result).toEqual({ content: [{ type: 'text', text: 'task-internal-error' }], isError: true })
    expect(cancelTaskRun).toHaveBeenCalledOnce()
    expect(recordCancelRunOutcome).toHaveBeenCalledTimes(1)
    expect(recordCancelRunOutcome).toHaveBeenCalledWith(expect.any(Object), outcome)
    expect(JSON.stringify(result)).not.toContain('disk-full')
    expect(JSON.stringify(result)).not.toContain('/private/audit.sqlite')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('does not project cancellation until the real host controller is available', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    }))

    const server = await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => null,
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    expect(server?.toolNames).toEqual(composition.taskManagement?.toolNames)
    expect(server?.toolNames).not.toContain('scheduled_task_cancel_run')
    expect(server?.toolNames).not.toContain('scheduled_task_run_now')
  })

  it('denies foreign runs without touching the host controller', async () => {
    const foreignSession: AgentSessionEntity = { ...session, id: 'session-2', agentId: otherAgent.id }
    const foreignTask = task({ id: 'task-2', agentId: otherAgent.id })
    const foreignRun = run({ id: 'run-2', scheduleId: foreignTask.id, agentId: otherAgent.id })
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent, otherAgent],
      sessions: [session, foreignSession],
      workspaces: [workspace],
      tasks: [foreignTask],
      taskRunLogs: [foreignRun]
    }))
    const cancelTaskRun = vi.fn(async () => ({ cancelled: true }))
    const recordCancelRunOutcome = vi.spyOn(commands, 'recordCancelRunOutcome')

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })

    await expect(handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: foreignTask.id,
      runLogId: foreignRun.id,
      expectedRevision: 2
    })).resolves.toMatchObject({ isError: true, content: [{ text: 'task-ownership-denied' }] })
    expect(cancelTaskRun).not.toHaveBeenCalled()

    expect(recordCancelRunOutcome).not.toHaveBeenCalled()
  })

  it('aborts cancellation before the host controller or audit outcome', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const cancelTaskRun = vi.fn(async () => ({ cancelled: true }))
    const recordCancelRunOutcome = vi.spyOn(commands, 'recordCancelRunOutcome')
    const controller = new AbortController()
    controller.abort()

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      signal: controller.signal,
      loadSdkHelpers: async () => sdk
    })

    await expect(handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })).resolves.toEqual({ content: [{ type: 'text', text: 'Aborted' }], isError: true })
    expect(cancelTaskRun).not.toHaveBeenCalled()
    expect(recordCancelRunOutcome).not.toHaveBeenCalled()
  })

  it('aborts after preflight without sending a host cancellation or audit outcome', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const abortController = new AbortController()
    const prepareCancelRunOriginal = commands.prepareCancelRun.bind(commands)
    vi.spyOn(commands, 'prepareCancelRun').mockImplementation(async (command) => {
      const prepared = await prepareCancelRunOriginal(command)
      abortController.abort()
      return prepared
    })
    const cancelTaskRun = vi.fn(async () => ({ cancelled: true }))
    const recordCancelRunOutcome = vi.spyOn(commands, 'recordCancelRunOutcome')

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => ({ cancelTaskRun }),
      emitChunk: vi.fn(),
      signal: abortController.signal,
      loadSdkHelpers: async () => sdk
    })

    await expect(handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })).resolves.toEqual({ content: [{ type: 'text', text: 'Aborted' }], isError: true })
    expect(cancelTaskRun).not.toHaveBeenCalled()
    expect(recordCancelRunOutcome).not.toHaveBeenCalled()
  })

  it('records a single rejected outcome when the host controller disappears after server construction', async () => {
    const { commands, composition, runtime, sdk, store } = createFixture(createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      taskRunLogs: [run()]
    }))
    const cancelTaskRun = vi.fn()
    const recordCancelRunOutcome = vi.spyOn(commands, 'recordCancelRunOutcome')
    let controllerAvailable = true

    await buildTaskManagementSdkMcpServer({
      composition,
      agentId: agent.id,
      sessionId: session.id,
      getAgentState: store.getState,
      runtime,
      commands,
      getTaskRunController: () => controllerAvailable ? { cancelTaskRun } : null,
      emitChunk: vi.fn(),
      loadSdkHelpers: async () => sdk
    })
    controllerAvailable = false

    const result = await handlerFor(sdk, 'scheduled_task_cancel_run')({
      taskId: 'task-1',
      runLogId: 'run-1',
      expectedRevision: 2
    })

    expect(result).toEqual({ content: [{ type: 'text', text: 'task-internal-error' }], isError: true })
    expect(cancelTaskRun).not.toHaveBeenCalled()
    expect(recordCancelRunOutcome).toHaveBeenCalledTimes(1)
    expect(recordCancelRunOutcome).toHaveBeenCalledWith(expect.any(Object), {
      outcome: 'rejected',
      errorCode: 'task-internal-error'
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
