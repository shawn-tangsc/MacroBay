import { describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '../../settings/schema/appSettings'
import { createAgentStoreState, updateAgentSession } from '../../ai/agent-platform/store/agentStore'
import type { ProviderState } from '../../ai/providers/modelProviderTypes'
import {
  createAgentSessionNamingControl,
  resolveAgentSessionNamingModelId
} from './agentSessionNamingDependencies'

function createProviderState(): ProviderState {
  return {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        enabled: true,
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.openai.com' }
        ],
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        models: [
          {
            id: 'gpt-4o-mini',
            name: 'GPT-4o mini',
            capabilities: { chat: true, vision: false, embedding: false, tools: false }
          }
        ],
        defaultChatModelId: 'gpt-4o-mini'
      }
    ]
  } as ProviderState
}

describe('agentSessionNamingDependencies', () => {
  it('resolves configured naming model before agent model', () => {
    const settings = createDefaultAppSettings()
    settings.agent.sessionNamingModelId = 'openai:gpt-4o-mini'

    expect(
      resolveAgentSessionNamingModelId({
        settings,
        providerState: createProviderState(),
        agentModelId: 'openai:missing'
      })
    ).toBe('openai:gpt-4o-mini')
  })

  it('falls back to agent model when naming model is empty', () => {
    const settings = createDefaultAppSettings()
    expect(
      resolveAgentSessionNamingModelId({
        settings,
        providerState: createProviderState(),
        agentModelId: 'openai:gpt-4o-mini'
      })
    ).toBe('openai:gpt-4o-mini')
  })

  it('renames a default session through the naming control', async () => {
    let state = createAgentStoreState({
      agents: [
        {
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'openai:gpt-4o-mini',
          modelName: 'GPT-4o mini',
          configuration: { permission_mode: 'default' },
          orderKey: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      sessions: [
        {
          id: 'session-1',
          agentId: 'agent-1',
          name: 'New agent session',
          workspaceId: 'workspace-1',
          workspace: {
            id: 'workspace-1',
            name: 'Workspace',
            path: '/tmp/workspace',
            type: 'user',
            orderKey: '1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          orderKey: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'PR Review Notes' } }]
      })
    })) as unknown as typeof globalThis.fetch

    const control = createAgentSessionNamingControl({
      getSettings: async () => createDefaultAppSettings(),
      getProviderState: async () => createProviderState(),
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      fetch
    })

    const result = await control.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Please review this pull request',
      assistantText: 'Looks good overall.',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: true, title: 'PR Review Notes' })
    expect(state.sessions[0]?.name).toBe('PR Review Notes')
    expect(fetch).toHaveBeenCalled()
  })

  it('keeps the session name when naming is disabled', async () => {
    const settings = createDefaultAppSettings()
    settings.agent.sessionNamingEnabled = false
    let state = createAgentStoreState({
      sessions: [
        {
          id: 'session-1',
          agentId: 'agent-1',
          name: 'New agent session',
          workspaceId: 'workspace-1',
          workspace: {
            id: 'workspace-1',
            name: 'Workspace',
            path: '/tmp/workspace',
            type: 'user',
            orderKey: '1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          orderKey: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })

    const control = createAgentSessionNamingControl({
      getSettings: async () => settings,
      getProviderState: async () => createProviderState(),
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      fetch: vi.fn() as unknown as typeof globalThis.fetch
    })

    const result = await control.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Hello',
      assistantText: 'Hi',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: false, reason: 'disabled' })
    expect(updateAgentSession(state, 'session-1', { name: 'x' }).sessions[0]?.name).toBe('x')
    expect(state.sessions[0]?.name).toBe('New agent session')
  })
})
