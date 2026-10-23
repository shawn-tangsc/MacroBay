import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createAgentPlatformRepositories } from './createAgentPlatformRepositories'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent One',
  description: 'General helper',
  instructions: 'Be helpful.',
  model: 'provider:model-a',
  modelName: 'model-a',
  mcps: [],
  disabledTools: [],
  configuration: { avatar: 'A' },
  orderKey: '0001',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function sessionFixture(input: {
  id: string
  orderKey: string
  updatedAt: string
  name: string
}): AgentSessionEntity {
  return {
    id: input.id,
    agentId: agent.id,
    name: input.name,
    workspaceId: workspace.id,
    workspace,
    orderKey: input.orderKey,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt
  }
}

function seedSessionGraph(repos: ReturnType<typeof createAgentPlatformRepositories>, input?: { sessionId?: string }): void {
  repos.workspaces.upsert(workspace)
  repos.sessions.upsert(
    sessionFixture({
      id: input?.sessionId ?? 'session-1',
      orderKey: '2026-01-01T00:00:00.000Z-0001',
      updatedAt: '2026-01-01T00:00:00.000Z',
      name: 'Seed Session'
    })
  )
}

function messageFixture(input: {
  id: string
  sessionId: string
  createdAt: string
  role?: AgentSessionMessageEntity['role']
  text: string
  status?: AgentSessionMessageEntity['status']
}): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: input.sessionId,
    role: input.role ?? 'assistant',
    data: { parts: [{ type: 'text', text: input.text }] },
    searchableText: input.text,
    status: input.status ?? 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  }
}

