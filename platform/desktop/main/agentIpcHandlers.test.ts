import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../../ai/agent-platform/schemas/agentSchemas'
import type { AgentChannelRuntimeSnapshot } from '../../ai/agent-platform/channels/ChannelRuntimeService'
import type { AgentSessionEntity } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../../ai/agent-platform/schemas/workspaceSchemas'
import type { AgentSkillsRuntimeCatalog } from '../../ai/agent-platform/skills/skillRuntimeSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from '../../ai/agent-platform/services'
import { createAgentIpcHandlers } from './agentIpcHandlers'
import type { AgentSessionRuntimeSnapshot } from '../../ai/agent-platform/runtime/runtimeTypes'
import { ToolApprovalRegistry } from '../../ai/agent-platform/runtime/policy'
import { serializeTaskIpc } from '../ipc/taskIpcEnvelope'

const timestamp = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt: timestamp,
  updatedAt: timestamp
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  configuration: { avatar: 'A' },
  orderKey: 'agent-1',
  createdAt: timestamp,
  updatedAt: timestamp
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  workspaceId: 'workspace-1',
  workspace,
  orderKey: 'session-1',
  createdAt: timestamp,
  updatedAt: timestamp
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

describe('agent ipc handlers', () => {
  it('normalizes real policy persistence failures and recovers through the handler', async () => {
    let preset: 'balanced' | 'conservative' = 'balanced'
    let fail = true
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })), {
      taskAutomation: { getPolicyPreset: async () => preset, setPolicyPreset: async (next) => { if (fail) { fail = false; throw new Error('disk-full /private/settings api-key=secret stack') }; preset = next } }
    })
    const handlers = createAgentIpcHandlers(services)
    const failed = await serializeTaskIpc(() => handlers.updateTaskAutomationPolicy({ policyPreset: 'conservative' }))
    expect(failed).toEqual({ ok: false, error: { code: 'task-internal-error' } })
    expect(JSON.stringify(failed)).not.toMatch(/disk-full|private|secret|stack/i)
    await expect(handlers.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'balanced' })
    await expect(serializeTaskIpc(() => handlers.updateTaskAutomationPolicy({ policyPreset: 'conservative' }))).resolves.toEqual({ ok: true, data: expect.objectContaining({ preset: 'conservative' }) })
    await expect(handlers.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'conservative' })
  })
  it('lists paged sessions and messages from the service layer', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [
          {
            id: 'message-1',
            sessionId: 'session-1',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'hello' }] },
            searchableText: 'hello',
            status: 'success',
            modelId: null,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z'
          }
        ]
      }
    })
    const services = createAgentPlatformServices(createMemoryStateStore(state))
    const handlers = createAgentIpcHandlers(services)

    const sessionsPage = await handlers.listSessions({ limit: 10 })
    const messagesPage = await handlers.listSessionMessages('session-1', { limit: 10 })

    expect(sessionsPage.items.map((item) => item.id)).toEqual(['session-1'])
    expect(messagesPage.items.map((item) => item.id)).toEqual(['message-1'])
  })

  it('returns agent-scoped skill runtime catalog data when the runtime reader is wired', async () => {
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent] })))
    const getSkillRuntime = vi.fn<(agentId: string) => AgentSkillsRuntimeCatalog>().mockReturnValue({
      agentId: 'agent-1',
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          folderName: 'code-reader',
          source: 'local',
          tools: ['Read Docs'],
          runtimeTools: [{ toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' }]
        }
      ]
    })
    const handlers = createAgentIpcHandlers(services, undefined, undefined, undefined, { getSkillRuntime })

    await expect(handlers.getSkillRuntime('agent-1')).resolves.toEqual({
      agentId: 'agent-1',
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          folderName: 'code-reader',
          source: 'local',
          tools: ['Read Docs'],
          runtimeTools: [{ toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' }]
        }
      ]
    })
    expect(getSkillRuntime).toHaveBeenCalledWith('agent-1')
  })

  it('returns channel runtime snapshot data when the reader is wired', async () => {
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent] })))
    const getChannelRuntimeSnapshot = vi.fn<
      (options?: { includeDiagnostics?: boolean }) => AgentChannelRuntimeSnapshot
    >().mockReturnValue({
      channels: [
        {
          channelId: 'channel-1',
          type: 'telegram',
          agentId: 'agent-1',
          sessionId: 'session-1',
          isActive: true,
          activeChatCount: 1,
          runtimeState: 'connecting',
          runtimeLifecycleState: 'awaiting-qr-scan',
          updatedAt: 1
        }
      ]
    })
    const handlers = createAgentIpcHandlers(
      services,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { getChannelRuntimeSnapshot }
    )

    await expect(handlers.getChannelRuntimeSnapshot({ includeDiagnostics: true })).resolves.toEqual({
      channels: [
        {
          channelId: 'channel-1',
          type: 'telegram',
          agentId: 'agent-1',
          sessionId: 'session-1',
          isActive: true,
          activeChatCount: 1,
          runtimeState: 'connecting',
          runtimeLifecycleState: 'awaiting-qr-scan',
          updatedAt: 1
        }
      ]
    })
    expect(getChannelRuntimeSnapshot).toHaveBeenCalledWith({ includeDiagnostics: true })
  })

  it('persists a visible error turn when runtime send fails before writing messages', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] }))
    )
    const runtime = {
      getSnapshot: () => ({
        sessions: {},
        toolApprovals: [],
        toolApprovalHistory: [],
        chunksBySessionId: {},
        updatedAt: timestamp
      }),
      listToolApprovals: () => [],
      resolveToolApproval: () => ({
        sessions: {},
        toolApprovals: [],
        toolApprovalHistory: [],
        chunksBySessionId: {},
        updatedAt: timestamp
      }),
      cancelMessage: () => false,
      cancelSession: () => false,
      sendMessage: vi.fn(async () => {
        throw new Error('Claude Code provider is not ready.')
      })
    }
    const handlers = createAgentIpcHandlers(services, runtime)

    const result = await handlers.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: '你好',
      runId: 'run-1',
      mentionedModels: [
        {
          id: 'provider-1:chat-model',
          label: 'Chat Model',
          providerName: 'Provider 1'
        }
      ]
    })

    expect(runtime.sendMessage).toHaveBeenCalled()
    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toContain('Claude Code provider is not ready.')
    expect(result.state.messagesBySessionId['session-1'].map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(result.state.messagesBySessionId['session-1'][0].data.parts[0]).toMatchObject({
      type: 'agent-mentioned-models',
      modelIds: ['provider-1:chat-model'],
      models: [
        {
          id: 'provider-1:chat-model',
          label: 'Chat Model',
          providerName: 'Provider 1'
        }
      ]
    })
    expect(result.state.messagesBySessionId['session-1'][0].searchableText).toContain('你好')
  })

  it('restarts channel runtime through the handler facade when the control is wired', async () => {
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState({ agents: [agent] })))
    const restartChannelRuntime = vi
      .fn<(channelId: string) => AgentChannelRuntimeSnapshot>()
      .mockReturnValue({
        channels: [
          {
            channelId: 'channel-1',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connecting',
            updatedAt: 2
          }
        ]
      })
    const handlers = createAgentIpcHandlers(
      services,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        getChannelRuntimeSnapshot: () => ({ channels: [] }),
        restartChannelRuntime
      }
    )

    await expect(handlers.restartChannelRuntime('channel-1')).resolves.toEqual({
      channels: [
        {
          channelId: 'channel-1',
          type: 'telegram',
          agentId: 'agent-1',
          sessionId: 'session-1',
          isActive: true,
          activeChatCount: 1,
          runtimeState: 'connecting',
          updatedAt: 2
        }
      ]
    })
    expect(restartChannelRuntime).toHaveBeenCalledWith('channel-1')
  })

  it('creates, updates, selects, and deletes sessions through the service layer', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const handlers = createAgentIpcHandlers(services)

    const created = await handlers.createSession({
      agentId: 'agent-1',
      name: 'Created',
      workspace: { type: 'system' }
    })
    const updated = await handlers.updateSession(created.id, { name: 'Renamed' })
    const selectedState = await handlers.selectSession(created.id)
    const deletedIds = await handlers.deleteSessions([created.id])

    expect(updated.name).toBe('Renamed')
    expect(selectedState.activeSessionId).toBe(created.id)
    expect(selectedState.activeAgentId).toBe('agent-1')
    expect(deletedIds.deletedIds).toEqual([created.id])
  })

  it('marks session selection as a focused active-selection persistence update', async () => {
    const optionsSeen: unknown[] = []
    let state = createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] })
    const store: AgentPlatformStateStore = {
      getState: async () => state,
      update: async (updater, options) => {
        optionsSeen.push(options)
        state = updater(state)
        return state
      },
      replace: async (nextState) => {
        state = nextState
        return state
      }
    }
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(store))

    await handlers.selectSession(session.id)

    expect(optionsSeen).toContainEqual({ activeSelectionRowOnly: true })
  })

  it('toggles pin state and clears or deletes messages through the service layer', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [
          {
            id: 'message-1',
            sessionId: 'session-1',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'hello' }] },
            searchableText: 'hello',
            status: 'success',
            modelId: null,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z'
          }
        ]
      }
    })
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(createMemoryStateStore(state)))

    const pinnedState = await handlers.toggleSessionPin('session-1')
    await handlers.deleteSessionMessage('session-1', 'message-1')
    const clearedState = await handlers.clearSessionMessages('session-1')

    expect(pinnedState.sessionPins.map((item) => item.sessionId)).toEqual(['session-1'])
    expect(clearedState.messagesBySessionId['session-1']).toEqual([])
  })

  it('reorders sessions and rebinds workspace through the service layer', async () => {
    const secondWorkspace: AgentWorkspaceEntity = {
      id: 'workspace-2',
      name: 'Workspace Two',
      path: '/tmp/workspace-two',
      type: 'user',
      orderKey: 'workspace-2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const secondSession: AgentSessionEntity = {
      ...session,
      id: 'session-2',
      name: 'Session Two',
      orderKey: 'session-2'
    }
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session, secondSession],
      workspaces: [workspace, secondWorkspace]
    })
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(createMemoryStateStore(state)))

    const reorderedState = await handlers.reorderSessions(['session-2', 'session-1'])
    const reboundSession = await handlers.setSessionWorkspace('session-1', { type: 'user', workspaceId: 'workspace-2' })

    expect(reorderedState.sessions.map((item) => item.id)).toEqual(['session-2', 'session-1'])
    expect(reboundSession.workspaceId).toBe('workspace-2')
  })

  it('updates agent model and configuration through the service layer', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    })
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(createMemoryStateStore(state)))

    const updated = await handlers.updateAgent('agent-1', {
      model: 'provider:model-b',
      configuration: {
        ...agent.configuration,
        permission_mode: 'plan',
        soul_enabled: true,
        heartbeat_enabled: false
      }
    })

    expect(updated.model).toBe('provider:model-b')
    expect(updated.configuration?.permission_mode).toBe('plan')
    expect(updated.configuration?.soul_enabled).toBe(true)
    expect(updated.configuration?.heartbeat_enabled).toBe(false)
  })

  it('creates, lists, selects, reorders, and deletes agents through the service layer', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    })
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(createMemoryStateStore(state)))

    const created = await handlers.createAgent({
      type: 'claude-code',
      name: 'Created Agent',
      model: 'provider:model-b',
      configuration: { avatar: 'C' }
    })
    const listed = await handlers.listAgents({ search: 'created' })
    const selectedState = await handlers.selectAgent(created.id)
    const reorderedState = await handlers.reorderAgents([created.id, agent.id])
    const deletedState = await handlers.deleteAgent(created.id)

    expect(created.name).toBe('Created Agent')
    expect(listed.agents.map((item) => item.id)).toEqual([created.id])
    expect(selectedState.activeAgentId).toBe(created.id)
    expect(reorderedState.agents.map((item) => item.id)).toEqual([created.id, agent.id])
    expect(deletedState.agents.map((item) => item.id)).toEqual([agent.id])
  })

  it('lists scheduled tasks and task run logs through the service layer', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const handlers = createAgentIpcHandlers(services)
    const task = await services.tasks.create(agent.id, {
      name: 'Daily check',
      prompt: 'Check status',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' }
    })
    await services.tasks.addRunLog({
      id: 'task-run-1',
      scheduleId: task.id,
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 10,
      status: 'completed',
      result: 'ok'
    })

    const taskPage = await handlers.listTasks(agent.id, { limit: 10 })
    const logsPage = await handlers.getTaskLogs(agent.id, task.id, { limit: 5 })

    expect(taskPage.tasks.map((item) => item.id)).toEqual([task.id])
    expect(logsPage.logs.map((item) => item.id)).toEqual(['task-run-1'])
  })

  it('exposes bounded task automation reads and persists the selected policy preset', async () => {
    let policyPreset: 'balanced' | 'conservative' = 'balanced'
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })),
      {
        taskAutomation: {
          getPolicyPreset: async () => policyPreset,
          setPolicyPreset: async (next) => {
            policyPreset = next
          },
          defaultTimezone: 'Asia/Shanghai',
          now: () => new Date('2026-07-16T00:00:00.000Z')
        }
      }
    )
    const handlers = createAgentIpcHandlers(services)

    await expect(handlers.previewTaskSchedule({ kind: 'cron', expr: '0 9 * * *' })).resolves.toEqual({
      ok: true,
      nextRunAt: '2026-07-16T01:00:00.000Z'
    })
    await expect(handlers.listTaskPage({ limit: 10 })).resolves.toEqual({ tasks: [], total: 0 })
    await expect(handlers.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'balanced' })
    await expect(handlers.updateTaskAutomationPolicy({ policyPreset: 'conservative' })).resolves.toMatchObject({
      preset: 'conservative'
    })
    expect(policyPreset).toBe('conservative')
  })

  it('creates, updates, and deletes scheduled tasks through the service layer', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const handlers = createAgentIpcHandlers(services)

    const created = await handlers.createTask(agent.id, {
      name: 'Daily check',
      prompt: 'Check status',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' },
      timeoutMinutes: 5
    })
    const updated = await handlers.updateTask(agent.id, created.id, {
      expectedRevision: created.revision ?? 1,
      patch: {
        name: 'Updated check',
        enabled: false
      }
    })
    const deleted = await handlers.deleteTask(agent.id, created.id, {
      expectedRevision: updated?.revision ?? 1
    })
    const afterDelete = await services.tasks.get(agent.id, created.id)

    expect(created.agentId).toBe(agent.id)
    expect(updated?.name).toBe('Updated check')
    expect(updated?.enabled).toBe(false)
    expect(deleted).toBe(true)
    expect(afterDelete).toBeNull()
  })

  it('rejects a stale task draft rather than reading a newer revision on behalf of the caller', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const handlers = createAgentIpcHandlers(services)
    const created = await handlers.createTask(agent.id, {
      name: 'Revisioned task',
      prompt: 'Check status',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' }
    })

    await handlers.updateTask(agent.id, created.id, { expectedRevision: 1, patch: { name: 'Fresh edit' } })

    await expect(
      handlers.updateTask(agent.id, created.id, { expectedRevision: 1, patch: { name: 'Stale edit' } })
    ).rejects.toMatchObject({ code: 'task-revision-conflict' })
    await expect(services.tasks.get(agent.id, created.id)).resolves.toMatchObject({ name: 'Fresh edit', revision: 2 })
  })

  it('delegates manual scheduled task runs through the task runner seam', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const task = await services.tasks.create(agent.id, {
      name: 'Manual check',
      prompt: 'Check status',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' }
    })
    const runTask = vi.fn(async () => ({
      taskId: 'task-1',
      runLogId: 'task-run-1'
    }))
    const handlers = createAgentIpcHandlers(services, undefined, { runTask })

    await expect(handlers.runTask(agent.id, task.id, { expectedRevision: task.revision ?? 1 })).resolves.toEqual({
      taskId: 'task-1',
      runLogId: 'task-run-1'
    })
    expect(runTask).toHaveBeenCalledWith(agent.id, task.id, task.revision ?? 1)
  })

  it('delegates task run cancellation through the task runner seam', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          agents: [{ ...agent, configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' } }],
          sessions: [session],
          workspaces: [workspace]
        })
      )
    )
    const cancelTaskRun = vi.fn(async () => ({
      runLogId: 'task-run-1',
      jobRunId: 'run-1',
      cancelled: true
    }))
    const handlers = createAgentIpcHandlers(services, undefined, undefined, { cancelTaskRun })

    await expect(handlers.cancelTaskRun('task-run-1')).resolves.toEqual({
      runLogId: 'task-run-1',
      jobRunId: 'run-1',
      cancelled: true
    })
    expect(cancelTaskRun).toHaveBeenCalledWith('task-run-1')
  })

  it('delegates target-specific task delivery retry through the delivery seam', async () => {
    const services = createAgentPlatformServices(createMemoryStateStore(createAgentStoreState()))
    const retryTaskDelivery = vi.fn(async () => ({ delivered: 1, failed: 0, skipped: 0, unknown: 0 }))
    const handlers = createAgentIpcHandlers(
      services,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { retryTaskDelivery }
    )

    await expect(handlers.retryTaskDelivery('agent-1', 'run-1', 'attempt-1')).resolves.toEqual({
      delivered: 1,
      failed: 0,
      skipped: 0,
      unknown: 0
    })
    expect(retryTaskDelivery).toHaveBeenCalledWith('agent-1', 'run-1', 'attempt-1')
  })

  it('exposes runtime session cancellation through the handler facade', async () => {
    const runtimeSnapshot: AgentSessionRuntimeSnapshot = {
      sessions: {
        'session-1': {
          sessionId: 'session-1',
          agentId: 'agent-1',
          agentType: 'claude-code',
          inflightRequestCount: 1,
          queuedTurnCount: 0,
          turnState: 'running',
          turnPhase: 'streaming',
          warmState: 'cold',
          lastRunId: 'run-1',
          lastResumeToken: null,
          lastResumeTokenSource: null,
          lastTerminalStatus: null,
          lastStopReason: null,
          lastWarmAt: null,
          lastWarmResultMessage: null,
          traceId: null,
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      },
      toolApprovals: [],
      toolApprovalHistory: [],
      chunksBySessionId: {},
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const handlers = createAgentIpcHandlers(createAgentPlatformServices(createMemoryStateStore(createAgentStoreState())), {
      getSnapshot: () => runtimeSnapshot,
      sendMessage: vi.fn(),
      cancelSession: () => false,
      cancelMessage: () => false
    })

    expect(handlers.cancelSession?.('session-1')).toBe(false)
    expect(handlers.getRuntimeSnapshot()).toEqual(runtimeSnapshot)
  })

  it('exposes tool approval listing and resolution through the handler facade', async () => {
    const approvalRegistry = new ToolApprovalRegistry()
    const pending = approvalRegistry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })
    const handlers = createAgentIpcHandlers(
      createAgentPlatformServices(createMemoryStateStore(createAgentStoreState())),
      {
        getSnapshot: () => ({
          sessions: {},
          toolApprovals: approvalRegistry.listPending(),
          toolApprovalHistory: approvalRegistry.listHistory(),
          chunksBySessionId: {},
          updatedAt: '2026-01-01T00:00:00.000Z'
        }),
        listToolApprovals: () => approvalRegistry.listPending(),
        listToolApprovalHistory: () => approvalRegistry.listHistory(),
        sendMessage: vi.fn(),
        resolveToolApproval: (approvalId, decision) => {
          approvalRegistry.resolve(approvalId, decision)
          return {
            sessions: {},
            toolApprovals: approvalRegistry.listPending(),
            toolApprovalHistory: approvalRegistry.listHistory(),
            chunksBySessionId: {},
            updatedAt: '2026-01-01T00:00:01.000Z'
          }
        },
        cancelSession: () => false,
        cancelMessage: () => false
      }
    )

    expect(handlers.listToolApprovals()).toEqual([
      {
        approvalId: pending.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash'
      }
    ])

    const nextSnapshot = handlers.resolveToolApproval(pending.approvalId, {
      behavior: 'deny',
      message: 'Need manual confirmation.'
    })

    await expect(pending.result).resolves.toEqual({
      behavior: 'deny',
      message: 'Need manual confirmation.'
    })
    expect(nextSnapshot.toolApprovals).toEqual([])
  })

  it('exposes safe runtime compatibility and gateway status through the handler facade', async () => {
    const compatibility = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      selectable: false,
      route: 'none' as const,
      status: 'auth-failed' as const,
      summary: 'Direct Claude Code runtime authentication failed.'
    }
    const gatewaySnapshot = {
      enabled: false,
      state: 'disabled' as const,
      port: 18779,
      updatedAt: '2026-07-09T00:00:00.000Z'
    }
    const handlers = createAgentIpcHandlers(
      createAgentPlatformServices(createMemoryStateStore(createAgentStoreState())),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        getRuntimeCompatibility: vi.fn(async () => compatibility),
        probeRuntimeCompatibility: vi.fn(async () => compatibility),
        getModelGatewayStatus: () => gatewaySnapshot,
        startModelGateway: vi.fn(async () => ({ ok: false, snapshot: gatewaySnapshot, message: 'disabled' })),
        stopModelGateway: vi.fn(async () => ({ ok: true, snapshot: gatewaySnapshot })),
        setModelGatewayEnabled: vi.fn(async (enabled: boolean) => ({
          ...gatewaySnapshot,
          enabled,
          state: enabled ? ('stopped' as const) : ('disabled' as const)
        }))
      }
    )

    await expect(handlers.getRuntimeCompatibility('deepseek', 'deepseek-chat', 'claude-code')).resolves.toEqual(compatibility)
    await expect(handlers.probeRuntimeCompatibility('deepseek', 'deepseek-chat', 'claude-code')).resolves.toEqual(compatibility)
    expect(handlers.getModelGatewayStatus()).toEqual(gatewaySnapshot)
    await expect(handlers.setModelGatewayEnabled(true)).resolves.toMatchObject({ enabled: true, state: 'stopped' })
    expect(JSON.stringify(compatibility)).not.toMatch(/apiKey|secret|ANTHROPIC_API_KEY/)
  })
})
