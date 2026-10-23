import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import type { ScheduledTaskEntity } from '../../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../store/agentStore'
import type { AgentPlatformStateStore } from '../../services'
import { TaskAutomationCommandService } from './TaskAutomationCommandService'
import {
  TaskManagementToolRuntimeService,
  type TaskManagementToolName
} from './TaskManagementToolRuntimeService'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const autonomousAgent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Autonomous agent',
  model: 'provider:model',
  modelName: 'Model',
  configuration: { permission_mode: 'bypassPermissions' },
  orderKey: 'agent-1',
  createdAt,
  updatedAt: createdAt
}

const normalAgent: AgentEntity = {
  ...autonomousAgent,
  id: 'agent-2',
  name: 'Normal agent',
  configuration: { permission_mode: 'default' },
  orderKey: 'agent-2'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: autonomousAgent.id,
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
    agentId: autonomousAgent.id,
    name: 'Owned task',
    prompt: 'Private task prompt',
    trigger: { kind: 'interval', ms: 300_000 },
    timeoutMinutes: 30,
    workspace: { type: 'system' },
    channelIds: ['channel-1'],
    enabled: true,
    status: 'active',
    revision: 4,
    pauseReason: null,
    failureResetAt: null,
    provenance: { createdBy: 'user' },
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

function channel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-1',
    type: 'telegram',
    name: 'Owned channel',
    agentId: autonomousAgent.id,
    workspace: { type: 'system' },
    config: { bot_token: 'secret' },
    isActive: true,
    activeChatIds: ['private-chat-id'],
    createdAt,
    updatedAt: createdAt,
    ...overrides
  } as AgentChannelEntity
}

function createStore(initial: AgentStoreState): AgentPlatformStateStore {
  let state = initial
  return {
    getState: async () => state,
    update: async (updater) => (state = updater(state)),
    replace: async (next) => (state = next)
  }
}

function createRuntime(state: AgentStoreState) {
  const store = createStore(state)
  const commands = new TaskAutomationCommandService({
    store,
    now: () => new Date('2026-01-02T00:00:00.000Z'),
    defaultTimezone: 'UTC',
    getPolicyPreset: async () => 'balanced'
  })
  return {
    store,
    runtime: new TaskManagementToolRuntimeService({ store, commands })
  }
}

