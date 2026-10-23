import { describe, expect, it } from 'vitest'

import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentSessionEntity, AgentSessionMessageEntity, MessageStatus } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'

import {
  buildSessionRuntimeStatusById,
  filterSessionsForAgent,
  getAgentPrimarySessionId,
  getCreateSessionAgentId,
  getCreateSessionFallbackAgentId,
  getLatestAssistantMessageUpdatedAt,
  getSessionRuntimeStatus,
  groupAgentSessions
} from './agentSessionViewModel'
import { agentText } from './agentText'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '',
  type: 'system',
  orderKey: 'workspace-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function session(input: { id: string; agentId: string | null; name?: string }): AgentSessionEntity {
  return {
    id: input.id,
    agentId: input.agentId,
    name: input.name ?? input.id,
    workspaceId: workspace.id,
    workspace,
    orderKey: input.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function message(input: {
  id: string
  role: AgentSessionMessageEntity['role']
  status: MessageStatus
  text?: string
  updatedAt?: string
}): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: 'session-1',
    role: input.role,
    data: { parts: [{ type: 'text', text: input.text ?? input.id }] },
    searchableText: input.text ?? input.id,
    status: input.status,
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-01-01T00:00:00.000Z'
  }
}

function runtimeState(
  overrides: Partial<AgentSessionRuntimeStateBySessionId[string]>
): AgentSessionRuntimeStateBySessionId[string] {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    agentType: 'claude-code',
    inflightRequestCount: 0,
    queuedTurnCount: 0,
    turnState: 'idle',
    warmState: 'cold',
    lastRunId: null,
    lastResumeToken: null,
    lastResumeTokenSource: null,
    lastTerminalStatus: null,
    lastStopReason: null,
    lastWarmAt: null,
    lastWarmResultMessage: null,
    traceId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    turnPhase: overrides.turnPhase ?? 'idle'
  }
}

describe('agent session view model', () => {
  it('groups sessions into pinned and recent sections without changing order', () => {
    const sessions = [
      session({ id: 'session-2', agentId: 'agent-2' }),
      session({ id: 'session-1', agentId: 'agent-1' }),
      session({ id: 'session-3', agentId: 'agent-3' })
    ]

    expect(groupAgentSessions(sessions, new Set(['session-1']), agentText['zh-CN'].common)).toEqual([
      { key: 'pinned', title: '置顶', sessions: [sessions[1]] },
      { key: 'recent', title: '最近', sessions: [sessions[0], sessions[2]] }
    ])
  })

  it('picks the active session owner before falling back to first session or first agent', () => {
    const sessions = [
      session({ id: 'session-1', agentId: 'agent-1' }),
      session({ id: 'session-2', agentId: 'agent-2' })
    ]

    expect(getCreateSessionFallbackAgentId(sessions, 'session-2', 'agent-3')).toBe('agent-2')
    expect(getCreateSessionFallbackAgentId(sessions, null, 'agent-3')).toBe('agent-1')
    expect(getCreateSessionFallbackAgentId([], null, 'agent-3')).toBe('agent-3')
  })

  it('filters the session tab to the currently selected agent', () => {
    const sessions = [
      session({ id: 'session-1', agentId: 'agent-1' }),
      session({ id: 'session-orphan', agentId: null }),
      session({ id: 'session-2', agentId: 'agent-2' })
    ]

    expect(filterSessionsForAgent(sessions, 'agent-1')).toEqual([sessions[0]])
    expect(filterSessionsForAgent(sessions, null)).toEqual([])
  })

  it('creates new sessions only for the selected agent', () => {
    expect(getCreateSessionAgentId('agent-1')).toBe('agent-1')
    expect(getCreateSessionAgentId(null)).toBeNull()
  })

  it('selects the active agent primary session before falling back to its first session', () => {
    const sessions = [
      session({ id: 'session-1', agentId: 'agent-1' }),
      session({ id: 'session-2', agentId: 'agent-2' }),
      session({ id: 'session-3', agentId: 'agent-1' })
    ]

    expect(getAgentPrimarySessionId(sessions, 'agent-1', 'session-3')).toBe('session-3')
    expect(getAgentPrimarySessionId(sessions, 'agent-1', 'session-2')).toBe('session-1')
    expect(getAgentPrimarySessionId(sessions, 'agent-3', 'session-1')).toBeNull()
  })

  it('marks a session pending when any assistant message is still running', () => {
    expect(getSessionRuntimeStatus(runtimeState({ inflightRequestCount: 1 }))).toBe('pending')
  })

  it('marks a session pending when the runtime turn is stopping', () => {
    expect(getSessionRuntimeStatus(runtimeState({ turnState: 'stopping' }))).toBe('pending')
  })

  it('marks a session done when the latest assistant turn completed successfully', () => {
    expect(getSessionRuntimeStatus(runtimeState({ lastTerminalStatus: 'success' }))).toBe('done')
  })

  it('marks a session error from the latest assistant error', () => {
    expect(getSessionRuntimeStatus(runtimeState({ lastTerminalStatus: 'error' }))).toBe('error')
  })

  it('marks interrupted assistant work as paused', () => {
    expect(getSessionRuntimeStatus(runtimeState({ lastTerminalStatus: 'paused' }))).toBe('paused')
  })

  it('keeps sessions idle before an assistant turn exists', () => {
    expect(getSessionRuntimeStatus(undefined)).toBe('idle')
    expect(getSessionRuntimeStatus(runtimeState({}))).toBe('idle')
  })

  it('returns the latest assistant update time for seen-state comparisons', () => {
    expect(
      getLatestAssistantMessageUpdatedAt([
        message({ id: 'message-1', role: 'assistant', status: 'success', updatedAt: '2026-01-01T00:00:00.000Z' }),
        message({ id: 'message-2', role: 'user', status: 'success', updatedAt: '2026-01-03T00:00:00.000Z' }),
        message({ id: 'message-3', role: 'assistant', status: 'success', updatedAt: '2026-01-02T00:00:00.000Z' })
      ])
    ).toBe('2026-01-02T00:00:00.000Z')
  })

  it('builds runtime status by session id for chat-level controls', () => {
    const sessions = [session({ id: 'session-1', agentId: 'agent-1' }), session({ id: 'session-2', agentId: 'agent-2' })]

    expect(
      buildSessionRuntimeStatusById(sessions, {
        'session-1': runtimeState({ sessionId: 'session-1', inflightRequestCount: 1 }),
        'session-2': runtimeState({ sessionId: 'session-2', agentId: 'agent-2', lastTerminalStatus: 'success' })
      })
    ).toEqual({
      'session-1': 'pending',
      'session-2': 'done'
    })
  })
})
