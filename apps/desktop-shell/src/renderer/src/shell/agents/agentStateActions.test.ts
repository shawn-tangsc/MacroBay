import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { addAgentSessionMessage, createAgentStoreState, toggleSessionPin } from '@platform/ai/agent-platform/store/agentStore'

import {
  addWorkspaceAndSetSession,
  clearSessionMessages,
  createDefaultAgentSession,
  deleteAgentConfig,
  deleteSession,
  deleteSessionMessage,
  deleteSessions,
  renameSession,
  reorderSessions,
  saveAgentConfig,
  selectSession,
  setAgentHeartbeatEnabled,
  setAgentModel,
  setAgentPermissionMode,
  setAgentSoulMode,
  setAgentToolEnabled,
  setSessionWorkspace,
  toggleSessionPinned
} from './agentStateActions'

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

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  disabledTools: ['Bash'],
  configuration: { permission_mode: 'default' },
  createdAt,
  updatedAt: createdAt,
  orderKey: 'agent-1'
}

const secondAgent: AgentEntity = {
  ...agent,
  id: 'agent-2',
  name: 'Second Agent',
  orderKey: 'agent-2'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt,
  updatedAt: createdAt
}

const secondSession: AgentSessionEntity = {
  ...session,
  id: 'session-2',
  agentId: 'agent-2',
  name: 'Second Session',
  orderKey: 'session-2'
}

function state() {
  return createAgentStoreState({
    agents: [agent, secondAgent],
    sessions: [session, secondSession],
    workspaces: [workspace],
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1'
  })
}

