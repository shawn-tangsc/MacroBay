import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import { DEFAULT_SYSTEM_WORKSPACE_PATH, type AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import {
  addAgentSessionMessage,
  clearAgentSessionMessages,
  createAgent,
  createAgentSession,
  createAgentStoreState,
  deleteAgent,
  deleteAgentSession,
  deleteAgentSessionMessage,
  deleteAgentSessions,
  deleteAgentSessionsByAgent,
  deleteAgentWorkspace,
  listAgentSessions,
  listAgentSessionMessages,
  mergeAgentRuntimeSessionState,
  reorderAgentSessions,
  reconcileStalePendingMessages,
  selectAgent,
  selectAgentSession,
  toggleSessionPin,
  updateAgentSessionAgent,
  updateAgentSessionWorkspace,
  updateAgent,
  updateAgentSession,
  updateAgentWorkspace,
  upsertAgentWorkspace
} from './agentStore'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const agents: AgentEntity[] = [
  {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent One',
    model: 'provider:model-a',
    modelName: 'Model A',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    orderKey: 'a',
    configuration: { avatar: 'A' }
  },
  {
    id: 'agent-2',
    type: 'claude-code',
    name: 'Agent Two',
    model: 'provider:model-b',
    modelName: 'Model B',
    createdAt: '2026-01-01T00:01:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    orderKey: 'b',
    configuration: { avatar: 'B' }
  }
]

const sessions: AgentSessionEntity[] = [
  {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'First session',
    workspaceId: workspace.id,
    workspace,
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'session-2',
    agentId: 'agent-2',
    name: 'Second session',
    workspaceId: workspace.id,
    workspace,
    orderKey: 'b',
    createdAt: '2026-01-01T00:01:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z'
  }
]

function messageFixture(index: number, sessionId = 'session-1'): AgentSessionMessageEntity {
  const suffix = String(index).padStart(3, '0')
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  return {
    id: `message-${suffix}`,
    sessionId,
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

function sessionFixture(index: number, agentId = 'agent-1'): AgentSessionEntity {
  const suffix = String(index).padStart(3, '0')
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString()
  return {
    id: `session-${suffix}`,
    agentId,
    name: `Session ${suffix}`,
    workspaceId: workspace.id,
    workspace,
    orderKey: suffix,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

describe('agent store', () => {
  it('initializes active agent and session from the first session', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })

    expect(state.activeSessionId).toBe('session-1')
    expect(state.activeAgentId).toBe('agent-1')
  })

  it('selects the owning agent when a session is selected', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = selectAgentSession(state, 'session-2')

    expect(next.activeSessionId).toBe('session-2')
    expect(next.activeAgentId).toBe('agent-2')
  })

  it('selects the first session owned by an agent', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = selectAgent(state, 'agent-2')

    expect(next.activeAgentId).toBe('agent-2')
    expect(next.activeSessionId).toBe('session-2')
  })

  it('clears the active session when selecting an agent without sessions', () => {
    const agentWithoutSessions: AgentEntity = {
      id: 'agent-3',
      type: 'claude-code',
      name: 'Agent Three',
      model: 'provider:model-c',
      modelName: 'Model C',
      createdAt: '2026-01-01T00:02:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
      orderKey: 'c'
    }
    const state = selectAgentSession(
      createAgentStoreState({ agents: [...agents, agentWithoutSessions], sessions, workspaces: [workspace] }),
      'session-2'
    )
    const next = selectAgent(state, 'agent-3')

    expect(next.activeAgentId).toBe('agent-3')
    expect(next.activeSessionId).toBeNull()
  })

  it('creates agents and sessions with stable active pointers', () => {
    const state = createAgentStoreState({ agents: [], sessions: [], workspaces: [workspace] })
    const withAgent = createAgent(state, {
      type: 'claude-code',
      name: 'New agent',
      model: 'provider:model-c'
    })
    const createdAgent = withAgent.agents[0]
    const withSession = createAgentSession(withAgent, {
      agentId: createdAgent.id,
      name: 'New session',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(withAgent.activeAgentId).toBe(createdAgent.id)
    expect(withSession.sessions[0].agentId).toBe(createdAgent.id)
    expect(withSession.activeSessionId).toBe(withSession.sessions[0].id)
  })

  it('normalizes the session-scoped tool allowlist and defaults it to empty', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const withAllowlist = createAgentSession(state, {
      agentId: 'agent-1',
      name: 'Brief session',
      workspace: { type: 'system' },
      allowedTools: [' WebSearch ', 'WebSearch', 'NotATool', 'WebFetch', '']
    })
    const withoutAllowlist = createAgentSession(state, {
      agentId: 'agent-1',
      name: 'Plain session',
      workspace: { type: 'system' }
    })

    expect(withAllowlist.sessions[0].allowedTools).toEqual(['WebSearch', 'WebFetch'])
    expect(withoutAllowlist.sessions[0].allowedTools).toEqual([])
  })

  it('keeps the session allowlist when the session is renamed or re-bound', () => {
    const state = createAgentStoreState({
      agents,
      sessions: [{ ...sessions[0], allowedTools: ['WebSearch'] }],
      workspaces: [workspace]
    })
    const renamed = updateAgentSession(state, 'session-1', { name: 'Renamed session' })
    const rebound = updateAgentSessionAgent(renamed, 'session-1', 'agent-2')

    expect(renamed.sessions[0].allowedTools).toEqual(['WebSearch'])
    expect(rebound.sessions[0].allowedTools).toEqual(['WebSearch'])
  })

  it('creates default sessions with a dedicated system workspace ', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = createAgentSession(state, {
      agentId: 'agent-1',
      name: 'System session',
      workspace: { type: 'system' }
    })
    const createdSession = next.sessions[0]

    expect(createdSession.name).toBe('System session')
    expect(createdSession.workspace.type).toBe('system')
    expect(createdSession.workspace.path).toBe(DEFAULT_SYSTEM_WORKSPACE_PATH)
    expect(next.workspaces.some((item) => item.id === createdSession.workspaceId && item.type === 'system')).toBe(true)
    expect(next.activeSessionId).toBe(createdSession.id)
  })

  it('normalizes legacy blank system workspaces before binding a session', () => {
    const legacySystemWorkspace: AgentWorkspaceEntity = {
      id: 'legacy-system-workspace',
      name: 'Default Workspace',
      path: '',
      type: 'system',
      orderKey: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace, legacySystemWorkspace] })
    const next = createAgentSession(state, {
      agentId: 'agent-1',
      name: 'System session',
      workspace: { type: 'system' }
    })
    const createdSession = next.sessions[0]

    expect(createdSession.workspace.path).toBe(DEFAULT_SYSTEM_WORKSPACE_PATH)
    expect(next.workspaces.find((item) => item.id === legacySystemWorkspace.id)?.path).toBe(
      DEFAULT_SYSTEM_WORKSPACE_PATH
    )
  })

  it('inserts newly-created sessions at the first position', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = createAgentSession(state, {
      agentId: 'agent-1',
      name: 'Newest session',
      workspace: { type: 'system' }
    })

    expect(next.sessions[0].name).toBe('Newest session')
  })

  it('updates agents and sessions without replacing unrelated records', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const updatedAgent = updateAgent(state, 'agent-1', { name: 'Renamed agent' })
    const updatedSession = updateAgentSession(updatedAgent, 'session-1', { name: 'Renamed session' })

    expect(updatedSession.agents.find((agent) => agent.id === 'agent-1')?.name).toBe('Renamed agent')
    expect(updatedSession.agents.find((agent) => agent.id === 'agent-2')?.name).toBe('Agent Two')
    expect(updatedSession.sessions.find((session) => session.id === 'session-1')?.name).toBe('Renamed session')
  })

  it('upserts user workspaces and switches the active session workspace', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const withWorkspace = upsertAgentWorkspace(state, {
      path: '/Users/example/project',
      name: 'Project'
    })
    const createdWorkspace = withWorkspace.workspaces.find((item) => item.path === '/Users/example/project')
    const next = updateAgentSessionWorkspace(withWorkspace, 'session-1', {
      type: 'user',
      workspaceId: createdWorkspace?.id ?? ''
    })

    expect(createdWorkspace?.type).toBe('user')
    expect(next.sessions.find((session) => session.id === 'session-1')?.workspace.path).toBe('/Users/example/project')
    expect(next.sessions.find((session) => session.id === 'session-1')?.workspaceId).toBe(createdWorkspace?.id)
  })

  it('renames a workspace and updates embedded session workspace snapshots', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = updateAgentWorkspace(state, workspace.id, { name: 'Renamed workspace' })

    expect(next.workspaces.find((item) => item.id === workspace.id)?.name).toBe('Renamed workspace')
    expect(next.sessions.find((session) => session.id === 'session-1')?.workspace.name).toBe('Renamed workspace')
  })

  it('deletes a workspace and cascades sessions, messages, and pins', () => {
    const state = toggleSessionPin(
      addAgentSessionMessage(
        createAgentStoreState({ agents, sessions, workspaces: [workspace] }),
        'session-1',
        {
          role: 'user',
          data: { parts: [{ type: 'text', text: 'workspace-scoped' }] }
        }
      ),
      'session-1'
    )
    const next = deleteAgentWorkspace(state, workspace.id)

    expect(next.workspaces.some((item) => item.id === workspace.id)).toBe(false)
    expect(next.sessions).toHaveLength(0)
    expect(next.messagesBySessionId['session-1']).toBeUndefined()
    expect(next.sessionPins).toHaveLength(0)
    expect(next.activeSessionId).toBeNull()
  })

  it('switches the agent attached to a session without replacing the session', () => {
    const state = selectAgentSession(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'session-1')
    const next = updateAgentSessionAgent(state, 'session-1', 'agent-2')

    expect(next.sessions.find((session) => session.id === 'session-1')?.agentId).toBe('agent-2')
    expect(next.activeAgentId).toBe('agent-2')
    expect(next.activeSessionId).toBe('session-1')
  })

  it('moves active session after deleting the selected session', () => {
    const state = selectAgentSession(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'session-2')
    const next = deleteAgentSession(state, 'session-2')

    expect(next.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(next.activeSessionId).toBe('session-1')
    expect(next.activeAgentId).toBe('agent-1')
  })

  it('deletes multiple sessions and their messages and pins', () => {
    const state = toggleSessionPin(
      addAgentSessionMessage(
        createAgentStoreState({ agents, sessions, workspaces: [workspace] }),
        'session-2',
        {
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Delete me' }] }
        }
      ),
      'session-2'
    )
    const next = deleteAgentSessions(state, ['session-2', 'missing-session'])

    expect(next.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(next.messagesBySessionId['session-2']).toBeUndefined()
    expect(next.sessionPins.some((pin) => pin.sessionId === 'session-2')).toBe(false)
  })

  it('deletes sessions owned by an agent', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = deleteAgentSessionsByAgent(state, 'agent-2')

    expect(next.sessions.map((session) => session.id)).toEqual(['session-1'])
    expect(next.activeSessionId).toBe('session-1')
    expect(next.activeAgentId).toBe('agent-1')
  })

  it('moves active pointers away from orphan sessions when deleting an active agent', () => {
    const state = selectAgent(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'agent-2')
    const next = deleteAgent(state, 'agent-2')

    expect(next.agents.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(next.activeAgentId).toBe('agent-1')
    expect(next.activeSessionId).toBe('session-1')
  })

  it('pins sessions and sorts pinned items first', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const next = toggleSessionPin(state, 'session-2')

    expect(next.sessionPins.map((pin) => pin.sessionId)).toEqual(['session-2'])
    expect(next.sessions.map((session) => session.id)).toEqual(['session-2', 'session-1'])
  })

  it('reorders sessions while keeping pins first', () => {
    const state = toggleSessionPin(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'session-1')
    const next = reorderAgentSessions(state, ['session-2', 'session-1'])

    expect(next.sessions.map((session) => session.id)).toEqual(['session-1', 'session-2'])
    expect(next.sessions.find((session) => session.id === 'session-2')?.orderKey).toBe('0000')
  })

  it('lists sessions with orderKey cursor pages', () => {
    const state = createAgentStoreState({
      agents,
      sessions: [1, 2, 3, 4, 5, 6].map((index) => sessionFixture(index)),
      workspaces: [workspace]
    })

    const firstPage = listAgentSessions(state, { limit: 2 })
    const secondPage = listAgentSessions(state, { limit: 2, cursor: firstPage.nextCursor })
    const thirdPage = listAgentSessions(state, { limit: 2, cursor: secondPage.nextCursor })

    expect(firstPage.items.map((session) => session.id)).toEqual(['session-001', 'session-002'])
    expect(firstPage.nextCursor).toBe('002:session-002')
    expect(secondPage.items.map((session) => session.id)).toEqual(['session-003', 'session-004'])
    expect(secondPage.nextCursor).toBe('004:session-004')
    expect(thirdPage.items.map((session) => session.id)).toEqual(['session-005', 'session-006'])
    expect(thirdPage.nextCursor).toBeUndefined()
  })

  it('lists pinned sessions before unpinned sessions across cursor pages', () => {
    const state = createAgentStoreState({
      agents,
      sessions: [1, 2, 3, 4].map((index) => sessionFixture(index)),
      workspaces: [workspace],
      sessionPins: [
        { id: 'pin-1', sessionId: 'session-003', createdAt: '2026-01-01T00:00:03.000Z' },
        { id: 'pin-2', sessionId: 'session-001', createdAt: '2026-01-01T00:00:01.000Z' }
      ]
    })

    const firstPage = listAgentSessions(state, { limit: 2 })
    const secondPage = listAgentSessions(state, { limit: 2, cursor: firstPage.nextCursor })

    expect(firstPage.items.map((session) => session.id)).toEqual(['session-003', 'session-001'])
    expect(secondPage.items.map((session) => session.id)).toEqual(['session-002', 'session-004'])
  })

  it('filters session cursor pages by agent and falls back on malformed cursors', () => {
    const state = createAgentStoreState({
      agents,
      sessions: [
        sessionFixture(1, 'agent-1'),
        sessionFixture(2, 'agent-2'),
        sessionFixture(3, 'agent-1'),
        sessionFixture(4, 'agent-2')
      ],
      workspaces: [workspace]
    })

    const filtered = listAgentSessions(state, { agentId: 'agent-2', limit: 1 })
    const malformedCursor = listAgentSessions(state, { agentId: 'agent-2', limit: 1, cursor: 'bad-cursor' })

    expect(filtered.items.map((session) => session.id)).toEqual(['session-002'])
    expect(filtered.nextCursor).toBe('002:session-002')
    expect(malformedCursor.items.map((session) => session.id)).toEqual(['session-002'])
  })

  it('appends pending and success messages to a session', () => {
    const state = createAgentStoreState({ agents, sessions, workspaces: [workspace] })
    const withUser = addAgentSessionMessage(state, 'session-1', {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Hello' }] }
    })
    const withAssistant = addAgentSessionMessage(withUser, 'session-1', {
      role: 'assistant',
      status: 'pending',
      data: { parts: [{ type: 'text', text: 'Thinking...' }] }
    })

    expect(withAssistant.messagesBySessionId['session-1']).toHaveLength(2)
    expect(withAssistant.messagesBySessionId['session-1'][1].status).toBe('pending')
  })

  it('deletes one session message without deleting the session', () => {
    const state = addAgentSessionMessage(
      createAgentStoreState({ agents, sessions, workspaces: [workspace] }),
      'session-1',
      {
        id: 'message-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'remove me' }] }
      }
    )
    const next = deleteAgentSessionMessage(state, 'session-1', 'message-1')

    expect(next.sessions.find((session) => session.id === 'session-1')).toBeTruthy()
    expect(next.messagesBySessionId['session-1']).toEqual([])
  })

  it('clears all messages for a session', () => {
    const state = addAgentSessionMessage(
      addAgentSessionMessage(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'session-1', {
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }),
      'session-1',
      {
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'world' }] }
      }
    )
    const next = clearAgentSessionMessages(state, 'session-1')

    expect(next.messagesBySessionId['session-1']).toEqual([])
  })

  it('lists session messages with newest-first cursor pages', () => {
    const state = createAgentStoreState({
      agents,
      sessions,
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [1, 2, 3, 4, 5, 6].map((index) => messageFixture(index))
      }
    })

    const firstPage = listAgentSessionMessages(state, 'session-1', { limit: 2 })
    const secondPage = listAgentSessionMessages(state, 'session-1', { limit: 2, cursor: firstPage.nextCursor })
    const thirdPage = listAgentSessionMessages(state, 'session-1', { limit: 2, cursor: secondPage.nextCursor })

    expect(firstPage.items.map((message) => message.id)).toEqual(['message-006', 'message-005'])
    expect(firstPage.nextCursor).toBe(`${Date.parse(messageFixture(5).createdAt)}:message-005`)
    expect(secondPage.items.map((message) => message.id)).toEqual(['message-004', 'message-003'])
    expect(secondPage.nextCursor).toBe(`${Date.parse(messageFixture(3).createdAt)}:message-003`)
    expect(thirdPage.items.map((message) => message.id)).toEqual(['message-002', 'message-001'])
    expect(thirdPage.nextCursor).toBeUndefined()
  })

  it('uses the default message page size and caps oversized limits', () => {
    const state = createAgentStoreState({
      agents,
      sessions,
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': Array.from({ length: 205 }, (_, index) => messageFixture(index + 1))
      }
    })

    const defaultPage = listAgentSessionMessages(state, 'session-1')
    const oversizedPage = listAgentSessionMessages(state, 'session-1', { limit: 500 })
    const tailPage = listAgentSessionMessages(state, 'session-1', { limit: 500, cursor: oversizedPage.nextCursor })

    expect(defaultPage.items).toHaveLength(50)
    expect(defaultPage.items[0].id).toBe('message-205')
    expect(oversizedPage.items).toHaveLength(200)
    expect(oversizedPage.nextCursor).toBe(`${Date.parse(messageFixture(6).createdAt)}:message-006`)
    expect(tailPage.items.map((message) => message.id)).toEqual([
      'message-005',
      'message-004',
      'message-003',
      'message-002',
      'message-001'
    ])
  })

  it('falls back to the latest message page when a message cursor is malformed', () => {
    const state = createAgentStoreState({
      agents,
      sessions,
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [1, 2, 3].map((index) => messageFixture(index))
      }
    })

    const page = listAgentSessionMessages(state, 'session-1', { limit: 2, cursor: 'not-a-message-cursor' })

    expect(page.items.map((message) => message.id)).toEqual(['message-003', 'message-002'])
    expect(page.nextCursor).toBe(`${Date.parse(messageFixture(2).createdAt)}:message-002`)
  })

  it('marks stale pending messages as paused on startup reconciliation', () => {
    const state = addAgentSessionMessage(
      addAgentSessionMessage(createAgentStoreState({ agents, sessions, workspaces: [workspace] }), 'session-1', {
        id: 'message-1',
        role: 'assistant',
        status: 'pending',
        data: { parts: [{ type: 'text', text: 'partial answer' }] }
      }),
      'session-1',
      {
        id: 'message-2',
        role: 'assistant',
        status: 'pending',
        data: { parts: [{ type: 'text', text: '' }] }
      }
    )

    const next = reconcileStalePendingMessages(state, 'stopped')

    expect(next.messagesBySessionId['session-1']).toEqual([
      expect.objectContaining({ id: 'message-1', status: 'paused', searchableText: 'partial answer' }),
      expect.objectContaining({ id: 'message-2', status: 'paused', searchableText: 'stopped' })
    ])
  })

  it('merges runtime session messages without overwriting concurrent agent edits', () => {
    const base = createAgentStoreState({ agents, sessions, workspaces: [workspace], activeSessionId: 'session-1' })
    const current = updateAgent(base, 'agent-1', { name: 'Renamed while streaming' })
    const runtimeSnapshot = addAgentSessionMessage(base, 'session-1', {
      id: 'runtime-message',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'streamed answer' }] }
    })

    const merged = mergeAgentRuntimeSessionState(current, runtimeSnapshot, 'session-1')

    expect(merged.agents.find((agent) => agent.id === 'agent-1')?.name).toBe('Renamed while streaming')
    expect(merged.messagesBySessionId['session-1'].map((message) => message.id)).toEqual(['runtime-message'])
    expect(merged.activeSessionId).toBe(current.activeSessionId)
  })

  it('keeps related collections in the store snapshot', () => {
    const state = createAgentStoreState({
      agents,
      sessions,
      workspaces: [workspace],
      channels: [
        {
          id: 'channel-1',
          type: 'telegram',
          name: 'Telegram',
          agentId: 'agent-1',
          workspace: { type: 'system' },
          config: { bot_token: 'token' },
          isActive: true,
          activeChatIds: ['chat-1'],
          permissionMode: 'default',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      skills: [
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
      ],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }],
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
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      taskRunLogs: [
        {
          id: 'run-1',
          scheduleId: 'task-1',
          sessionId: 'session-1',
          startedAt: '2026-01-01T00:00:00.000Z',
          durationMs: 120,
          status: 'completed',
          result: 'ok'
        }
      ],
      channelTaskSubscriptions: [{ channelId: 'channel-1', taskId: 'task-1' }]
    })

    expect(state.channels[0].agentId).toBe('agent-1')
    expect(state.skills[0].folderName).toBe('skill')
    expect(state.agentSkills[0]).toEqual({ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true })
    expect(state.tasks[0].channelIds).toEqual(['channel-1'])
    expect(state.taskRunLogs[0].status).toBe('completed')
    expect(state.channelTaskSubscriptions[0]).toEqual({ channelId: 'channel-1', taskId: 'task-1' })
  })
})
