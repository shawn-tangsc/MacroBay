import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'
import { createAgentStoreState } from '../../store/agentStore'
import { AgentRuntimeCommandService } from './AgentRuntimeCommandService'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: '1',
  createdAt,
  updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Code Assistant',
  model: 'openai:gpt-4o-mini',
  modelName: 'GPT-4o mini',
  configuration: { permission_mode: 'default' },
  mcps: ['mcp-1'],
  orderKey: '1',
  createdAt,
  updatedAt: createdAt
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'New agent session',
  workspaceId: workspace.id,
  workspace,
  orderKey: '1',
  createdAt,
  updatedAt: createdAt
}

function createMessage(
  overrides: Partial<AgentSessionMessageEntity> & Pick<AgentSessionMessageEntity, 'id' | 'role'>
): AgentSessionMessageEntity {
  return {
    sessionId: 'session-1',
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    searchableText: 'text',
    data: { parts: [{ type: 'text', text: 'text' }] },
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

describe('AgentRuntimeCommandService', () => {
  const service = new AgentRuntimeCommandService()

  it('builds /context from session and composition metadata', () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [
          createMessage({ id: 'm1', role: 'user' }),
          createMessage({ id: 'm2', role: 'assistant' })
        ]
      }
    })

    const output = service.execute({
      command: '/context',
      agentId: 'agent-1',
      sessionId: 'session-1',
      state,
      composition: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        agentType: 'claude-code',
        instructions: null,
        modelId: agent.model,
        modelName: agent.modelName,
        permissionMode: 'default',
        workspacePath: workspace.path,
        workspaceType: workspace.type,
        environment: {},
        tools: { all: [], enabled: [{ id: 't1' } as never], disabled: [] },
        mcp: {
          servers: [{ id: 'mcp-1' } as never],
          sources: []
        },
        skills: { agentId: 'agent-1', skills: [{ skillId: 's1' } as never], toolIds: [] }
      },
      runtimeSession: {
        sessionId: 'session-1',
        agentId: 'agent-1',
        agentType: 'claude-code',
        inflightRequestCount: 0,
        queuedTurnCount: 0,
        turnState: 'idle',
        turnPhase: 'finishing',
        warmState: 'warm',
        traceId: null,
        lastRunId: null,
        lastResumeToken: null,
        lastResumeTokenSource: null,
        lastTerminalStatus: null,
        lastStopReason: null,
        lastWarmAt: null,
        lastWarmResultMessage: null,
        updatedAt: createdAt
      },
      runtimeRoute: 'direct'
    })

    expect(output.command).toBe('/context')
    expect(output.result.type).toBe('context')
    expect(output.text).toContain('Enabled tools: 1')
    expect(output.text).toContain('Warm state: warm')
  })

  it('builds /cost from message stats', () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      messagesBySessionId: {
        'session-1': [
          createMessage({
            id: 'm1',
            role: 'assistant',
            stats: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
          }),
          createMessage({
            id: 'm2',
            role: 'assistant',
            stats: { promptTokens: 20, completionTokens: 8, totalTokens: 28 }
          })
        ]
      }
    })

    const output = service.execute({
      command: '/cost',
      agentId: 'agent-1',
      sessionId: 'session-1',
      state
    })

    expect(output.result.type).toBe('cost')
    expect(output.text).toContain('Prompt tokens: 30')
    expect(output.text).toContain('Total tokens: 43')
  })

  it('builds a stable empty /todos result by default', () => {
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session]
    })

    const output = service.execute({
      command: '/todos',
      agentId: 'agent-1',
      sessionId: 'session-1',
      state
    })

    expect(output.result).toEqual({
      type: 'todos',
      summary: 'No runtime todos are available.',
      todos: []
    })
  })
})