describe('agent state actions', () => {
  it('creates a default system session for the active agent', () => {
    const next = createDefaultAgentSession(state(), 'New')

    expect(next.sessions[0]).toMatchObject({ name: 'New', agentId: 'agent-1' })
    expect(next.sessions[0].workspace.type).toBe('system')
    expect(next.activeSessionId).toBe(next.sessions[0].id)
  })

  it('creates a default system session for an explicit agent even when another session is active', () => {
    const next = createDefaultAgentSession(state(), 'New for second agent', 'agent-2')

    expect(next.sessions[0]).toMatchObject({ name: 'New for second agent', agentId: 'agent-2' })
    expect(next.activeAgentId).toBe('agent-2')
    expect(next.activeSessionId).toBe(next.sessions[0].id)
  })

  it('selects, renames, pins, and deletes sessions through one facade', () => {
    const selected = selectSession(state(), 'session-2')
    const renamed = renameSession(selected, 'session-2', '  Renamed  ')
    const pinned = toggleSessionPinned(renamed, 'session-2')
    const deleted = deleteSession(pinned, 'session-2')

    expect(selected.activeAgentId).toBe('agent-2')
    expect(renamed.sessions.find((item) => item.id === 'session-2')?.name).toBe('Renamed')
    expect(pinned.sessionPins.some((pin) => pin.sessionId === 'session-2')).toBe(true)
    expect(deleted.sessions.map((item) => item.id)).toEqual(['session-1'])
  })

  it('deletes multiple sessions and clears related messages', () => {
    const withMessage = addAgentSessionMessage(state(), 'session-2', {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'delete me' }] }
    })
    const pinned = toggleSessionPin(withMessage, 'session-2')
    const next = deleteSessions(pinned, ['session-2'])

    expect(next.sessions.map((item) => item.id)).toEqual(['session-1'])
    expect(next.messagesBySessionId['session-2']).toBeUndefined()
    expect(next.sessionPins.some((pin) => pin.sessionId === 'session-2')).toBe(false)
  })

  it('reorders sessions through the action facade', () => {
    const next = reorderSessions(state(), ['session-2', 'session-1'])

    expect(next.sessions.map((item) => item.id)).toEqual(['session-2', 'session-1'])
    expect(next.sessions.find((item) => item.id === 'session-2')?.orderKey).toBe('0000')
  })

  it('updates model, permission, soul mode, heartbeat, and tool state', () => {
    const model = setAgentModel(state(), 'agent-1', 'provider:model-b')
    const permission = setAgentPermissionMode(model, 'agent-1', 'plan')
    const soul = setAgentSoulMode(permission, 'agent-1', true)
    const normal = setAgentSoulMode(soul, 'agent-1', false)
    const heartbeat = setAgentHeartbeatEnabled(normal, 'agent-1', false)
    const tool = setAgentToolEnabled(heartbeat, 'agent-1', 'Bash', true)

    const updated = tool.agents.find((item) => item.id === 'agent-1')
    expect(updated?.model).toBe('provider:model-b')
    expect(soul.agents.find((item) => item.id === 'agent-1')?.configuration?.permission_mode).toBe('bypassPermissions')
    expect(updated?.configuration?.permission_mode).toBe('default')
    expect(updated?.configuration?.soul_enabled).toBe(false)
    expect(updated?.configuration?.heartbeat_enabled).toBe(false)
    expect(updated?.disabledTools).toEqual([])
  })

  it('saves agent create and update intents through the facade', () => {
    const created = saveAgentConfig(
      state(),
      {
        kind: 'create',
        payload: {
          type: 'claude-code',
          name: 'Created',
          model: 'provider:model-c'
        }
      },
      null
    )
    const createdAgent = created.agents.find((item) => item.name === 'Created')
    const updated = saveAgentConfig(
      created,
      {
        kind: 'update',
        payload: {
          name: 'Updated'
        }
      },
      createdAgent?.id ?? null
    )

    expect(createdAgent).toBeTruthy()
    expect(updated.agents.find((item) => item.id === createdAgent?.id)?.name).toBe('Updated')
  })

  it('deletes an agent through the facade', () => {
    const next = deleteAgentConfig(state(), 'agent-2')

    expect(next.agents.map((item) => item.id)).toEqual(['agent-1'])
    expect(next.sessions.find((item) => item.id === 'session-2')?.agentId).toBeNull()
  })

  it('creates a default session when saving a new agent', () => {
    const created = saveAgentConfig(
      state(),
      {
        kind: 'create',
        payload: {
          type: 'claude-code',
          name: 'Created',
          model: 'provider:model-c'
        }
      },
      null
    )

    const createdAgent = created.agents.find((item) => item.name === 'Created')
    const createdSession = created.sessions.find((item) => item.agentId === createdAgent?.id)

    expect(createdAgent).toBeTruthy()
    expect(createdSession).toMatchObject({ name: 'Created', workspace: { type: 'system' } })
    expect(created.activeAgentId).toBe(createdAgent?.id)
    expect(created.activeSessionId).toBe(createdSession?.id)
  })

  it('sets session workspace from existing and newly added workspaces', () => {
    const system = setSessionWorkspace(state(), 'session-1', { type: 'system' })
    const withPath = addWorkspaceAndSetSession(system, 'session-1', '/Users/example/project')

    expect(system.sessions.find((item) => item.id === 'session-1')?.workspace.type).toBe('system')
    expect(withPath.sessions.find((item) => item.id === 'session-1')?.workspace.path).toBe('/Users/example/project')
  })

  it('clears messages and deletes one message through the facade', () => {
    const withMessages = addAgentSessionMessage(
      addAgentSessionMessage(state(), 'session-1', {
        id: 'message-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'one' }] }
      }),
      'session-1',
      {
        id: 'message-2',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'two' }] }
      }
    )

    const withoutOne = deleteSessionMessage(withMessages, 'session-1', 'message-1')
    const cleared = clearSessionMessages(withoutOne, 'session-1')

    expect(withoutOne.messagesBySessionId['session-1'].map((item) => item.id)).toEqual(['message-2'])
    expect(cleared.messagesBySessionId['session-1']).toEqual([])
  })
})