describe('TaskManagementToolRuntimeService', () => {
  it('projects only currently executable task tools for autonomous Agents', async () => {
    const { store, runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent, normalAgent],
      sessions: [session],
      workspaces: [workspace]
    }))

    expect(runtime.getAgentRuntime(await store.getState(), autonomousAgent.id)).toMatchObject({
      agentId: autonomousAgent.id,
      toolNames: [
        'scheduled_task_list',
        'scheduled_task_create',
        'scheduled_task_update',
        'scheduled_task_pause',
        'scheduled_task_resume',
        'scheduled_task_delete',
        'scheduled_task_list_runs'
      ]
    })
    expect(runtime.getAgentRuntime(await store.getState(), autonomousAgent.id).tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'scheduled_task_create',
          approval: 'auto',
          mutating: true,
          inputSchema: expect.objectContaining({ required: expect.arrayContaining(['name', 'prompt', 'trigger', 'workspace']) })
        }),
        expect.objectContaining({
          name: 'scheduled_task_update',
          inputSchema: expect.objectContaining({ required: expect.arrayContaining(['taskId', 'expectedRevision', 'patch']) })
        }),
      ])
    )
    expect(runtime.getAgentRuntime(await store.getState(), normalAgent.id)).toEqual({
      agentId: normalAgent.id,
      toolNames: [],
      tools: []
    })
    const autonomousToolNames = runtime.getAgentRuntime(await store.getState(), autonomousAgent.id).toolNames
    expect(autonomousToolNames).not.toContain('scheduled_task_run_now')
    expect(autonomousToolNames).not.toContain('scheduled_task_cancel_run')

    const deferredRunNow: TaskManagementToolName = 'scheduled_task_run_now'
    // @ts-expect-error Task 6 must not expose execution controls before their real adapters exist.
    const removedCancelRun: TaskManagementToolName = 'scheduled_task_cancel_run'
    expect([deferredRunNow, removedCancelRun]).toHaveLength(2)
  })

  it('rejects a force-injected removed execution control instead of creating a callable path', async () => {
    const { runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent],
      sessions: [session],
      workspaces: [workspace]
    }))

    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-removed-control',
      toolName: 'scheduled_task_cancel_run' as never,
      input: { taskId: 'task-1', runLogId: 'run-1', expectedRevision: 1 }
    })).rejects.toMatchObject({ code: 'task-request-invalid' })
  })

  it('opens run-now only with the queued coordinator adapter and forwards the Agent actor', async () => {
    const state = createAgentStoreState({
      agents: [autonomousAgent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()]
    })
    const store = createStore(state)
    const commands = new TaskAutomationCommandService({
      store,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      defaultTimezone: 'UTC',
      getPolicyPreset: async () => 'balanced'
    })
    const runTask = vi.fn(async () => ({ taskId: 'task-1', runLogId: 'queued-run-1' }))
    const runtime = new TaskManagementToolRuntimeService({ store, commands, runTask })

    expect(runtime.getAgentRuntime(await store.getState(), autonomousAgent.id).toolNames).toContain('scheduled_task_run_now')
    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-run-now',
      toolName: 'scheduled_task_run_now',
      input: { taskId: 'task-1', expectedRevision: 1 }
    })).resolves.toEqual({ taskId: 'task-1', runLogId: 'queued-run-1', status: 'queued' })
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({
      agentId: autonomousAgent.id,
      taskId: 'task-1',
      expectedRevision: 1,
      actor: { kind: 'agent', agentId: autonomousAgent.id, sessionId: session.id, toolCallId: 'tool-run-now' }
    }))
  })

  it('aligns public schemas with the input parser before command validation', async () => {
    const { runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent],
      sessions: [session],
      workspaces: [workspace]
    }))
    const tools = runtime.getAgentRuntime(await createRuntime(createAgentStoreState({
      agents: [autonomousAgent], sessions: [session], workspaces: [workspace]
    })).store.getState(), autonomousAgent.id).tools
    const createSchema = tools.find((tool) => tool.name === 'scheduled_task_create')?.inputSchema
    const updateSchema = tools.find((tool) => tool.name === 'scheduled_task_update')?.inputSchema

    expect(createSchema).toMatchObject({
      properties: {
        trigger: { oneOf: expect.arrayContaining([
          expect.objectContaining({ required: ['kind', 'ms'] }),
          expect.objectContaining({ required: ['kind', 'at'] }),
          expect.objectContaining({ required: ['kind', 'expr'] })
        ]) },
        workspace: { oneOf: expect.arrayContaining([
          expect.objectContaining({ required: ['type'] }),
          expect.objectContaining({ required: ['type', 'workspaceId'] })
        ]) }
      }
    })
    expect(updateSchema).toMatchObject({
      properties: {
        patch: expect.objectContaining({ minProperties: 1, properties: expect.objectContaining({ trigger: expect.any(Object), workspace: expect.any(Object) }) })
      }
    })

    for (const input of [
      { name: 'Invalid', prompt: 'Run', trigger: { kind: 'interval' }, workspace: { type: 'system' } },
      { name: 'Invalid', prompt: 'Run', trigger: { kind: 'once' }, workspace: { type: 'system' } },
      { name: 'Invalid', prompt: 'Run', trigger: { kind: 'cron' }, workspace: { type: 'system' } },
      { name: 'Invalid', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'user' } }
    ]) {
      await expect(runtime.invoke({
        agentId: autonomousAgent.id,
        sessionId: session.id,
        toolCallId: 'tool-invalid-schema',
        toolName: 'scheduled_task_create',
        input
      })).rejects.toMatchObject({ code: 'task-request-invalid' })
    }
    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-empty-patch',
      toolName: 'scheduled_task_update',
      input: { taskId: 'task-1', expectedRevision: 1, patch: {} }
    })).rejects.toMatchObject({ code: 'task-request-invalid' })
  })

  it('returns bounded safe caller-owned task and channel summaries', async () => {
    const foreignTask = task({ id: 'task-foreign', agentId: normalAgent.id, name: 'Foreign task' })
    const foreignChannel = channel({ id: 'channel-foreign', agentId: normalAgent.id, name: 'Foreign channel' })
    const { runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent, normalAgent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task(), foreignTask],
      channels: [channel(), foreignChannel]
    }))

    const result = await runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-list',
      toolName: 'scheduled_task_list',
      input: { limit: 1, offset: 0 }
    })

    expect(result).toEqual({
      tasks: [expect.objectContaining({ id: 'task-1', name: 'Owned task', revision: 4 })],
      total: 1,
      channels: [expect.objectContaining({ id: 'channel-1', name: 'Owned channel', activeChatCount: 1 })]
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Private task prompt')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private-chat-id')
    expect(serialized).not.toContain('Foreign task')
  })

  it('routes Agent mutations through the shared command service with actor provenance and revisions', async () => {
    const { store, runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [task()],
      channels: [channel()]
    }))

    const created = await runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-create',
      toolName: 'scheduled_task_create',
      input: {
        name: 'Created by agent',
        prompt: 'Run safely',
        trigger: { kind: 'interval', ms: 300_000 },
        workspace: { type: 'system' },
        channelIds: ['channel-1']
      }
    })
    expect(created).toMatchObject({ task: { name: 'Created by agent' } })
    expect((await store.getState()).tasks.find((item) => item.name === 'Created by agent')?.provenance).toEqual({
      createdBy: 'agent',
      createdAgentSessionId: session.id,
      createdToolCallId: 'tool-create'
    })

    const updated = await runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-update',
      toolName: 'scheduled_task_update',
      input: { taskId: 'task-1', expectedRevision: 4, patch: { name: 'Updated task' } }
    })
    expect(updated).toMatchObject({ task: { id: 'task-1', name: 'Updated task', revision: 5 } })
    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-stale',
      toolName: 'scheduled_task_update',
      input: { taskId: 'task-1', expectedRevision: 4, patch: { name: 'Stale task' } }
    })).rejects.toMatchObject({ code: 'task-revision-conflict' })
    expect((await store.getState()).tasks.find((item) => item.id === 'task-1')?.name).toBe('Updated task')
  })

  it('rejects cross-Agent task reads and mutations, including foreign channel bindings', async () => {
    const foreignSession: AgentSessionEntity = { ...session, id: 'session-2', agentId: normalAgent.id }
    const foreignTask = task({ id: 'task-foreign', agentId: normalAgent.id, channelIds: ['channel-foreign'] })
    const { runtime } = createRuntime(createAgentStoreState({
      agents: [autonomousAgent, normalAgent],
      sessions: [session, foreignSession],
      workspaces: [workspace],
      tasks: [task(), foreignTask],
      channels: [channel(), channel({ id: 'channel-foreign', agentId: normalAgent.id })]
    }))

    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-foreign-read',
      toolName: 'scheduled_task_list_runs',
      input: { taskId: foreignTask.id, limit: 10, offset: 0 }
    })).rejects.toMatchObject({ code: 'task-not-found' })
    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-foreign-update',
      toolName: 'scheduled_task_update',
      input: { taskId: foreignTask.id, expectedRevision: 4, patch: { name: 'Take over' } }
    })).rejects.toMatchObject({ code: 'task-ownership-denied' })
    await expect(runtime.invoke({
      agentId: autonomousAgent.id,
      sessionId: session.id,
      toolCallId: 'tool-foreign-channel',
      toolName: 'scheduled_task_create',
      input: {
        name: 'Foreign channel',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 300_000 },
        workspace: { type: 'system' },
        channelIds: ['channel-foreign']
      }
    })).rejects.toMatchObject({ code: 'task-channel-ineligible' })
  })
})