describe('agent platform sqlite repositories', () => {
  it('boots schema migrations and persists agents, workspaces, and sessions with cursor pagination', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)

    repos.agents.upsert(agent)
    repos.workspaces.upsert(workspace)
    repos.sessions.upsert(sessionFixture({ id: 'session-1', orderKey: '0001', updatedAt: '2026-01-01T00:00:00.000Z', name: 'First' }))
    repos.sessions.upsert(sessionFixture({ id: 'session-2', orderKey: '0002', updatedAt: '2026-01-02T00:00:00.000Z', name: 'Second' }))
    repos.sessions.upsert(sessionFixture({ id: 'session-3', orderKey: '0003', updatedAt: '2026-01-03T00:00:00.000Z', name: 'Third' }))

    const firstPage = repos.sessions.listByCursor({ limit: 2 })
    const secondPage = repos.sessions.listByCursor({ cursor: firstPage.nextCursor, limit: 2 })

    expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(['session-1', 'session-2'])
    expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual(['session-3'])
  })

  it('queries agents with search, stable sorting, and offset pagination at the repository layer', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)

    repos.agents.upsert({
      ...agent,
      id: 'agent-alpha',
      name: 'Alpha Agent',
      description: 'Primary helper',
      orderKey: '0002',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z'
    })
    repos.agents.upsert({
      ...agent,
      id: 'agent-beta',
      name: 'Beta Agent',
      description: 'Secondary helper',
      orderKey: '0003',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    repos.agents.upsert({
      ...agent,
      id: 'agent-gamma',
      name: 'Gamma Agent',
      description: 'Alpha-capable helper',
      orderKey: '0001',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z'
    })

    const firstPage = repos.agents.list({ search: 'alpha', sortBy: 'updatedAt', sortOrder: 'desc', limit: 1 })
    const secondPage = repos.agents.list({
      search: 'alpha',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      limit: 1,
      offset: 1
    })
    const fetched = repos.agents.get('agent-alpha')

    expect(firstPage.total).toBe(2)
    expect(firstPage.agents.map((item: AgentEntity) => item.id)).toEqual(['agent-gamma'])
    expect(secondPage.agents.map((item: AgentEntity) => item.id)).toEqual(['agent-alpha'])
    expect(fetched?.name).toBe('Alpha Agent')
  })

  it('queries workspaces with user filtering, id lookup, and path lookup at the repository layer', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const systemWorkspace: AgentWorkspaceEntity = {
      ...workspace,
      id: 'workspace-system',
      name: 'System Workspace',
      path: '/tmp/system-workspace',
      type: 'system',
      orderKey: '0001'
    }
    const userWorkspace: AgentWorkspaceEntity = {
      ...workspace,
      id: 'workspace-user',
      name: 'User Workspace',
      path: '/tmp/user-workspace',
      type: 'user',
      orderKey: '0002'
    }

    repos.workspaces.upsert(systemWorkspace)
    repos.workspaces.upsert(userWorkspace)

    const userOnly = repos.workspaces.list()
    const allWorkspaces = repos.workspaces.list({ includeSystem: true })
    const hiddenSystem = repos.workspaces.getById(systemWorkspace.id)
    const visibleSystem = repos.workspaces.getById(systemWorkspace.id, { includeSystem: true })
    const byPath = repos.workspaces.findByPath('/tmp/user-workspace')

    expect(userOnly.map((item: AgentWorkspaceEntity) => item.id)).toEqual(['workspace-user'])
    expect(allWorkspaces.map((item: AgentWorkspaceEntity) => item.id)).toEqual(['workspace-system', 'workspace-user'])
    expect(hiddenSystem).toBeNull()
    expect(visibleSystem?.id).toBe('workspace-system')
    expect(byPath?.id).toBe('workspace-user')
  })

  it('lists pinned sessions before unpinned sessions with cursor pagination', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)

    repos.agents.upsert(agent)
    repos.workspaces.upsert(workspace)
    repos.sessions.upsert(sessionFixture({ id: 'session-1', orderKey: '0001', updatedAt: '2026-01-01T00:00:00.000Z', name: 'First' }))
    repos.sessions.upsert(sessionFixture({ id: 'session-2', orderKey: '0002', updatedAt: '2026-01-02T00:00:00.000Z', name: 'Second' }))
    repos.sessions.upsert(sessionFixture({ id: 'session-3', orderKey: '0003', updatedAt: '2026-01-03T00:00:00.000Z', name: 'Third' }))
    repos.sessions.upsert(sessionFixture({ id: 'session-4', orderKey: '0004', updatedAt: '2026-01-04T00:00:00.000Z', name: 'Fourth' }))
    repos.sessionPins.replaceAll([
      { id: 'pin-1', sessionId: 'session-3', createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'pin-2', sessionId: 'session-1', createdAt: '2026-01-06T00:00:00.000Z' }
    ])

    const firstPage = repos.sessions.listByCursor({ limit: 2 })
    const secondPage = repos.sessions.listByCursor({ cursor: firstPage.nextCursor, limit: 2 })

    expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(['session-3', 'session-1'])
    expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual(['session-2', 'session-4'])
  })

  it('stores session messages newest-first with cursor pagination', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    seedSessionGraph(repos)

    repos.messages.upsert(
      messageFixture({ id: 'message-1', sessionId: 'session-1', createdAt: '2026-01-01T00:00:01.000Z', text: 'first' })
    )
    repos.messages.upsert(
      messageFixture({ id: 'message-2', sessionId: 'session-1', createdAt: '2026-01-01T00:00:02.000Z', text: 'second' })
    )
    repos.messages.upsert(
      messageFixture({ id: 'message-3', sessionId: 'session-1', createdAt: '2026-01-01T00:00:03.000Z', text: 'third' })
    )

    const firstPage = repos.messages.listByCursor('session-1', { limit: 2 })
    const secondPage = repos.messages.listByCursor('session-1', { cursor: firstPage.nextCursor, limit: 2 })

    expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(['message-3', 'message-2'])
    expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual(['message-1'])
  })

  it('searches message content through sqlite FTS instead of full in-memory scans', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    seedSessionGraph(repos, { sessionId: 'session-1' })
    seedSessionGraph(repos, { sessionId: 'session-2' })

    repos.messages.upsert(
      messageFixture({
        id: 'message-1',
        sessionId: 'session-1',
        createdAt: '2026-01-01T00:00:01.000Z',
        text: 'Review the breakout invalidation'
      })
    )
    repos.messages.upsert(
      messageFixture({
        id: 'message-2',
        sessionId: 'session-2',
        createdAt: '2026-01-01T00:00:02.000Z',
        text: 'Summarize execution risk'
      })
    )

    const results = repos.messages.search({ q: 'breakout', limit: 10 })

    expect(results.items.map((item) => item.messageId)).toEqual(['message-1'])
    expect(results.items[0]).toMatchObject({
      sessionId: 'session-1',
      role: 'assistant'
    })
  })

  it('supports message search pagination and time/session filters at the repository layer', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    seedSessionGraph(repos, { sessionId: 'session-1' })
    seedSessionGraph(repos, { sessionId: 'session-2' })

    repos.messages.upsert(
      messageFixture({
        id: 'message-1',
        sessionId: 'session-1',
        createdAt: '2026-01-01T00:00:01.000Z',
        text: 'breakout base case'
      })
    )
    repos.messages.upsert(
      messageFixture({
        id: 'message-2',
        sessionId: 'session-1',
        createdAt: '2026-01-01T00:00:02.000Z',
        text: 'breakout follow up'
      })
    )
    repos.messages.upsert(
      messageFixture({
        id: 'message-3',
        sessionId: 'session-2',
        createdAt: '2026-01-01T00:00:03.000Z',
        text: 'breakout other session'
      })
    )

    const firstPage = repos.messages.search({ q: 'breakout', sessionId: 'session-1', limit: 1 })
    const secondPage = repos.messages.search({
      q: 'breakout',
      sessionId: 'session-1',
      limit: 1,
      cursor: firstPage.nextCursor
    })
    const filtered = repos.messages.search({
      q: 'breakout',
      sessionId: 'session-1',
      createdAtFrom: '2026-01-01T00:00:01.500Z',
      limit: 10
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual(['message-2'])
    expect(firstPage.nextCursor).toBeDefined()
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['message-1'])
    expect(filtered.items.map((item) => item.messageId)).toEqual(['message-2'])
  })

  it('keeps session cursors decodable when order keys include timestamp separators', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)

    repos.workspaces.upsert(workspace)
    repos.sessions.upsert(
      sessionFixture({
        id: 'session-1',
        orderKey: '2026-01-01T00:00:00.000Z-0001',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'First'
      })
    )
    repos.sessions.upsert(
      sessionFixture({
        id: 'session-2',
        orderKey: '2026-01-01T00:00:00.000Z-0002',
        updatedAt: '2026-01-01T00:00:01.000Z',
        name: 'Second'
      })
    )
    repos.sessions.upsert(
      sessionFixture({
        id: 'session-3',
        orderKey: '2026-01-01T00:00:00.000Z-0003',
        updatedAt: '2026-01-01T00:00:02.000Z',
        name: 'Third'
      })
    )

    const firstPage = repos.sessions.listByCursor({ limit: 2 })
    const secondPage = repos.sessions.listByCursor({ limit: 2, cursor: firstPage.nextCursor })

    expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(['session-1', 'session-2'])
    expect(secondPage.items.map((item: { id: string }) => item.id)).toEqual(['session-3'])
  })

  it('persists session pins and auxiliary platform state collections in sqlite transition tables', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    seedSessionGraph(repos)

    repos.sessionPins.replaceAll([
      {
        id: 'pin-1',
        sessionId: 'session-1',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ])

    const mcpServers: McpServerEntity[] = [
      {
        id: 'mcp-1',
        name: 'Server One',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const mcpToolsByServerId: McpToolsByServerId = {
      'mcp-1': [{ id: 'search', name: 'search', description: 'Search', inputSchema: { type: 'object' } }]
    }
    const mcpRuntimeStatusByServerId: Record<string, McpRuntimeStatus> = {
      'mcp-1': { state: 'connected', lastCheckedAt: 1 }
    }
    const channels: AgentChannelEntity[] = [
      {
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram',
        agentId: agent.id,
        workspace: { type: 'user', workspaceId: workspace.id },
        config: { bot_token: 'token' },
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const skills: InstalledSkill[] = [
      {
        id: 'skill-1',
        name: 'Skill',
        description: null,
        folderName: 'skill',
        source: 'builtin',
        sourceUrl: null,
        namespace: null,
        author: null,
        sourceTags: [],
        contentHash: 'hash',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const tasks: ScheduledTaskEntity[] = [
      {
        id: 'task-1',
        agentId: agent.id,
        name: 'Task',
        prompt: 'Run it',
        trigger: { kind: 'interval', ms: 60_000 },
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: workspace.id },
        channelIds: ['channel-1'],
        enabled: true,
        status: 'active',
        revision: 1,
        pauseReason: null,
        failureResetAt: null,
        provenance: { createdBy: 'user' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const taskRunLogs: TaskRunLogEntity[] = [
      {
        id: 'log-1',
        scheduleId: 'task-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 50,
        status: 'completed',
        result: 'ok'
      }
    ]

    repos.stateEntries.replacePlatformStateCollections({
      mcpServers,
      mcpToolsByServerId,
      mcpRuntimeStatusByServerId,
      channels,
      skills,
      agentSkills: [{ agentId: agent.id, skillId: 'skill-1', isEnabled: true }],
      tasks,
      taskRunLogs,
      channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-1' }],
      activeAgentId: agent.id,
      activeSessionId: 'session-1'
    })

    expect(repos.sessionPins.list()).toEqual([
      {
        id: 'pin-1',
        sessionId: 'session-1',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ])
    expect(repos.stateEntries.get<McpServerEntity[]>('mcpServers')).toEqual(mcpServers)
    expect(repos.stateEntries.get<McpToolsByServerId>('mcpToolsByServerId')).toEqual(mcpToolsByServerId)
    expect(repos.stateEntries.get<Record<string, McpRuntimeStatus>>('mcpRuntimeStatusByServerId')).toEqual(
      mcpRuntimeStatusByServerId
    )
    expect(repos.stateEntries.get<AgentChannelEntity[]>('channels')).toBeNull()
    expect(repos.stateEntries.get<InstalledSkill[]>('skills')).toEqual(skills)
    expect(repos.stateEntries.get<ScheduledTaskEntity[]>('tasks')).toEqual(tasks)
    expect(repos.stateEntries.get<TaskRunLogEntity[]>('taskRunLogs')).toEqual(taskRunLogs)
    expect(
      repos.stateEntries.get<{ activeAgentId: string | null; activeSessionId: string | null }>('activeSelection')
    ).toEqual({
      activeAgentId: agent.id,
      activeSessionId: 'session-1'
    })
  })

  it('writes installed skills and agent-skill bindings into row-level sqlite tables without legacy mirrors', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const skills: InstalledSkill[] = [
      {
        id: 'skill-1',
        name: 'Review Skill',
        description: 'Review code',
        folderName: 'review-skill',
        source: 'builtin',
        sourceUrl: null,
        namespace: 'platform',
        author: 'OpenAI',
        sourceTags: ['review', 'code'],
        contentHash: 'hash-1',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'skill-2',
        name: 'Docs Skill',
        description: null,
        folderName: 'docs-skill',
        source: 'local',
        sourceUrl: 'file:///tmp/docs-skill',
        namespace: null,
        author: null,
        sourceTags: [],
        contentHash: 'hash-2',
        isEnabled: false,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    const agentSkills = [
      { agentId: agent.id, skillId: 'skill-1', isEnabled: true },
      { agentId: agent.id, skillId: 'skill-2', isEnabled: false }
    ]

    repos.replaceAllState({
      agents: [agent],
      workspaces: [workspace],
      sessions: [sessionFixture({ id: 'session-1', orderKey: '0001', updatedAt: '2026-01-01T00:00:00.000Z', name: 'First' })],
      sessionPins: [],
      messages: [],
      platformStateCollections: {
        mcpServers: [],
        mcpToolsByServerId: {},
        mcpRuntimeStatusByServerId: {},
        channels: [],
        skills,
        agentSkills,
        tasks: [],
        taskRunLogs: [],
        channelTaskSubscriptions: [],
        activeAgentId: agent.id,
        activeSessionId: 'session-1'
      }
    })

    expect(repos.skills.listAll()).toEqual(skills)
    expect(repos.skills.getByFolderName('review-skill')).toEqual(skills[0])
    expect(repos.agentSkills.listAll()).toEqual(agentSkills)
    expect(repos.agentSkills.listByAgentId(agent.id)).toEqual(agentSkills)
    expect(repos.stateEntries.get('skills')).toBeNull()
    expect(repos.stateEntries.get('agentSkills')).toBeNull()
  })

  it('clears migrated platform state-entry mirrors during whole-state replace while keeping active selection fallback', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const mcpServers: McpServerEntity[] = [
      {
        id: 'mcp-1',
        name: 'MCP One',
        type: 'stdio',
        isActive: true,
        sortOrder: 1,
        installSource: 'manual',
        command: 'echo',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const mcpToolsByServerId: McpToolsByServerId = {
      'mcp-1': [{ id: 'tool-1', name: 'Tool One', description: 'A tool' }]
    }
    const mcpRuntimeStatusByServerId: Record<string, McpRuntimeStatus> = {
      'mcp-1': { state: 'connected', lastCheckedAt: 1 }
    }
    const channels: AgentChannelEntity[] = [
      {
        id: 'channel-1',
        type: 'telegram',
        name: 'Channel One',
        agentId: agent.id,
        workspace: { type: 'user', workspaceId: workspace.id },
        config: { bot_token: 'token' },
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const skills: InstalledSkill[] = [
      {
        id: 'skill-1',
        name: 'Skill One',
        description: null,
        folderName: 'skill-one',
        source: 'builtin',
        sourceUrl: null,
        namespace: null,
        author: null,
        sourceTags: [],
        contentHash: 'hash-1',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const tasks: ScheduledTaskEntity[] = [
      {
        id: 'task-1',
        agentId: agent.id,
        name: 'Task One',
        prompt: 'Run it',
        trigger: { kind: 'interval', ms: 60_000 },
        catchUpPolicy: { kind: 'skip-missed' },
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: workspace.id },
        channelIds: ['channel-1'],
        enabled: true,
        status: 'active',
        revision: 1,
        pauseReason: null,
        failureResetAt: null,
        provenance: { createdBy: 'user' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const taskRunLogs: TaskRunLogEntity[] = [
      {
        id: 'log-1',
        scheduleId: 'task-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 50,
        status: 'completed',
        result: 'ok'
      }
    ]

    repos.stateEntries.replacePlatformStateCollections({
      mcpServers: [{ ...mcpServers[0], id: 'legacy-mcp' }],
      mcpToolsByServerId: { 'legacy-mcp': [{ id: 'legacy-tool', name: 'Legacy Tool' }] },
      mcpRuntimeStatusByServerId: { 'legacy-mcp': { state: 'error', message: 'legacy', lastCheckedAt: 0 } },
      channels: [{ ...channels[0], id: 'legacy-channel' }],
      skills: [{ ...skills[0], id: 'legacy-skill', folderName: 'legacy-skill' }],
      agentSkills: [{ agentId: agent.id, skillId: 'legacy-skill', isEnabled: true }],
      tasks: [{ ...tasks[0], id: 'legacy-task' }],
      taskRunLogs: [{ ...taskRunLogs[0], id: 'legacy-log', scheduleId: 'legacy-task' }],
      channelTaskSubscriptions: [{ channelId: 'legacy-channel', taskId: 'legacy-task' }],
      activeAgentId: 'legacy-agent',
      activeSessionId: 'legacy-session'
    })

    repos.replaceAllState({
      agents: [agent],
      workspaces: [workspace],
      sessions: [sessionFixture({ id: 'session-1', orderKey: '0001', updatedAt: '2026-01-01T00:00:00.000Z', name: 'First' })],
      sessionPins: [],
      messages: [],
      platformStateCollections: {
        mcpServers,
        mcpToolsByServerId,
        mcpRuntimeStatusByServerId,
        channels,
        skills,
        agentSkills: [{ agentId: agent.id, skillId: 'skill-1', isEnabled: true }],
        tasks,
        taskRunLogs,
        channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-1' }],
        activeAgentId: agent.id,
        activeSessionId: 'session-1'
      }
    }, { writeTaskDefinitions: true, writeTaskRunLogs: true })

    expect(repos.mcpServers.listAll().map((server) => server.id)).toEqual(['mcp-1'])
    expect(repos.mcpTools.listAll()).toEqual(mcpToolsByServerId)
    expect(repos.mcpRuntimeStatus.listAll()).toEqual(mcpRuntimeStatusByServerId)
    expect(repos.channels.listAll()).toEqual([])
    expect(repos.skills.listAll().map((skill) => skill.id)).toEqual(['skill-1'])
    expect(repos.agentSkills.listAll()).toEqual([{ agentId: agent.id, skillId: 'skill-1', isEnabled: true }])
    expect(repos.tasks.listAll().map((task) => task.id)).toEqual(['task-1'])
    expect(repos.taskRunLogs.listAll().map((log) => log.id)).toEqual(['log-1'])
    expect(repos.channelTaskSubscriptions.listAll()).toEqual([{ channelId: 'channel-1', taskId: 'task-1' }])

    expect(repos.stateEntries.get('mcpServers')).toBeNull()
    expect(repos.stateEntries.get('mcpToolsByServerId')).toBeNull()
    expect(repos.stateEntries.get('mcpRuntimeStatusByServerId')).toBeNull()
    expect(repos.stateEntries.get('channels')).toBeNull()
    expect(repos.stateEntries.get('skills')).toBeNull()
    expect(repos.stateEntries.get('agentSkills')).toBeNull()
    expect(repos.stateEntries.get('tasks')).toBeNull()
    expect(repos.stateEntries.get('taskRunLogs')).toBeNull()
    expect(repos.stateEntries.get('channelTaskSubscriptions')).toBeNull()
    expect(
      repos.stateEntries.get<{ activeAgentId: string | null; activeSessionId: string | null }>('activeSelection')
    ).toEqual({
      activeAgentId: agent.id,
      activeSessionId: 'session-1'
    })
  })

  it('queries installed skills with search and agent enabled-state projection at the repository layer', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const skills: InstalledSkill[] = [
      {
        id: 'skill-1',
        name: 'Code Review',
        description: 'Review TypeScript changes',
        folderName: 'code-review',
        source: 'builtin',
        sourceUrl: null,
        namespace: 'platform',
        author: 'OpenAI',
        sourceTags: ['code', 'review'],
        contentHash: 'hash-1',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'skill-2',
        name: 'Docs Writer',
        description: 'Draft platform docs',
        folderName: 'docs-writer',
        source: 'local',
        sourceUrl: null,
        namespace: null,
        author: null,
        sourceTags: ['docs'],
        contentHash: 'hash-2',
        isEnabled: true,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    repos.skills.replaceAll(skills)
    repos.agentSkills.replaceAll([
      { agentId: agent.id, skillId: 'skill-1', isEnabled: false },
      { agentId: agent.id, skillId: 'skill-2', isEnabled: true }
    ])

    expect(repos.skills.list({ search: 'review', agentId: agent.id })).toEqual([
      {
        ...skills[0],
        isEnabled: false
      }
    ])
    expect(repos.skills.list({ search: 'docs', agentId: agent.id })).toEqual([
      {
        ...skills[1],
        isEnabled: true
      }
    ])
    expect(repos.skills.list({ agentId: 'agent-without-bindings' }).map((skill) => skill.isEnabled)).toEqual([
      false,
      false
    ])
  })

  it('updates skill rows and agent-skill bindings through focused writer seams', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const skills: InstalledSkill[] = [
      {
        id: 'skill-1',
        name: 'Code Review',
        description: 'Review TypeScript changes',
        folderName: 'code-review',
        source: 'builtin',
        sourceUrl: null,
        namespace: 'platform',
        author: 'OpenAI',
        sourceTags: ['code', 'review'],
        contentHash: 'hash-1',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'skill-2',
        name: 'Docs Writer',
        description: 'Draft platform docs',
        folderName: 'docs-writer',
        source: 'local',
        sourceUrl: null,
        namespace: null,
        author: null,
        sourceTags: ['docs'],
        contentHash: 'hash-2',
        isEnabled: true,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    repos.skills.replaceAll(skills)
    repos.agentSkills.replaceAll([
      { agentId: agent.id, skillId: 'skill-1', isEnabled: true },
      { agentId: 'agent-2', skillId: 'skill-1', isEnabled: true },
      { agentId: 'agent-2', skillId: 'skill-2', isEnabled: true }
    ])

    repos.skills.upsert({
      ...skills[0],
      name: 'Code Review Updated',
      sourceTags: ['updated'],
      updatedAt: '2026-01-03T00:00:00.000Z'
    })
    repos.agentSkills.replaceForAgent(agent.id, [
      { agentId: agent.id, skillId: 'skill-2', isEnabled: false }
    ])

    expect(repos.skills.get('skill-1')).toMatchObject({
      name: 'Code Review Updated',
      sourceTags: ['updated']
    })
    expect(repos.agentSkills.listByAgentId(agent.id)).toEqual([
      { agentId: agent.id, skillId: 'skill-2', isEnabled: false }
    ])
    expect(repos.agentSkills.listByAgentId('agent-2')).toEqual([
      { agentId: 'agent-2', skillId: 'skill-1', isEnabled: true },
      { agentId: 'agent-2', skillId: 'skill-2', isEnabled: true }
    ])

    repos.skills.delete('skill-1')

    expect(repos.skills.get('skill-1')).toBeNull()
    expect(repos.agentSkills.listAll()).toEqual([
      { agentId: agent.id, skillId: 'skill-2', isEnabled: false },
      { agentId: 'agent-2', skillId: 'skill-2', isEnabled: true }
    ])
  })

  it('can preserve skill row tables during whole-state replace after focused skill writers run', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const focusedSkill: InstalledSkill = {
      id: 'skill-focused',
      name: 'Focused Skill',
      description: 'Persisted through focused writer',
      folderName: 'focused-skill',
      source: 'local',
      sourceUrl: null,
      namespace: null,
      author: null,
      sourceTags: ['focused'],
      contentHash: 'hash-focused',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const snapshotSkill: InstalledSkill = {
      ...focusedSkill,
      name: 'Snapshot Skill',
      sourceTags: ['snapshot'],
      contentHash: 'hash-snapshot',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const focusedBinding = { agentId: agent.id, skillId: focusedSkill.id, isEnabled: true }
    const snapshotBinding = { agentId: agent.id, skillId: snapshotSkill.id, isEnabled: false }
    repos.skills.replaceAll([focusedSkill])
    repos.agentSkills.replaceAll([focusedBinding])

    repos.replaceAllState(
      {
        agents: [agent],
        workspaces: [workspace],
        sessions: [
          sessionFixture({ id: 'session-1', orderKey: '0001', updatedAt: '2026-01-01T00:00:00.000Z', name: 'First' })
        ],
        sessionPins: [],
        messages: [],
        platformStateCollections: {
          mcpServers: [],
          mcpToolsByServerId: {},
          mcpRuntimeStatusByServerId: {},
          channels: [],
          skills: [snapshotSkill],
          agentSkills: [snapshotBinding],
          tasks: [],
          taskRunLogs: [],
          channelTaskSubscriptions: [],
          activeAgentId: agent.id,
          activeSessionId: 'session-1'
        }
      },
      { skipSkillRows: true }
    )

    expect(repos.skills.listAll()).toEqual([focusedSkill])
    expect(repos.agentSkills.listAll()).toEqual([focusedBinding])
    expect(repos.stateEntries.get('skills')).toBeNull()
    expect(repos.stateEntries.get('agentSkills')).toBeNull()
  })

  it('stores scheduled tasks in row-level sqlite tables with agent filtering and pagination', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const otherAgent: AgentEntity = {
      ...agent,
      id: 'agent-2',
      name: 'Agent Two',
      orderKey: '0002'
    }
    const tasks: ScheduledTaskEntity[] = [
      {
        id: 'task-1',
        agentId: agent.id,
        name: 'First task',
        prompt: 'Run first',
        trigger: { kind: 'interval', ms: 60_000 },
        catchUpPolicy: { kind: 'skip-missed' },
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: workspace.id },
        channelIds: ['channel-1'],
        enabled: true,
        status: 'active',
        revision: 1,
        pauseReason: null,
        failureResetAt: null,
        provenance: { createdBy: 'user' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'task-2',
        agentId: agent.id,
        name: 'Newest task',
        prompt: 'Run newest',
        trigger: { kind: 'once', at: Date.UTC(2026, 0, 2) },
        timeoutMinutes: 5,
        workspace: { type: 'system' },
        channelIds: [],
        enabled: false,
        status: 'paused',
        revision: 2,
        pauseReason: 'user',
        failureResetAt: '2026-01-02T00:00:00.000Z',
        provenance: { createdBy: 'agent', createdAgentSessionId: 'session-1', createdToolCallId: 'tool-1' },
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'task-3',
        agentId: otherAgent.id,
        name: 'Other task',
        prompt: 'Run other',
        trigger: { kind: 'interval', ms: 120_000 },
        timeoutMinutes: 1,
        workspace: { type: 'system' },
        enabled: true,
        status: 'active',
        revision: 1,
        pauseReason: null,
        failureResetAt: null,
        provenance: { createdBy: 'user' },
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    repos.tasks.replaceAll(tasks)

    expect(repos.tasks.listAll()).toEqual(tasks)
    expect(repos.tasks.list(agent.id, { limit: 1 })).toEqual({
      tasks: [tasks[1]],
      total: 2
    })
    expect(repos.tasks.list(agent.id, { offset: 1 })).toEqual({
      tasks: [tasks[0]],
      total: 2
    })
  })

  it('stores task run logs in row-level sqlite tables with task filtering and pagination', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const logs: TaskRunLogEntity[] = [
      {
        id: 'log-1',
        scheduleId: 'task-1',
        sessionId: 'session-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 50,
        status: 'completed',
        result: 'ok'
      },
      {
        id: 'log-2',
        scheduleId: 'task-1',
        sessionId: null,
        startedAt: '2026-01-02T00:00:00.000Z',
        durationMs: 25,
        status: 'failed',
        error: 'boom'
      },
      {
        id: 'log-3',
        scheduleId: 'task-2',
        startedAt: '2026-01-03T00:00:00.000Z',
        durationMs: 10,
        status: 'cancelled',
        result: 'cancelled'
      }
    ]

    repos.taskRunLogs.replaceAll(logs)

    const expectedLogs: TaskRunLogEntity[] = [
      { ...logs[0], error: null },
      { ...logs[1], result: null },
      { ...logs[2], sessionId: null, error: null }
    ]

    expect(repos.taskRunLogs.listAll()).toEqual(expectedLogs)
    expect(repos.taskRunLogs.list('task-1', { limit: 1 })).toEqual({
      logs: [expectedLogs[1]],
      total: 2
    })
    expect(repos.taskRunLogs.list('task-1', { offset: 1 })).toEqual({
      logs: [expectedLogs[0]],
      total: 2
    })
  })

  it('does not let ordinary run-log replacement or whole-state replacement delete or rewrite durable history', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskRunLogs.upsert({
      id: 'run-durable', scheduleId: 'task-original', agentId: 'agent-original', taskNameSnapshot: 'Original task',
      startedAt: '2026-01-01T00:00:00.000Z', durationMs: 0, status: 'running'
    })
    repos.taskRunLogs.replaceAll([])
    repos.taskRunLogs.replaceAllForTasks(['task-original'], [])
    repos.replaceAllState({
      agents: [], workspaces: [], sessions: [], sessionPins: [], messages: [],
      platformStateCollections: {
        mcpServers: [], mcpToolsByServerId: {}, mcpRuntimeStatusByServerId: {}, channels: [], skills: [], agentSkills: [], tasks: [],
        taskRunLogs: [{
          id: 'run-durable', scheduleId: 'task-tampered', agentId: 'agent-tampered', taskNameSnapshot: 'Tampered task',
          startedAt: '2026-01-01T00:00:00.000Z', durationMs: 5, status: 'completed', resultPreview: 'Tampered'
        }],
        channelTaskSubscriptions: [], activeAgentId: null, activeSessionId: null
      }
    })

    expect(repos.taskRunLogs.list('task-original').logs).toEqual([
      expect.objectContaining({
        id: 'run-durable', scheduleId: 'task-original', agentId: 'agent-original', taskNameSnapshot: 'Original task', status: 'running'
      })
    ])
  })

  it('returns stable keyset all-task pages and persists automation maintenance checkpoints outside Agent state', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.tasks.upsert({
      id: 'task-active', agentId: agent.id, name: 'Active task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
      timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.tasks.upsert({
      id: 'task-paused', agentId: agent.id, name: 'Paused task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
      timeoutMinutes: 2, workspace: { type: 'system' }, enabled: false, status: 'paused', revision: 1,
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
    })

    const firstPage = repos.tasks.listPage({ limit: 1 })
    repos.tasks.upsert({
      id: 'task-inserted', agentId: agent.id, name: 'Inserted task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
      timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
      createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z'
    })
    const secondPage = repos.tasks.listPage({ limit: 1, cursor: firstPage.nextCursor })

    expect(firstPage.tasks).toEqual([expect.objectContaining({ id: 'task-paused' })])
    expect(firstPage.total).toBe(2)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(secondPage.tasks).toEqual([expect.objectContaining({ id: 'task-active' })])
    expect(secondPage.total).toBe(3)
    expect(secondPage.tasks.map((task) => task.id)).not.toContain('task-paused')
    expect(repos.tasks.listPage({ status: 'paused', limit: 500 })).toEqual({
      tasks: [expect.objectContaining({ id: 'task-paused' })], total: 1, nextCursor: undefined
    })
    repos.taskAutomationMaintenance.set('retention-checkpoint', { cursor: 'attempt-9' }, '2026-01-03T00:00:00.000Z')
    expect(repos.taskAutomationMaintenance.get('retention-checkpoint')).toEqual({ cursor: 'attempt-9' })
  })

  it('persists task history snapshots and pages delivery attempts and mutation audits independently of task definitions', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.tasks.upsert({
      id: 'task-history', agentId: agent.id, name: 'History task', prompt: 'Run', trigger: { kind: 'interval', ms: 5 * 60_000 },
      timeoutMinutes: 2, workspace: { type: 'system' }, enabled: true, status: 'active', revision: 1,
      pauseReason: null, failureResetAt: null, provenance: { createdBy: 'user' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.taskRunLogs.upsert({
      id: 'run-history', scheduleId: 'task-history', agentId: agent.id, taskNameSnapshot: 'History task',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 10, status: 'completed', resultPreview: 'preview',
      resultHash: 'hash', resultCharCount: 42, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      deliverySummary: { delivered: 1, failed: 0, skipped: 0, unknown: 0 }
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-1', runLogId: 'run-history', taskId: 'task-history', agentId: agent.id, taskNameSnapshot: 'History task',
      channelId: 'channel-1', targetHash: 'recipient-hash', status: 'pending', attemptNumber: 1, startedAt: '2026-01-02T00:00:01.000Z'
    })
    repos.taskDeliveryAttempts.finalize({ id: 'attempt-1', status: 'delivered', completedAt: '2026-01-02T00:00:02.000Z' })
    repos.taskMutationAudits.insert({
      id: 'audit-1', taskId: 'task-history', agentId: agent.id, taskNameSnapshot: 'History task', action: 'create',
      actor: { kind: 'user', source: 'renderer-settings' }, requestHash: 'request-hash', resultRevision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', outcome: 'accepted', errorCode: null
    })
    repos.tasks.delete('task-history')

    expect(repos.taskRunLogs.list('task-history').logs).toEqual([
      expect.objectContaining({ id: 'run-history', agentId: agent.id, taskNameSnapshot: 'History task', resultPreview: 'preview' })
    ])
    expect(repos.taskDeliveryAttempts.listByRun('run-history', { limit: 10, offset: 0 })).toEqual({
      attempts: [expect.objectContaining({ id: 'attempt-1', status: 'delivered', targetHash: 'recipient-hash' })], total: 1
    })
    expect(repos.taskMutationAudits.listByTask('task-history', { limit: 10, offset: 0 })).toEqual({
      audits: [expect.objectContaining({ id: 'audit-1', outcome: 'accepted', actor: { kind: 'user', source: 'renderer-settings' } })], total: 1
    })
    expect(repos.taskMutationAudits.listByAgent(agent.id, { limit: 10, offset: 0 }).total).toBe(1)
  })

  it('finds delivery attempts exactly and allocates target attempt numbers without a history page', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-old', runLogId: 'run-sequenced', taskId: 'task-1', agentId: agent.id, taskNameSnapshot: 'Task one',
      channelId: 'channel-1', targetHash: 'target-a', status: 'pending', attemptNumber: 101, startedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-other-target', runLogId: 'run-sequenced', taskId: 'task-1', agentId: agent.id, taskNameSnapshot: 'Task one',
      channelId: 'channel-1', targetHash: 'target-b', status: 'pending', attemptNumber: 7, startedAt: '2026-01-01T00:01:00.000Z'
    })

    expect(repos.taskDeliveryAttempts.get('run-sequenced', 'attempt-old')).toEqual(
      expect.objectContaining({ id: 'attempt-old', attemptNumber: 101 })
    )
    expect(repos.taskDeliveryAttempts.get('run-other', 'attempt-old')).toBeNull()
    expect(repos.taskDeliveryAttempts.nextAttemptNumber('run-sequenced', 'channel-1', 'target-a')).toBe(102)
    expect(repos.taskDeliveryAttempts.nextAttemptNumber('run-sequenced', 'channel-1', 'target-b')).toBe(8)
    expect(repos.taskDeliveryAttempts.summarizeByRun('run-sequenced')).toEqual({
      delivered: 0,
      failed: 0,
      skipped: 0,
      unknown: 0
    })

    expect(repos.taskDeliveryAttempts.createPendingWithNextAttemptNumber({
      id: 'attempt-next', runLogId: 'run-sequenced', taskId: 'task-1', agentId: agent.id, taskNameSnapshot: 'Task one',
      channelId: 'channel-1', targetHash: 'target-a', status: 'pending', startedAt: '2026-01-01T00:02:00.000Z'
    })).toEqual(expect.objectContaining({ id: 'attempt-next', attemptNumber: 102 }))
    expect(repos.taskDeliveryAttempts.summarizeByRun('run-sequenced')).toEqual({
      delivered: 0,
      failed: 0,
      skipped: 0,
      unknown: 0
    })
  })

  it('keeps existing run history ownership snapshots immutable while allowing terminal metadata updates', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskRunLogs.upsert({
      id: 'run-immutable', scheduleId: 'task-original', agentId: 'agent-original', taskNameSnapshot: 'Original task',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 0, status: 'running'
    })
    repos.taskRunLogs.upsert({
      id: 'run-immutable', scheduleId: 'task-late', agentId: 'agent-late', taskNameSnapshot: 'Late task',
      startedAt: '2026-01-02T00:00:00.000Z', durationMs: 25, status: 'completed', resultPreview: 'Finished'
    })

    expect(repos.taskRunLogs.list('task-original').logs).toEqual([
      expect.objectContaining({
        id: 'run-immutable',
        scheduleId: 'task-original',
        agentId: 'agent-original',
        taskNameSnapshot: 'Original task',
        status: 'completed',
        resultPreview: 'Finished'
      })
    ])
    expect(repos.taskRunLogs.list('task-late').total).toBe(0)
  })

  it('marks stale pending delivery attempts unknown without loading them into Agent state', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-stale', runLogId: 'run-stale', taskId: 'task-stale', agentId: agent.id, taskNameSnapshot: 'Stale task',
      channelId: 'channel-1', targetHash: 'hash', status: 'pending', attemptNumber: 1, startedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-fresh', runLogId: 'run-stale', taskId: 'task-stale', agentId: agent.id, taskNameSnapshot: 'Stale task',
      channelId: 'channel-1', targetHash: 'hash', status: 'pending', attemptNumber: 2, startedAt: '2026-01-03T00:00:00.000Z'
    })
    expect(repos.taskDeliveryAttempts.markStalePendingUnknown('2026-01-02T00:00:00.000Z')).toBe(1)
    expect(repos.taskDeliveryAttempts.listByRun('run-stale', { limit: 10, offset: 0 }).attempts.find((attempt) => attempt.id === 'attempt-stale')).toMatchObject({
      status: 'unknown-after-restart', completedAt: '2026-01-02T00:00:00.000Z'
    })
    expect(repos.taskDeliveryAttempts.listByRun('run-stale', { limit: 10, offset: 0 }).attempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'attempt-fresh', status: 'pending' })])
    )
  })

  it('removes old run history together with its delivery attempts in bounded batches', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskRunLogs.upsert({
      id: 'run-old', scheduleId: 'task-old', agentId: agent.id, taskNameSnapshot: 'Old task',
      startedAt: '2025-01-01T00:00:00.000Z', durationMs: 1, status: 'completed'
    })
    repos.taskRunLogs.upsert({
      id: 'run-current', scheduleId: 'task-current', agentId: agent.id, taskNameSnapshot: 'Current task',
      startedAt: '2026-07-16T00:00:00.000Z', durationMs: 1, status: 'completed'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-old', runLogId: 'run-old', taskId: 'task-old', agentId: agent.id, taskNameSnapshot: 'Old task',
      channelId: 'channel-1', targetHash: null, status: 'pending', attemptNumber: 1, startedAt: '2025-01-01T00:00:01.000Z'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-current', runLogId: 'run-current', taskId: 'task-current', agentId: agent.id, taskNameSnapshot: 'Current task',
      channelId: 'channel-1', targetHash: null, status: 'pending', attemptNumber: 1, startedAt: '2026-07-16T00:00:01.000Z'
    })

    expect(repos.taskRunLogs.deleteOlderThan('2026-01-01T00:00:00.000Z', 1)).toEqual({ deletedRuns: 1, deletedAttempts: 1 })
    expect(repos.taskRunLogs.get('run-old')).toBeNull()
    expect(repos.taskDeliveryAttempts.listByRun('run-old', { limit: 10, offset: 0 })).toEqual({ attempts: [], total: 0 })
    expect(repos.taskRunLogs.get('run-current')).toEqual(expect.objectContaining({ id: 'run-current' }))
    expect(repos.taskDeliveryAttempts.listByRun('run-current', { limit: 10, offset: 0 }).total).toBe(1)
  })

  it('keeps 10,000-run history queries bounded and resumes retention after reopening SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-task-history-scale-'))
    const path = join(directory, 'agents.sqlite')
    const taskId = 'task-history-scale'
    const heapBefore = process.memoryUsage().heapUsed
    const startedAt = performance.now()
    try {
      const database = createAgentPlatformDatabase(path)
      const repos = createAgentPlatformRepositories(database)
      const history: TaskRunLogEntity[] = Array.from({ length: 10_000 }, (_, index) => ({
        id: `run-${String(index).padStart(5, '0')}`,
        scheduleId: taskId,
        agentId: agent.id,
        taskNameSnapshot: 'History scale task',
        startedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        durationMs: 1,
        status: 'completed'
      }))
      repos.taskRunLogs.replaceAll(history)

      const page = repos.taskRunLogs.list(taskId, { limit: 10_000, offset: 0 })
      expect(page.total).toBe(10_000)
      expect(page.logs).toHaveLength(100)
      expect(page.logs[0]).toMatchObject({ id: 'run-09999' })

      expect(repos.taskRunLogs.deleteOlderThan('2026-01-01T00:00:00.000Z', 500)).toEqual({
        deletedRuns: 500,
        deletedAttempts: 0
      })
      expect(repos.taskRunLogs.list(taskId, { limit: 1 }).total).toBe(9_500)
      database.connection.close()

      const reopened = createAgentPlatformDatabase(path)
      const reopenedRepos = createAgentPlatformRepositories(reopened)
      expect(reopenedRepos.taskRunLogs.deleteOlderThan('2026-01-01T00:00:00.000Z', 500)).toEqual({
        deletedRuns: 500,
        deletedAttempts: 0
      })
      const resumedPage = reopenedRepos.taskRunLogs.list(taskId, { limit: 100, offset: 0 })
      expect(resumedPage).toMatchObject({ total: 9_000 })
      expect(resumedPage.logs).toHaveLength(100)
      reopened.connection.close()

      const elapsedMs = performance.now() - startedAt
      const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore
      // This broad budget detects accidental full-page/history materialization without CI timing flakiness.
      expect(elapsedMs).toBeLessThan(10_000)
      expect(heapDeltaBytes).toBeLessThan(128 * 1024 * 1024)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('removes delivery attempts older than the attempt retention cutoff without deleting warm runs', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.taskRunLogs.upsert({
      id: 'run-warm', scheduleId: 'task-warm', agentId: agent.id, taskNameSnapshot: 'Warm task',
      startedAt: '2026-02-01T00:00:00.000Z', durationMs: 1, status: 'completed'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-old', runLogId: 'run-warm', taskId: 'task-warm', agentId: agent.id, taskNameSnapshot: 'Warm task',
      channelId: 'channel-1', targetHash: null, status: 'pending', attemptNumber: 1, startedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-current', runLogId: 'run-warm', taskId: 'task-warm', agentId: agent.id, taskNameSnapshot: 'Warm task',
      channelId: 'channel-2', targetHash: null, status: 'pending', attemptNumber: 1, startedAt: '2026-07-01T00:00:00.000Z'
    })

    expect(repos.taskDeliveryAttempts.deleteOlderThan('2026-01-16T00:00:00.000Z', 500)).toBe(0)
    expect(repos.taskRunLogs.get('run-warm')).toEqual(expect.objectContaining({ id: 'run-warm' }))
    expect(repos.taskDeliveryAttempts.listByRun('run-warm', { limit: 10, offset: 0 }).attempts).toEqual([
      expect.objectContaining({ id: 'attempt-current' }),
      expect.objectContaining({ id: 'attempt-old' })
    ])
  })

  it('prevents delivery-attempt status rewrites outside the pending to terminal transition', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    expect(() => repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-invalid', runLogId: 'run-1', taskId: 'task-1', agentId: agent.id, taskNameSnapshot: 'Task',
      channelId: 'channel-1', targetHash: null, status: 'delivered', attemptNumber: 1, startedAt: '2026-01-01T00:00:00.000Z'
    })).toThrow('pending')

    repos.taskDeliveryAttempts.insertPending({
      id: 'attempt-terminal', runLogId: 'run-1', taskId: 'task-1', agentId: agent.id, taskNameSnapshot: 'Task',
      channelId: 'channel-1', targetHash: null, status: 'pending', attemptNumber: 1, startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'must-not-persist'
    })
    expect(repos.taskDeliveryAttempts.listByRun('run-1', { limit: 1, offset: 0 }).attempts).toEqual([
      expect.objectContaining({ id: 'attempt-terminal', status: 'pending', completedAt: null, errorCode: null })
    ])
    expect(repos.taskDeliveryAttempts.finalize({ id: 'attempt-terminal', status: 'delivered', completedAt: '2026-01-01T00:01:00.000Z' })).toBe(true)
    expect(repos.taskDeliveryAttempts.finalize({ id: 'attempt-terminal', status: 'failed', completedAt: '2026-01-01T00:02:00.000Z', errorCode: 'late' })).toBe(false)
    expect(repos.taskDeliveryAttempts.listByRun('run-1', { limit: 1, offset: 0 }).attempts).toEqual([
      expect.objectContaining({ status: 'delivered', completedAt: '2026-01-01T00:01:00.000Z', errorCode: null })
    ])
  })

  it('preserves task run logs while deleting task definitions and channel subscriptions', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    repos.tasks.upsert({
      id: 'task-delete',
      agentId: agent.id,
      name: 'Delete Task',
      prompt: 'Run before delete',
      trigger: { kind: 'interval', ms: 60_000 },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: ['channel-1'],
      enabled: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.taskRunLogs.upsert({
      id: 'log-delete',
      scheduleId: 'task-delete',
      startedAt: '2026-01-02T00:00:00.000Z',
      durationMs: 10,
      status: 'completed',
      result: 'ok'
    })
    repos.channelTaskSubscriptions.replaceForTask('task-delete', ['channel-1'])

    repos.tasks.delete('task-delete')

    expect(repos.tasks.listAll()).toEqual([])
    expect(repos.taskRunLogs.list('task-delete').logs).toEqual([
      expect.objectContaining({ id: 'log-delete', scheduleId: 'task-delete' })
    ])
    expect(repos.channelTaskSubscriptions.listByTaskId('task-delete')).toEqual([])
  })

  it('rejects legacy Channel writes while preserving task-subscription storage', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const channels: AgentChannelEntity[] = [
      {
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram A',
        agentId: agent.id,
        sessionId: 'session-1',
        workspace: { type: 'user', workspaceId: workspace.id },
        config: { bot_token: 'token-a', allowed_chat_ids: ['chat-a'] },
        isActive: true,
        activeChatIds: ['chat-a'],
        permissionMode: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'channel-2',
        type: 'slack',
        name: 'Slack B',
        agentId: null,
        workspace: { type: 'system' },
        config: { bot_token: 'token-b', app_token: 'app-b', allowed_channel_ids: ['c-1'] },
        isActive: false,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    const subscriptions = [
      { channelId: 'channel-1', taskId: 'task-1' },
      { channelId: 'channel-2', taskId: 'task-2' }
    ]

    expect(() => repos.channels.replaceAll(channels)).toThrow('channel-legacy-write-rejected')
    repos.channelTaskSubscriptions.replaceAll(subscriptions)

    expect(repos.channels.listAll()).toEqual([])
    expect(repos.channels.list({ agentId: agent.id })).toEqual([])
    expect(repos.channels.list({ type: 'slack' })).toEqual([])
    expect(repos.channels.findBySessionId('session-1')).toBeNull()
    expect(repos.channelTaskSubscriptions.listAll()).toEqual(subscriptions)
    expect(repos.channelTaskSubscriptions.listByTaskId('task-1')).toEqual([{ channelId: 'channel-1', taskId: 'task-1' }])
    expect(repos.channelTaskSubscriptions.listByChannelId('channel-2')).toEqual([{ channelId: 'channel-2', taskId: 'task-2' }])
  })

  it('stores MCP servers, tools, and runtime status in row-level sqlite tables', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const servers: McpServerEntity[] = [
      {
        id: 'mcp-z',
        name: 'Zeta Server',
        type: 'stdio',
        command: 'zeta',
        args: ['--serve'],
        env: { ZETA_TOKEN: 'token' },
        disabledTools: ['write'],
        isActive: true,
        sortOrder: 2,
        installSource: 'manual',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'mcp-a',
        name: 'Alpha Server',
        type: 'sse',
        baseUrl: 'https://mcp.example.test/sse',
        headers: { Authorization: 'Bearer token' },
        isActive: false,
        sortOrder: 1,
        installSource: 'protocol',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const tools: McpToolsByServerId = {
      'mcp-z': [
        {
          id: 'read',
          name: 'read',
          description: 'Read data',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
        }
      ],
      'mcp-a': [{ id: 'search', name: 'search', description: 'Search data' }]
    }
    const statuses: Record<string, McpRuntimeStatus> = {
      'mcp-z': { state: 'connected', message: 'ready', lastCheckedAt: 11 },
      'mcp-a': { state: 'disabled', lastCheckedAt: 22 }
    }

    repos.mcpServers.replaceAll(servers)
    repos.mcpTools.replaceAll(tools)
    repos.mcpRuntimeStatus.replaceAll(statuses)

    expect(repos.mcpServers.listAll().map((server) => server.id)).toEqual(['mcp-a', 'mcp-z'])
    expect(repos.mcpTools.listAll()).toEqual(tools)
    expect(repos.mcpRuntimeStatus.listAll()).toEqual(statuses)

    repos.mcpTools.replaceForServer('mcp-z', [{ id: 'write', name: 'write' }])
    repos.mcpRuntimeStatus.set('mcp-z', { state: 'error', message: 'boom', lastCheckedAt: 33 })

    expect(repos.mcpTools.listAll()).toEqual({
      'mcp-a': tools['mcp-a'],
      'mcp-z': [{ id: 'write', name: 'write' }]
    })
    expect(repos.mcpRuntimeStatus.listAll()['mcp-z']).toEqual({
      state: 'error',
      message: 'boom',
      lastCheckedAt: 33
    })

    repos.mcpServers.delete('mcp-z')

    expect(repos.mcpServers.listAll().map((server) => server.id)).toEqual(['mcp-a'])
    expect(repos.mcpTools.listAll()).toEqual({ 'mcp-a': tools['mcp-a'] })
    expect(repos.mcpRuntimeStatus.listAll()).toEqual({ 'mcp-a': statuses['mcp-a'] })
  })

  it('rejects channel row-level writes without replacing the whole platform state', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const channel: AgentChannelEntity = {
      id: 'channel-1',
      type: 'telegram',
      name: 'Telegram A',
      agentId: agent.id,
      sessionId: 'session-1',
      workspace: { type: 'user', workspaceId: workspace.id },
      config: { bot_token: 'token-a' },
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    expect(() => repos.channels.upsert(channel)).toThrow('channel-legacy-write-rejected')
    expect(repos.channels.findBySessionId('session-1')).toBeNull()

    repos.channelTaskSubscriptions.replaceForTask('task-1', ['channel-1', 'channel-2'])
    repos.channelTaskSubscriptions.replaceForTask('task-1', ['channel-2'])

    expect(repos.channelTaskSubscriptions.listByTaskId('task-1')).toEqual([{ channelId: 'channel-2', taskId: 'task-1' }])

    expect(repos.channels.listAll().map((item) => item.id)).toEqual([])
    expect(repos.channelTaskSubscriptions.listByTaskId('task-1')).toEqual([{ channelId: 'channel-2', taskId: 'task-1' }])
  })

  it('rejects legacy Channel writes before task subscriptions can target them', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)
    const channel: AgentChannelEntity = {
      id: 'channel-delete',
      type: 'telegram',
      name: 'Delete Channel',
      agentId: agent.id,
      workspace: { type: 'system' },
      config: { bot_token: 'token' },
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(() => repos.channels.upsert(channel)).toThrow('channel-legacy-write-rejected')
    repos.tasks.upsert({
      id: 'task-channel-delete',
      agentId: agent.id,
      name: 'Channel Task',
      prompt: 'Run with channel',
      trigger: { kind: 'interval', ms: 60_000 },
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      channelIds: ['channel-delete', 'channel-keep'],
      enabled: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    repos.channelTaskSubscriptions.replaceForTask('task-channel-delete', ['channel-delete'])

    expect(repos.channels.listAll()).toEqual([])
    expect(repos.channelTaskSubscriptions.listByChannelId('channel-delete')).toEqual([
      { channelId: 'channel-delete', taskId: 'task-channel-delete' }
    ])
    expect(repos.tasks.listAll().find((task) => task.id === 'task-channel-delete')?.channelIds).toEqual([
      'channel-delete',
      'channel-keep'
    ])
  })

  it('stores active agent and session selection in a row-level sqlite table', () => {
    const db = createAgentPlatformDatabase(':memory:')
    const repos = createAgentPlatformRepositories(db)

    repos.activeSelection.set({ activeAgentId: agent.id, activeSessionId: 'session-1' })

    expect(repos.activeSelection.get()).toEqual({
      activeAgentId: agent.id,
      activeSessionId: 'session-1'
    })

    repos.activeSelection.set({ activeAgentId: null, activeSessionId: null })

    expect(repos.activeSelection.get()).toEqual({
      activeAgentId: null,
      activeSessionId: null
    })
  })
})
