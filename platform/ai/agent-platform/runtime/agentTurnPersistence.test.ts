import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentMentionedModelDescriptor, AgentSessionEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../store/agentStore'
import {
  addPendingAssistantMessageToState,
  addRuntimeErrorTurnToState,
  buildRuntimePromptText,
  buildRuntimeTurnResult,
  createRuntimeTextData,
  createRuntimeUserMessageData,
  maybeAutoRenameSessionAfterTurn,
  patchRuntimeAssistantMessage
} from './agentTurnPersistence'

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

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Code Assistant',
  instructions: 'Answer as a concise code assistant.',
  model: 'provider-1:chat-model',
  modelName: 'Chat Model',
  configuration: { permission_mode: 'default' },
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'New agent session',
  workspaceId: workspace.id,
  workspace: workspace,
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

function createState(overrides: Partial<AgentStoreState> = {}): AgentStoreState {
  return createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: {
      'session-1': [
        {
          id: 'message-user-1',
          sessionId: 'session-1',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Review this change.' }] },
          searchableText: 'Review this change.',
          status: 'success',
          modelId: null,
          modelSnapshot: null,
          stats: null,
          runtimeResumeToken: null,
          createdAt,
          updatedAt: createdAt
        }
      ]
    },
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1',
    ...overrides
  })
}

describe('agent turn persistence helpers', () => {
  it('builds user message data and prompt text with mentioned models', () => {
    const mentionedModels: AgentMentionedModelDescriptor[] = [
      {
        id: 'anthropic:claude-sonnet-4',
        label: 'Claude Sonnet 4',
        providerName: 'Anthropic'
      }
    ]

    expect(createRuntimeUserMessageData('Use another model.', mentionedModels)).toEqual({
      parts: [
        {
          type: 'agent-mentioned-models',
          modelIds: ['anthropic:claude-sonnet-4'],
          models: [
            {
              id: 'anthropic:claude-sonnet-4',
              label: 'Claude Sonnet 4',
              providerName: 'Anthropic'
            }
          ]
        },
        {
          type: 'text',
          text: 'Use another model.'
        }
      ]
    })
    expect(buildRuntimePromptText('Use another model.', mentionedModels)).toContain('Mentioned models:')
    expect(buildRuntimePromptText('Use another model.', mentionedModels)).toContain('Use another model.')
  })

  it('separates the display question from the raw prompt and stores a readable context part', () => {
    const data = createRuntimeUserMessageData(
      '给我分析一下这个结论\n\n[eventGroupId=eg-1; analysisRunId=ar-1]',
      [],
      {
        displayText: '给我分析一下这个结论',
        context: { kind: 'market-analysis-node', label: '10-23 16:25 分析结论', detail: '10月制造业 PMI（初值）', payload: { eventGroupId: 'eg-1' } }
      }
    )

    expect(data.parts).toEqual([
      {
        type: 'agent-context',
        kind: 'market-analysis-node',
        label: '10-23 16:25 分析结论',
        detail: '10月制造业 PMI（初值）',
        payload: { eventGroupId: 'eg-1' }
      },
      { type: 'text', text: '给我分析一下这个结论' }
    ])
    expect(
      buildRuntimePromptText('给我分析一下这个结论\n\n[eventGroupId=eg-1; analysisRunId=ar-1]', [])
    ).toContain('[eventGroupId=eg-1')
  })

  it('adds a pending assistant message with the agent model snapshot', () => {
    const state = createState()

    const next = addPendingAssistantMessageToState(state, {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      modelId: agent.model,
      modelName: agent.modelName
    })

    expect(next.messagesBySessionId['session-1'].at(-1)).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      status: 'pending',
      searchableText: '正在连接模型服务...',
      modelId: 'provider-1:chat-model',
      modelSnapshot: {
        id: 'chat-model',
        name: 'Chat Model',
        provider: 'provider-1'
      }
    })
  })

  it('adds a visible user and error assistant turn when runtime setup fails before normal persistence', () => {
    const state = createState({ messagesBySessionId: { 'session-1': [] } })

    const next = addRuntimeErrorTurnToState(state, {
      sessionId: 'session-1',
      text: '你好',
      errorText: 'Claude Code provider is not ready.',
      assistantMessageId: 'assistant-run-1',
      modelId: agent.model,
      modelName: agent.modelName,
      mentionedModels: []
    })

    expect(next.messagesBySessionId['session-1']).toHaveLength(2)
    expect(next.messagesBySessionId['session-1'][0]).toMatchObject({
      role: 'user',
      status: 'success',
      searchableText: '你好'
    })
    expect(next.messagesBySessionId['session-1'][1]).toMatchObject({
      id: 'assistant-run-1',
      role: 'assistant',
      status: 'error',
      searchableText: 'Claude Code provider is not ready.',
      modelId: 'provider-1:chat-model',
      modelSnapshot: {
        id: 'chat-model',
        name: 'Chat Model',
        provider: 'provider-1'
      }
    })
  })

  it('patches the assistant message, auto-renames default sessions, and rebuilds the turn result', async () => {
    let state = addPendingAssistantMessageToState(createState(), {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      modelId: agent.model,
      modelName: agent.modelName
    })

    const io = {
      getAgentState: async () => state,
      saveAgentState: async (next: AgentStoreState) => {
        state = next
      }
    }

    const patched = await patchRuntimeAssistantMessage(io, 'session-1', 'assistant-1', {
      status: 'success',
      data: createRuntimeTextData('Finished review.'),
      runtimeResumeToken: 'resume-1'
    })
    const renamed = await maybeAutoRenameSessionAfterTurn(io, patched, 'session-1', 'Please review this pull request.')
    const result = buildRuntimeTurnResult(renamed, 'session-1', 'assistant-1')

    expect(result.assistantMessage).toMatchObject({
      id: 'assistant-1',
      status: 'success',
      searchableText: 'Finished review.',
      runtimeResumeToken: 'resume-1'
    })
    expect(result.userMessage.id).toBe('message-user-1')
    expect(result.state.sessions.find((item) => item.id === 'session-1')?.name).toBe('Please review this pull request')
  })

  it('prefers AI naming when the hook renames the session', async () => {
    let state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      messagesBySessionId: {
        'session-1': [
          {
            id: 'message-user-1',
            sessionId: 'session-1',
            role: 'user',
            status: 'success',
            modelId: null,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            searchableText: 'Please review this pull request.',
            data: { parts: [{ type: 'text', text: 'Please review this pull request.' }] },
            createdAt,
            updatedAt: createdAt
          },
          {
            id: 'assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            status: 'pending',
            modelId: agent.model,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            searchableText: 'pending',
            data: { parts: [{ type: 'text', text: 'pending' }] },
            createdAt,
            updatedAt: createdAt
          }
        ]
      }
    })

    const io = {
      getAgentState: async () => state,
      saveAgentState: async (next: AgentStoreState) => {
        state = next
      }
    }

    const patched = await patchRuntimeAssistantMessage(io, 'session-1', 'assistant-1', {
      status: 'success',
      data: createRuntimeTextData('Finished review.')
    })
    const renamed = await maybeAutoRenameSessionAfterTurn(io, patched, 'session-1', 'Please review this pull request.', {
      assistantText: 'Finished review.',
      modelId: agent.model,
      aiNaming: async () => {
        state = {
          ...state,
          sessions: state.sessions.map((item) =>
            item.id === 'session-1' ? { ...item, name: 'AI Named Review' } : item
          )
        }
        return { renamed: true, title: 'AI Named Review' }
      }
    })

    expect(renamed.sessions.find((item) => item.id === 'session-1')?.name).toBe('AI Named Review')
  })
})
