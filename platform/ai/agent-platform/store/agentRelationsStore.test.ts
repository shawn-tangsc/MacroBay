import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState } from './agentStore'
import {
  addTaskRunLog,
  createScheduledAgentTask,
  deleteAgentChannel,
  deleteInstalledSkill,
  deleteMcpServer,
  setMcpServerTools,
  setMcpRuntimeStatus,
  setAgentSkillEnabled,
  upsertAgentChannel,
  reorderMcpServers,
  upsertMcpServer,
  upsertInstalledSkill,
  replaceTaskChannelSubscriptions,
  updateScheduledAgentTask
} from './agentRelationsStore'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

const autonomousAgent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Autonomous Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  configuration: { permission_mode: 'bypassPermissions' },
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001'
}

const guardedAgent: AgentEntity = {
  ...autonomousAgent,
  id: 'agent-2',
  name: 'Guarded Agent',
  configuration: { permission_mode: 'default' },
  orderKey: '0002'
}

const channel: AgentChannelEntity = {
  id: 'channel-1',
  type: 'telegram',
  name: 'Telegram',
  agentId: 'agent-1',
  workspace: { type: 'system' },
  config: { bot_token: 'token' },
  isActive: true,
  activeChatIds: [],
  permissionMode: 'default',
  createdAt,
  updatedAt: createdAt
}

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Review Skill',
  description: 'Skill',
  folderName: 'review-skill',
  source: 'builtin',
  sourceUrl: null,
  namespace: null,
  author: null,
  sourceTags: ['review'],
  contentHash: 'hash',
  isEnabled: true,
  createdAt,
  updatedAt: createdAt
}

const mcpServer: McpServerEntity = {
  id: 'mcp-1',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  tags: ['files'],
  isActive: true,
  installSource: 'manual',
  sortOrder: 1,
  createdAt,
  updatedAt: createdAt
}

