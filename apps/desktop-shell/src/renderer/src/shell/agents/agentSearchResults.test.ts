import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { buildAgentSearchResults } from './agentSearchResults'

const createdAt = '2026-01-01T00:00:00.000Z'
const copy = { agentLabel: 'Agent', unboundAgent: 'Unbound agent', noDescription: 'No description' }

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
  name: 'Research Agent',
  description: 'Reads sources carefully',
  instructions: 'Summarize evidence.',
  model: 'provider:model-a',
  modelName: 'Model A',
  orderKey: 'agent-1',
  createdAt,
  updatedAt: createdAt
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Morning Notes',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt,
  updatedAt: createdAt
}

const message: AgentSessionMessageEntity = {
  id: 'message-1',
  sessionId: 'session-1',
  role: 'user',
  data: { parts: [{ type: 'text', text: 'special keyword' }] },
  searchableText: 'special keyword',
  status: 'success',
  modelId: null,
  modelSnapshot: null,
  stats: null,
  runtimeResumeToken: null,
  createdAt,
  updatedAt: createdAt
}

function state() {
  return createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: { 'session-1': [message] }
  })
}

describe('agent search results', () => {
  it('returns agent and session results for an empty keyword', () => {
    const results = buildAgentSearchResults(state(), '', copy)

    expect(results.map((item) => item.type)).toEqual(['agent', 'session'])
    expect(results[0]).toMatchObject({ type: 'agent', agentId: 'agent-1', title: 'Research Agent' })
    expect(results[1]).toMatchObject({ type: 'session', sessionId: 'session-1', title: 'Morning Notes' })
  })

  it('matches agents by description and sessions by message text', () => {
    const agentResults = buildAgentSearchResults(state(), 'sources', copy)
    const sessionResults = buildAgentSearchResults(state(), 'keyword', copy)

    expect(agentResults.map((item) => item.type)).toContain('agent')
    expect(agentResults[0]).toMatchObject({ type: 'agent', title: 'Research Agent' })
    expect(sessionResults.map((item) => item.type)).toEqual(['session'])
    expect(sessionResults[0]).toMatchObject({ excerpt: 'special keyword' })
  })
})
