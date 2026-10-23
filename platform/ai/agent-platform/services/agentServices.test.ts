import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../store/agentStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from './agentServices'

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
  name: 'Default Agent',
  description: 'General helper',
  instructions: 'You are helpful.',
  model: 'provider:model-a',
  modelName: 'model-a',
  mcps: [],
  disabledTools: [],
  configuration: { avatar: 'A', soul_enabled: true },
  orderKey: 'agent-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: agent.id,
  name: 'First Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
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

function messageFixture(index: number): AgentSessionMessageEntity {
  const suffix = String(index).padStart(3, '0')
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  return {
    id: `message-${suffix}`,
    sessionId: session.id,
    role: index % 2 === 0 ? 'assistant' : 'user',
    data: { parts: [{ type: 'text', text: `message ${suffix}` }] },
    searchableText: `message ${suffix}`,
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt,
    updatedAt: createdAt
  }
}

function channelFixture(): AgentChannelEntity {
  return {
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
}

function taskFixture(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: overrides.id ?? 'task-1',
    agentId: overrides.agentId ?? agent.id,
    name: overrides.name ?? 'Task',
    prompt: overrides.prompt ?? 'Run task',
    trigger: overrides.trigger ?? { kind: 'interval', ms: 5 * 60_000 },
    timeoutMinutes: overrides.timeoutMinutes ?? 2,
    workspace: overrides.workspace ?? { type: 'system' },
    channelIds: overrides.channelIds ?? [],
    enabled: overrides.enabled ?? true,
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...(overrides.catchUpPolicy !== undefined ? { catchUpPolicy: overrides.catchUpPolicy } : {}),
    ...(overrides.nextRun !== undefined ? { nextRun: overrides.nextRun } : {}),
    ...(overrides.lastRun !== undefined ? { lastRun: overrides.lastRun } : {})
  }
}

