import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { appendAgentSessionMessagePage, buildAgentSessionMessageWindow } from './agentSessionMessageWindow'

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
  createdAt,
  updatedAt: createdAt,
  orderKey: 'agent-1'
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

function messageFixture(index: number): AgentSessionMessageEntity {
  const suffix = String(index).padStart(3, '0')
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  return {
    id: `message-${suffix}`,
    sessionId: 'session-1',
    role: index % 2 === 0 ? 'assistant' : 'user',
    data: { parts: [{ type: 'text', text: `message ${suffix}` }] },
    searchableText: `message ${suffix}`,
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function stateWithMessages(count: number) {
  return createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: {
      'session-1': Array.from({ length: count }, (_, index) => messageFixture(index + 1))
    },
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1'
  })
}

describe('agent session message window', () => {
  it('shows the latest cursor page in chronological chat order', () => {
    const view = buildAgentSessionMessageWindow(stateWithMessages(6), 'session-1', {
      loadedPageCount: 1,
      pageSize: 2
    })

    expect(view.messages.map((message) => message.id)).toEqual(['message-005', 'message-006'])
    expect(view.hasOlder).toBe(true)
  })

  it('prepends older cursor pages while keeping display order stable', () => {
    const view = buildAgentSessionMessageWindow(stateWithMessages(6), 'session-1', {
      loadedPageCount: 2,
      pageSize: 2
    })

    expect(view.messages.map((message) => message.id)).toEqual([
      'message-003',
      'message-004',
      'message-005',
      'message-006'
    ])
    expect(view.hasOlder).toBe(true)
  })

  it('marks the history as complete when no older cursor page remains', () => {
    const view = buildAgentSessionMessageWindow(stateWithMessages(4), 'session-1', {
      loadedPageCount: 3,
      pageSize: 2
    })

    expect(view.messages.map((message) => message.id)).toEqual([
      'message-001',
      'message-002',
      'message-003',
      'message-004'
    ])
    expect(view.hasOlder).toBe(false)
  })

  it('appends an older API page while preserving chronological chat order', () => {
    const initial = buildAgentSessionMessageWindow(stateWithMessages(6), 'session-1', {
      loadedPageCount: 1,
      pageSize: 2
    })
    const olderPage = {
      items: [messageFixture(4), messageFixture(3)],
      nextCursor: '1672531202000:message-002'
    }

    const next = appendAgentSessionMessagePage(initial, olderPage)

    expect(next.messages.map((message) => message.id)).toEqual([
      'message-003',
      'message-004',
      'message-005',
      'message-006'
    ])
    expect(next.hasOlder).toBe(true)
  })
})