describe('agent relation store', () => {
  it('upserts, reorders, and deletes MCP servers like registry rows', () => {
    const state = createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace] })
    const withMcp = upsertMcpServer(state, mcpServer)
    const withSecondMcp = upsertMcpServer(withMcp, {
      ...mcpServer,
      id: 'mcp-2',
      name: 'GitHub',
      sortOrder: 2
    })
    const reordered = reorderMcpServers(withSecondMcp, ['mcp-2', 'mcp-1'])
    const renamed = upsertMcpServer(reordered, { ...mcpServer, name: 'Local Filesystem' })
    const deleted = deleteMcpServer(
      {
        ...renamed,
        mcpToolsByServerId: { 'mcp-1': [{ id: 'read', name: 'read' }] },
        mcpRuntimeStatusByServerId: { 'mcp-1': { state: 'connected', lastCheckedAt: 1 } },
        agents: renamed.agents.map((agent) => ({ ...agent, mcps: ['mcp-1', 'mcp-2'] }))
      },
      'mcp-1'
    )

    expect(withMcp.mcpServers[0].name).toBe('Filesystem')
    expect(reordered.mcpServers.map((server) => server.id)).toEqual(['mcp-2', 'mcp-1'])
    expect(reordered.mcpServers.map((server) => server.sortOrder)).toEqual([0, 1])
    expect(renamed.mcpServers.find((server) => server.id === 'mcp-1')?.name).toBe('Local Filesystem')
    expect(deleted.mcpServers.map((server) => server.id)).toEqual(['mcp-2'])
    expect(deleted.mcpToolsByServerId['mcp-1']).toBeUndefined()
    expect(deleted.mcpRuntimeStatusByServerId['mcp-1']).toBeUndefined()
    expect(deleted.agents[0].mcps).toEqual(['mcp-2'])
  })

  it('stores MCP runtime status for registered servers only', () => {
    const state = createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace], mcpServers: [mcpServer] })

    const withStatus = setMcpRuntimeStatus(state, 'mcp-1', {
      state: 'error',
      message: 'Process exited',
      lastCheckedAt: 2
    })
    const unchanged = setMcpRuntimeStatus(withStatus, 'missing-mcp', { state: 'connected', lastCheckedAt: 3 })

    expect(withStatus.mcpRuntimeStatusByServerId['mcp-1']).toEqual({
      state: 'error',
      message: 'Process exited',
      lastCheckedAt: 2
    })
    expect(unchanged).toBe(withStatus)
  })

  it('stores discovered MCP tools for registered servers only', () => {
    const state = createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace], mcpServers: [mcpServer] })

    const withTools = setMcpServerTools(state, 'mcp-1', [
      { id: 'read', name: 'read', description: 'Read resource' },
      { name: 'search' }
    ])
    const unchanged = setMcpServerTools(withTools, 'missing-mcp', [{ name: 'missing' }])

    expect(withTools.mcpToolsByServerId['mcp-1']).toEqual([
      { id: 'read', name: 'read', description: 'Read resource', inputSchema: undefined },
      { id: 'search', name: 'search', description: undefined, inputSchema: undefined }
    ])
    expect(unchanged).toBe(withTools)
  })

  it('upserts channels and cascades channel deletion into task subscriptions', () => {
    const state = createAgentStoreState({
      agents: [autonomousAgent],
      workspaces: [workspace],
      channels: [channel],
      channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-1' }],
      tasks: [
        {
          id: 'task-1',
          agentId: 'agent-1',
          name: 'Task',
          prompt: 'Run',
          trigger: { kind: 'interval', ms: 60000 },
          workspace: { type: 'system' },
          timeoutMinutes: 2,
          channelIds: ['channel-1'],
          enabled: true,
          status: 'active',
          createdAt,
          updatedAt: createdAt
        }
      ]
    })

    const renamed = upsertAgentChannel(state, { ...channel, name: 'Telegram Bot' })
    expect(renamed.channels).toHaveLength(1)
    expect(renamed.channels[0].name).toBe('Telegram Bot')

    const deleted = deleteAgentChannel(renamed, 'channel-1')
    expect(deleted.channels).toEqual([])
    expect(deleted.channelTaskSubscriptions).toEqual([])
    expect(deleted.tasks[0].channelIds).toEqual([])
  })

  it('stores global skills and per-agent enabled state like agent_skill joins', () => {
    const state = createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace] })
    const withSkill = upsertInstalledSkill(state, skill)
    const enabled = setAgentSkillEnabled(withSkill, 'agent-1', 'skill-1', true)

    expect(enabled.skills[0].folderName).toBe('review-skill')
    expect(enabled.agentSkills).toEqual([{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }])

    const deleted = deleteInstalledSkill(enabled, 'skill-1')
    expect(deleted.skills).toEqual([])
    expect(deleted.agentSkills).toEqual([])
  })

  it('requires autonomous permission before creating scheduled tasks', () => {
    const state = createAgentStoreState({ agents: [autonomousAgent, guardedAgent], workspaces: [workspace] })

    expect(() =>
      createScheduledAgentTask(state, 'agent-2', {
        name: 'Guarded task',
        prompt: 'Run',
        trigger: { kind: 'once', at: Date.UTC(2026, 0, 1) },
        workspace: { type: 'system' }
      })
    ).toThrow(/Soul Mode or Bypass Permissions/)

    const next = createScheduledAgentTask(state, 'agent-1', {
      name: 'Autonomous task',
      prompt: 'Run',
      trigger: { kind: 'interval', ms: 60000 },
      workspace: { type: 'system' },
      timeoutMinutes: 5,
      channelIds: ['channel-1']
    })

    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]).toMatchObject({
      agentId: 'agent-1',
      name: 'Autonomous task',
      timeoutMinutes: 5,
      enabled: true,
      status: 'active',
      channelIds: ['channel-1']
    })
    expect(next.channelTaskSubscriptions).toEqual([{ channelId: 'channel-1', taskId: next.tasks[0].id }])
  })

  it('pauses and resumes scheduled tasks through explicit active state transitions', () => {
    const state = createScheduledAgentTask(
      createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace] }),
      'agent-1',
      {
        name: 'Autonomous task',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 60000 },
        workspace: { type: 'system' }
      }
    )
    const taskId = state.tasks[0].id

    const paused = updateScheduledAgentTask(state, taskId, { enabled: false })
    const resumed = updateScheduledAgentTask(paused, taskId, { enabled: true })

    expect(paused.tasks[0]).toMatchObject({
      enabled: false,
      status: 'paused',
      pauseReason: 'user',
      revision: 2
    })
    expect(resumed.tasks[0]).toMatchObject({
      enabled: true,
      status: 'active',
      pauseReason: null,
      revision: 3
    })
    expect(resumed.tasks[0].failureResetAt).toEqual(expect.any(String))
  })

  it('rejects every update for completed one-time tasks without mutating task state', () => {
    const state = createAgentStoreState({
      agents: [autonomousAgent],
      workspaces: [workspace],
      tasks: [
        {
          id: 'task-once-completed',
          agentId: 'agent-1',
          name: 'One-time task',
          prompt: 'Run once',
          trigger: { kind: 'once', at: Date.UTC(2026, 0, 1) },
          workspace: { type: 'system' },
          timeoutMinutes: 2,
          enabled: false,
          status: 'completed',
          revision: 4,
          createdAt,
          updatedAt: createdAt
        }
      ],
      channelTaskSubscriptions: [{ taskId: 'task-once-completed', channelId: 'channel-1' }]
    })

    const taskBeforeUpdate = state.tasks[0]
    const subscriptionsBeforeUpdate = state.channelTaskSubscriptions

    expect(() => updateScheduledAgentTask(state, 'task-once-completed', { enabled: true })).toThrow(/completed/i)
    expect(() => updateScheduledAgentTask(state, 'task-once-completed', { enabled: false })).toThrow(/completed/i)
    expect(() => updateScheduledAgentTask(state, 'task-once-completed', { name: 'Renamed task', channelIds: [] })).toThrow(
      /completed/i
    )
    expect(state.tasks[0]).toEqual(taskBeforeUpdate)
    expect(state.channelTaskSubscriptions).toEqual(subscriptionsBeforeUpdate)
  })

  it('replaces task channel subscriptions and appends task run logs', () => {
    const state = createScheduledAgentTask(
      createAgentStoreState({ agents: [autonomousAgent], workspaces: [workspace] }),
      'agent-1',
      {
        name: 'Autonomous task',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 60000 },
        workspace: { type: 'system' },
        channelIds: ['channel-1']
      }
    )
    const taskId = state.tasks[0].id
    const withSubscriptions = replaceTaskChannelSubscriptions(state, taskId, ['channel-2', 'channel-3'])
    const withLog = addTaskRunLog(withSubscriptions, {
      id: 'run-1',
      scheduleId: taskId,
      sessionId: 'session-1',
      startedAt: createdAt,
      durationMs: 240,
      status: 'completed',
      result: 'ok'
    })

    expect(withSubscriptions.tasks[0].channelIds).toEqual(['channel-2', 'channel-3'])
    expect(withSubscriptions.channelTaskSubscriptions).toEqual([
      { channelId: 'channel-2', taskId },
      { channelId: 'channel-3', taskId }
    ])
    expect(withLog.taskRunLogs).toEqual([expect.objectContaining({ id: 'run-1', scheduleId: taskId })])
  })
})