function taskRunLogFixture(overrides: Partial<TaskRunLogEntity> = {}): TaskRunLogEntity {
  return {
    id: overrides.id ?? 'task-run-1',
    scheduleId: overrides.scheduleId ?? 'task-1',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
    durationMs: overrides.durationMs ?? 10,
    status: overrides.status ?? 'completed',
    ...(overrides.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
    ...(overrides.result !== undefined ? { result: overrides.result } : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {})
  }
}

describe('agent platform services', () => {
  it('exposes agent CRUD through a store-backed service facade', async () => {
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] }))
    const services = createAgentPlatformServices(store)

    const created = await services.agents.create({
      type: 'claude-code',
      name: 'Research Agent',
      description: 'Checks sources',
      instructions: 'Stay precise.',
      model: 'provider:model-b',
      configuration: { avatar: 'R' }
    })
    const updated = await services.agents.update(created.id, { name: 'Renamed Agent' })
    const listed = await services.agents.list({ search: 'renamed' })
    const searched = await services.agents.search({ q: 'renamed', limit: 10 })
    const selectedState = await services.agents.select(created.id)
    await services.agents.reorder([created.id, agent.id])
    const reordered = await services.agents.list()

    expect(updated.name).toBe('Renamed Agent')
    expect(listed.agents.map((item) => item.id)).toContain(created.id)
    expect(searched[0]).toMatchObject({
      type: 'agent',
      id: created.id,
      title: 'Renamed Agent',
      emoji: 'R'
    })
    expect(selectedState.activeAgentId).toBe(created.id)
    expect(reordered.agents.map((item) => item.id)).toEqual([created.id, agent.id])

    await services.agents.delete(created.id)
    expect(await services.agents.get(created.id)).toBeNull()
  })

  it('marks agent selection as a focused active-selection persistence update', async () => {
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
    const services = createAgentPlatformServices(store)

    await services.agents.select(agent.id)

    expect(optionsSeen).toContainEqual({ activeSelectionRowOnly: true })
  })

  it('hydrates agent get/list/search from query adapters instead of scanning store order', async () => {
    const repoAgent: AgentEntity = {
      ...agent,
      id: 'agent-repo',
      name: 'Repo Agent',
      description: 'Repository-backed helper',
      configuration: { avatar: 'R' },
      orderKey: '0000',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const listCalls: Array<{
      search?: string
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: string
    }> = []
    const getCalls: string[] = []
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })),
      {
        queries: {
          agents: {
            get(id) {
              getCalls.push(id)
              return id === repoAgent.id ? repoAgent : null
            },
            list(options) {
              listCalls.push(options ?? {})
              return {
                agents: [repoAgent],
                total: 1
              }
            }
          }
        }
      }
    )

    const fetched = await services.agents.get(repoAgent.id)
    const page = await services.agents.list({
      search: 'repo',
      limit: 1,
      offset: 2,
      sortBy: 'updatedAt',
      sortOrder: 'desc'
    })
    const search = await services.agents.search({ q: 'repo', limit: 1, updatedAtFrom: Date.parse('2026-01-01T00:00:00.000Z') })

    expect(fetched?.id).toBe(repoAgent.id)
    expect(page.agents.map((item) => item.id)).toEqual([repoAgent.id])
    expect(page.total).toBe(1)
    expect(search).toEqual([
      {
        type: 'agent',
        id: repoAgent.id,
        title: 'Repo Agent',
        subtitle: 'Repository-backed helper',
        emoji: 'R',
        updatedAt: '2026-01-02T00:00:00.000Z',
        target: { agentId: repoAgent.id }
      }
    ])
    expect(getCalls).toEqual([repoAgent.id])
    expect(listCalls).toEqual([
      {
        search: 'repo',
        limit: 1,
        offset: 2,
        sortBy: 'updatedAt',
        sortOrder: 'desc'
      },
      {
        search: 'repo',
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: 1
      }
    ])
  })

  it('creates sessions, lists them by cursor, updates ownership, and cascades delete results', async () => {
    const store = createMemoryStateStore(createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] }))
    const services = createAgentPlatformServices(store)

    const first = await services.sessions.create({
      agentId: agent.id,
      name: 'Newest',
      workspace: { type: 'system' }
    })
    const second = await services.sessions.create({
      agentId: agent.id,
      name: 'Newer',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const pageOne = await services.sessions.listByCursor({ limit: 1 })
    const pageTwo = await services.sessions.listByCursor({ cursor: pageOne.nextCursor, limit: 10 })
    const updated = await services.sessions.update(second.id, { agentId: null, name: 'Detached' })
    const reboundWorkspace = await services.sessions.setWorkspace(second.id, { type: 'user', workspaceId: workspace.id })
    const pathWorkspace = await services.sessions.setWorkspaceByPath(second.id, '/tmp/next-workspace/')
    await services.sessions.togglePin(second.id)
    await services.sessions.reorderBatch([second.id, session.id, first.id])
    const deleted = await services.sessions.deleteByIds([first.id, 'missing'])
    const nextState = await services.state.getState()
    const pagedIds = [...pageOne.items, ...pageTwo.items].map((item) => item.id)

    expect(pageOne.items).toHaveLength(1)
    expect(pagedIds).toContain(first.id)
    expect(pagedIds).toContain(second.id)
    expect(updated.agentId).toBeNull()
    expect(reboundWorkspace.workspaceId).toBe(workspace.id)
    expect(pathWorkspace.workspace.path).toBe('/tmp/next-workspace')
    expect(nextState.sessionPins.map((item) => item.sessionId)).toEqual([second.id])
    expect(nextState.sessions.map((item) => item.id)).toEqual([second.id, session.id])
    expect(deleted.deletedIds).toEqual([first.id])
    expect(await services.sessions.exists(first.id)).toBe(false)
  })

  it('marks session pin toggle as a focused session-pin persistence update', async () => {
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
    const services = createAgentPlatformServices(store)

    await services.sessions.togglePin(session.id)

    expect(optionsSeen).toContainEqual({ sessionPinRowsOnly: true })
  })

  it('upserts messages, paginates newest-first, stores resume tokens, and resolves stale pending rows', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        [session.id]: [messageFixture(1), messageFixture(2), messageFixture(3)]
      }
    })
    const services = createAgentPlatformServices(createMemoryStateStore(state))

    const saved = await services.messages.saveMessage({
      sessionId: session.id,
      runtimeResumeToken: 'resume-token',
      message: {
        id: 'message-new',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'new answer' }] },
        status: 'pending'
      }
    })
    const pageOne = await services.messages.listSessionMessages(session.id, { limit: 2 })
    const pageTwo = await services.messages.listSessionMessages(session.id, { cursor: pageOne.nextCursor, limit: 10 })
    const pendingIds = await services.messages.findPendingAssistantMessageIds()

    expect(saved.runtimeResumeToken).toBe('resume-token')
    expect(pageOne.items.map((item) => item.id)).toEqual(['message-new', 'message-003'])
    expect(pageTwo.items.map((item) => item.id)).toEqual(['message-002', 'message-001'])
    expect(pendingIds).toEqual(['message-new'])

    await services.messages.markMessagesError(pendingIds)
    const resolved = (await services.messages.listSessionMessages(session.id, { limit: 1 })).items[0]
    expect(resolved.status).toBe('error')

    await services.messages.deleteSessionMessage(session.id, saved.id)
    expect((await services.messages.listSessionMessages(session.id, { limit: 10 })).items.map((item) => item.id)).not.toContain(saved.id)

    await services.messages.clearSessionMessages(session.id)
    expect((await services.messages.listSessionMessages(session.id, { limit: 10 })).items).toEqual([])
  })

  it('hydrates session pages from query adapters instead of scanning store state order', async () => {
    const secondSession: AgentSessionEntity = {
      ...session,
      id: 'session-2',
      name: 'Second Session',
      orderKey: 'session-2',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        sessions: [session, secondSession],
        workspaces: [workspace]
      })
    )
    const calls: Array<{ limit?: number; cursor?: string }> = []
    const services = createAgentPlatformServices(store, {
      queries: {
        sessions: {
          listByCursor(query) {
            calls.push({ limit: query?.limit, cursor: query?.cursor })
            return {
              items: [{ id: secondSession.id }, { id: session.id }],
              nextCursor: 'repo-session-cursor'
            }
          }
        }
      }
    })

    const page = await services.sessions.listByCursor({ limit: 2, cursor: 'input-session-cursor' })

    expect(page.items.map((item) => item.id)).toEqual([secondSession.id, session.id])
    expect(page.nextCursor).toBe('repo-session-cursor')
    expect(calls).toEqual([{ limit: 2, cursor: 'input-session-cursor' }])
  })

  it('preserves pinned-first session order when hydrating repository-backed session pages', async () => {
    const secondSession: AgentSessionEntity = {
      ...session,
      id: 'session-2',
      name: 'Second Session',
      orderKey: 'session-2',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const thirdSession: AgentSessionEntity = {
      ...session,
      id: 'session-3',
      name: 'Third Session',
      orderKey: 'session-3',
      updatedAt: '2026-01-03T00:00:00.000Z'
    }
    const store = createMemoryStateStore(
      createAgentStoreState({
        agents: [agent],
        sessions: [session, secondSession, thirdSession],
        workspaces: [workspace],
        sessionPins: [{ id: 'pin-1', sessionId: thirdSession.id, createdAt: '2026-01-03T00:00:00.000Z' }]
      })
    )
    const services = createAgentPlatformServices(store, {
      queries: {
        sessions: {
          listByCursor() {
            return {
              items: [{ id: thirdSession.id }, { id: session.id }, { id: secondSession.id }]
            }
          }
        }
      }
    })

    const page = await services.sessions.listByCursor({ limit: 10 })

    expect(page.items.map((item) => item.id)).toEqual([thirdSession.id, session.id, secondSession.id])
  })

  it('hydrates message pages and search results from query adapters instead of full state scans', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        [session.id]: [messageFixture(1), messageFixture(2), messageFixture(3)]
      }
    })
    const listCalls: Array<{ sessionId: string; limit?: number; cursor?: string }> = []
    const searchCalls: Array<{
      q: string
      limit?: number
      cursor?: string
      createdAtFrom?: string
      sessionId?: string
    }> = []
    const services = createAgentPlatformServices(createMemoryStateStore(state), {
      queries: {
        messages: {
          listByCursor(sessionId, query) {
            listCalls.push({ sessionId, limit: query?.limit, cursor: query?.cursor })
            return {
              items: [{ id: 'message-002' }, { id: 'message-001' }],
              nextCursor: 'repo-message-cursor'
            }
          },
          search(query) {
            searchCalls.push(query)
            return {
              items: [
                {
                  messageId: 'message-003',
                  sessionId: session.id,
                  role: 'assistant',
                  snippet: 'repo snippet',
                  createdAt: '2026-01-01T00:00:03.000Z'
                }
              ],
              nextCursor: 'repo-search-cursor'
            }
          }
        }
      }
    })

    const page = await services.messages.listSessionMessages(session.id, {
      limit: 2,
      cursor: 'input-message-cursor'
    })
    const search = await services.messages.search({
      q: 'message',
      limit: 1,
      cursor: 'input-search-cursor',
      createdAtFrom: '2026-01-01T00:00:00.000Z',
      sessionId: session.id
    })

    expect(page.items.map((item) => item.id)).toEqual(['message-002', 'message-001'])
    expect(page.nextCursor).toBe('repo-message-cursor')
    expect(listCalls).toEqual([{ sessionId: session.id, limit: 2, cursor: 'input-message-cursor' }])

    expect(search.items).toEqual([
      {
        messageId: 'message-003',
        sessionId: session.id,
        sessionName: session.name,
        agentId: agent.id,
        agentName: agent.name,
        role: 'assistant',
        snippet: 'repo snippet',
        createdAt: '2026-01-01T00:00:03.000Z'
      }
    ])
    expect(search.nextCursor).toBe('repo-search-cursor')
    expect(searchCalls).toEqual([
      {
        q: 'message',
        limit: 1,
        cursor: 'input-search-cursor',
        createdAtFrom: '2026-01-01T00:00:00.000Z',
        sessionId: session.id
      }
    ])
  })

  it('keeps workspace find-or-create idempotent and cascades workspace deletion through sessions and messages', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: { [session.id]: [messageFixture(1)] }
    })
    const services = createAgentPlatformServices(createMemoryStateStore(state))

    const result = await services.workspaces.findOrCreateByPathResult('/tmp/workspace/', { name: 'Renamed on create only' })
    const updated = await services.workspaces.update(workspace.id, { name: 'Renamed Workspace' })
    const listed = await services.workspaces.list()

    expect(result.created).toBe(false)
    expect(result.workspace.name).toBe('Workspace')
    expect(updated.name).toBe('Renamed Workspace')
    expect(listed.map((item) => item.id)).toContain(workspace.id)

    await services.workspaces.deleteCascade(workspace.id)
    const nextState = await services.state.getState()
    expect(nextState.sessions).toEqual([])
    expect(nextState.messagesBySessionId[session.id]).toBeUndefined()
  })

  it('hydrates workspace list/get/path lookup from query adapters when available', async () => {
    const repoWorkspace: AgentWorkspaceEntity = {
      ...workspace,
      id: 'workspace-repo',
      name: 'Repo Workspace',
      path: '/tmp/repo-workspace',
      orderKey: '0000'
    }
    const listCalls: Array<{ includeSystem?: boolean }> = []
    const getCalls: Array<{ id: string; includeSystem?: boolean }> = []
    const pathCalls: string[] = []
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] })),
      {
        queries: {
          workspaces: {
            list(options) {
              listCalls.push(options ?? {})
              return [repoWorkspace]
            },
            getById(id, options) {
              getCalls.push({ id, includeSystem: options?.includeSystem })
              return id === repoWorkspace.id ? repoWorkspace : null
            },
            findByPath(path) {
              pathCalls.push(path)
              return path === repoWorkspace.path ? repoWorkspace : null
            }
          }
        }
      }
    )

    const listed = await services.workspaces.list({ includeSystem: true })
    const fetched = await services.workspaces.getById(repoWorkspace.id, { includeSystem: true })
    const result = await services.workspaces.findOrCreateByPathResult('/tmp/repo-workspace/')

    expect(listed.map((item) => item.id)).toEqual([repoWorkspace.id])
    expect(fetched.id).toBe(repoWorkspace.id)
    expect(result).toEqual({ workspace: repoWorkspace, created: false })
    expect(listCalls).toEqual([{ includeSystem: true }])
    expect(getCalls).toEqual([{ id: repoWorkspace.id, includeSystem: true }])
    expect(pathCalls).toEqual(['/tmp/repo-workspace'])
  })

  it('keeps the session service workspace cascade aligned with the store by deleting the workspace row too', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: { [session.id]: [messageFixture(1)] }
    })
    const services = createAgentPlatformServices(createMemoryStateStore(state))

    await services.sessions.deleteWorkspaceCascade(workspace.id)

    const nextState = await services.state.getState()
    expect(nextState.workspaces.some((item) => item.id === workspace.id)).toBe(false)
    expect(nextState.sessions).toEqual([])
    expect(nextState.messagesBySessionId[session.id]).toBeUndefined()
  })

  it('manages channels, task subscriptions, autonomous task checks, and task run logs', async () => {
    const seededChannel = channelFixture()
    const state = createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace], channels: [seededChannel] })
    const services = createAgentPlatformServices(createMemoryStateStore(state))

    const task = await services.tasks.create(agent.id, {
      name: 'Heartbeat',
      prompt: 'Check status',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' },
      channelIds: [seededChannel.id]
    })
    await services.channels.subscribeToTask(seededChannel.id, task.id)
    await services.tasks.addRunLog({
      id: 'run-1',
      scheduleId: task.id,
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 20,
      status: 'completed',
      result: 'ok'
    })
    const taskList = await services.tasks.list(agent.id)
    const subscribedChannels = await services.channels.getSubscribedChannels(task.id)
    const logs = await services.tasks.getLogs(agent.id, task.id)

    expect(taskList.tasks.map((item) => item.id)).toEqual([task.id])
    expect(subscribedChannels.map((item) => item.id)).toEqual([seededChannel.id])
    expect(logs.logs.map((item) => item.id)).toEqual(['run-1'])

    await services.channels.delete(seededChannel.id)
    const afterChannelDelete = await services.state.getState()
    expect(afterChannelDelete.channelTaskSubscriptions).toEqual([])
    expect(afterChannelDelete.tasks[0].channelIds).toEqual([])
  })

  it('hydrates task lists and run logs from query adapters instead of scanning store state', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [taskFixture({ id: 'task-store-1', name: 'Store task' })],
      taskRunLogs: [taskRunLogFixture({ id: 'log-store-1', scheduleId: 'task-store-1' })]
    })
    const listCalls: Array<{ agentId: string; limit?: number; offset?: number; includeHeartbeat?: boolean }> = []
    const logCalls: Array<{ taskId: string; limit?: number; offset?: number }> = []
    const repoTask = taskFixture({
      id: 'task-repo-1',
      name: 'Repo task',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    const repoLog = taskRunLogFixture({
      id: 'log-repo-1',
      scheduleId: 'task-repo-1',
      startedAt: '2026-01-02T00:00:00.000Z',
      result: 'repo result',
      error: null,
      sessionId: null
    })
    const services = createAgentPlatformServices(createMemoryStateStore(state), {
      queries: {
        tasks: {
          get(taskId) {
            return taskId === repoTask.id ? repoTask : null
          },
          list(agentId, options) {
            listCalls.push({ agentId, ...options })
            return {
              tasks: [repoTask],
              total: 1
            }
          },
          listLogs(taskId, options) {
            logCalls.push({ taskId, ...options })
            return {
              logs: [repoLog],
              total: 1
            }
          }
        }
      }
    })

    const taskPage = await services.tasks.list(agent.id, { limit: 1, offset: 2, includeHeartbeat: true })
    const logPage = await services.tasks.getLogs(agent.id, 'task-repo-1', { limit: 5, offset: 1 })

    expect(taskPage).toEqual({ tasks: [repoTask], total: 1 })
    expect(logPage).toEqual({ logs: [repoLog], total: 1 })
    expect(listCalls).toEqual([{ agentId: agent.id, limit: 1, offset: 2, includeHeartbeat: true }])
    expect(logCalls).toEqual([{ taskId: 'task-repo-1', limit: 5, offset: 1 }])
  })

  it('writes task run logs through the repository adapter when available', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    })
    const upsertLog = vi.fn()
    const services = createAgentPlatformServices(createMemoryStateStore(state), {
      queries: {
        tasks: {
          list: () => ({ tasks: [], total: 0 }),
          listLogs: () => ({ logs: [], total: 0 }),
          upsertLog
        }
      }
    })
    const log = taskRunLogFixture({ id: 'log-write-1', scheduleId: 'task-1', result: 'ok', error: null, sessionId: null })

    await services.tasks.addRunLog(log)

    expect(upsertLog).toHaveBeenCalledWith(log)
    expect((await services.state.getState()).taskRunLogs[0]).toEqual(log)
  })

  it('marks task mutations as focused task persistence updates', async () => {
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
    const services = createAgentPlatformServices(store)

    const task = await services.tasks.create(agent.id, {
      name: 'Focused Task',
      prompt: 'Run focused task',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      workspace: { type: 'system' }
    })
    await services.tasks.update(agent.id, task.id, { expectedRevision: task.revision ?? 1, patch: { name: 'Focused Task Updated' } })
    await services.tasks.addRunLog(taskRunLogFixture({ id: 'run-focused', scheduleId: task.id }))
    await services.tasks.delete(agent.id, task.id, { expectedRevision: 2 })

    expect(optionsSeen).toContainEqual({ taskRowsOnly: true })
    expect(optionsSeen).toContainEqual({ taskRunLogRowsOnly: true })
    expect(optionsSeen.filter((options) => JSON.stringify(options) === JSON.stringify({ taskRowsOnly: true }))).toHaveLength(3)
  })

  it('routes compatibility task mutations through automation commands and materializes the default timezone', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })),
      { taskAutomation: { defaultTimezone: 'Asia/Shanghai' } }
    )

    const created = await services.tasks.create(agent.id, {
      name: 'Daily review',
      prompt: 'Review {task_name}',
      trigger: { kind: 'cron', expr: '0 9 * * *' },
      workspace: { type: 'system' }
    })
    const updated = await services.tasks.update(agent.id, created.id, {
      expectedRevision: created.revision ?? 1,
      patch: { name: 'Updated review' }
    })

    expect(created.trigger).toEqual({ kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' })
    expect(updated).toMatchObject({ name: 'Updated review', revision: 2 })
  })

  it('applies the current platform task automation preset to future create and update commands', async () => {
    let policyPreset: 'balanced' | 'conservative' = 'balanced'
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ agents: [agent], workspaces: [workspace] })),
      { taskAutomation: { getPolicyPreset: async () => policyPreset } }
    )
    const created = await services.tasks.create(agent.id, {
      name: 'Balanced task',
      prompt: 'Run',
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      timeoutMinutes: 31,
      workspace: { type: 'system' }
    })
    policyPreset = 'conservative'

    await expect(services.tasks.update(agent.id, created.id, {
      expectedRevision: created.revision ?? 1,
      patch: { name: 'Cannot retain over-limit timeout' }
    })).rejects.toMatchObject({
      code: 'task-policy-limit'
    })
    await expect(
      services.tasks.create(agent.id, {
        name: 'Too frequent',
        prompt: 'Run',
        trigger: { kind: 'interval', ms: 5 * 60_000 },
        workspace: { type: 'system' }
      })
    ).rejects.toMatchObject({ code: 'task-policy-limit' })
  })

  it('hydrates channel queries from repository adapters instead of scanning store state', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      channels: [channelFixture()]
    })
    const repoChannel: AgentChannelEntity = {
      ...channelFixture(),
      id: 'channel-repo-1',
      name: 'Repo Channel',
      sessionId: 'session-1',
      activeChatIds: ['chat-1']
    }
    const listCalls: Array<{ agentId?: string; type?: AgentChannelEntity['type'] }> = []
    const sessionCalls: string[] = []
    const subscribedTaskCalls: string[] = []
    const subscribedChannelCalls: string[] = []
    const services = createAgentPlatformServices(createMemoryStateStore(state), {
      queries: {
        channels: {
          list(query) {
            listCalls.push({ agentId: query?.agentId, type: query?.type })
            return [repoChannel]
          },
          findBySessionId(sessionId) {
            sessionCalls.push(sessionId)
            return repoChannel
          },
          listByTaskId(taskId) {
            subscribedTaskCalls.push(taskId)
            return [repoChannel]
          },
          listTaskIdsByChannelId(channelId) {
            subscribedChannelCalls.push(channelId)
            return ['task-repo-1']
          }
        }
      }
    })

    await expect(services.channels.list({ agentId: agent.id })).resolves.toEqual([repoChannel])
    await expect(services.channels.findBySessionId('session-1')).resolves.toEqual(repoChannel)
    await expect(services.channels.getSubscribedChannels('task-repo-1')).resolves.toEqual([repoChannel])
    await expect(services.channels.getSubscribedTasks('channel-repo-1')).resolves.toEqual(['task-repo-1'])
    expect(listCalls).toEqual([{ agentId: agent.id, type: undefined }])
    expect(sessionCalls).toEqual(['session-1'])
    expect(subscribedTaskCalls).toEqual(['task-repo-1'])
    expect(subscribedChannelCalls).toEqual(['channel-repo-1'])
  })

  it('rejects legacy Channel mutations even when repository adapters are available', async () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [taskFixture({ id: 'task-1', channelIds: [] })]
    })
    const upsertChannel = vi.fn()
    const deleteChannel = vi.fn()
    const services = createAgentPlatformServices(createMemoryStateStore(state), {
      queries: {
        channels: {
          list: () => [],
          findBySessionId: () => null,
          listByTaskId: () => [],
          listTaskIdsByChannelId: () => [],
          upsert: upsertChannel,
          delete: deleteChannel
        }
      }
    })
    const channel = channelFixture()

    await expect(services.channels.create(channel)).rejects.toThrow('channel-legacy-write-rejected')
    await expect(services.channels.update(channel.id, { activeChatIds: ['chat-1'] })).rejects.toThrow('channel-legacy-write-rejected')
    expect(upsertChannel).not.toHaveBeenCalled()
    expect(deleteChannel).not.toHaveBeenCalled()
  })

  it('rejects focused legacy Channel persistence mutations', async () => {
    const optionsSeen: unknown[] = []
    let state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      tasks: [taskFixture({ id: 'task-1', channelIds: [] })]
    })
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
    const services = createAgentPlatformServices(store)
    await expect(services.channels.create(channelFixture())).rejects.toThrow('channel-legacy-write-rejected')
    await expect(services.channels.update('channel-1', { activeChatIds: ['chat-1'] })).rejects.toThrow('channel-legacy-write-rejected')
    expect(optionsSeen).toEqual([])
  })
})
