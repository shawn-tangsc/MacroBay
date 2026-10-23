import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { resolveAgentPageStatus } from './agentPageStatus'

const timestamp = '2026-01-01T00:00:00.000Z'

describe('resolveAgentPageStatus', () => {
  it('returns model service unavailable when the active agent model is still unconfigured', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: 'unconfigured:default-chat-model' })],
      activeAgent: createAgent({ model: 'unconfigured:default-chat-model' }),
      activeSession: createSession()
    })

    expect(status).toEqual({ type: 'model-service-unavailable', reason: 'unset' })
  })

  it('returns model service unavailable when the bound provider is not connection-ready', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider({ enabled: true, hasApiKey: false })]
    })

    expect(status).toEqual({ type: 'model-service-unavailable', reason: 'provider-not-ready' })
  })

  it('returns model service unavailable when the selected model is not Claude Code compatible', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: '302ai:o3' })],
      activeAgent: createAgent({ model: '302ai:o3' }),
      activeSession: createSession(),
      providers: [
        createProvider({
          id: '302ai',
          name: '302.AI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: '' },
            { protocol: 'messages', baseUrl: 'https://api.302.ai' }
          ],

          models: [
            {
              id: 'o3',
              name: 'o3',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true
              }
            }
          ],
          defaultChatModelId: 'o3'
        })
      ]
    })

    expect(status).toEqual({ type: 'model-service-unavailable', reason: 'model-incompatible' })
  })

  it('returns gateway-required when ordinary chat may work but Claude Code needs the gateway route', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: 'openai:gpt-5' })],
      activeAgent: createAgent({ model: 'openai:gpt-5' }),
      activeSession: createSession(),
      providers: [
        createProvider({
          id: 'openai',
          name: 'OpenAI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: '' }
          ],
          models: [
            {
              id: 'gpt-5',
              name: 'GPT-5',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'gpt-5'
        })
      ],
      gatewayEnabled: true
    })

    expect(status).toEqual({
      type: 'gateway-required',
      summary: expect.stringContaining('gateway')
    })
  })

  it('returns gateway-stopped when the selected model depends on a stopped gateway', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider()],
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'gateway',
        status: 'gateway-stopped',
        summary: 'Agent model gateway is stopped.'
      }
    })

    expect(status).toEqual({
      type: 'gateway-stopped',
      summary: 'Agent model gateway is stopped.'
    })
  })

  it('returns direct-auth-failed when shared runtime evidence reports Claude Code auth failure', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider()],
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'auth-failed',
        summary: 'Direct Claude Code runtime authentication failed.'
      }
    })

    expect(status).toEqual({
      type: 'direct-auth-failed',
      summary: 'Direct Claude Code runtime authentication failed.'
    })
  })

  it('returns runtime-unverified when shared evidence has not verified the Claude Code route', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider()],
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'unknown',
        summary: 'Claude Code runtime route has not been verified yet.'
      }
    })

    expect(status).toEqual({
      type: 'runtime-unverified',
      summary: 'Claude Code runtime route has not been verified yet.'
    })
  })

  it('returns runtime-unverified when a compatibility map is present but the active model has no evidence yet', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider()],
      compatibility: null
    })

    expect(status).toEqual({
      type: 'runtime-unverified',
      summary: expect.stringContaining('has not been verified yet')
    })
  })

  it('returns ordinary-chat-only when the model is protocol-unsupported for Claude Code', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent()],
      activeAgent: createAgent(),
      activeSession: createSession(),
      providers: [createProvider()],
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'protocol-unsupported',
        summary: 'Ordinary chat may work, but Claude Code runtime is unsupported.'
      }
    })

    expect(status).toEqual({
      type: 'ordinary-chat-only',
      summary: 'Ordinary chat may work, but Claude Code runtime is unsupported.'
    })
  })

  it('returns gateway-required when a relay model has no proven gateway route', () => {
    const activeAgent = createAgent({ model: '302ai:deepseek-chat' })
    const activeSession = createSession({ agentId: activeAgent.id })
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession,
      providers: [
        createProvider({
          id: '302ai',
          name: '302.AI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: '' },
            { protocol: 'messages', baseUrl: 'https://api.302.ai' }
          ],

          models: [
            {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-chat'
        })
      ]
    })

    expect(status).toEqual({
      type: 'gateway-required',
      summary: expect.stringContaining('gateway')
    })
  })

  it('returns ready for a declared relay model with a Messages endpoint and no probe yet', () => {
    const activeAgent = createAgent({ model: 'relay:deepseek-v4' })
    const activeSession = createSession({ agentId: activeAgent.id })
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession,
      providers: [
        createProvider({
          id: 'relay',
          name: 'Relay',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://relay.example.com' },
            { protocol: 'messages', baseUrl: 'https://relay.example.com' }
          ],
          baseUrl: 'https://relay.example.com',
          models: [
            {
              id: 'deepseek-v4',
              name: 'DeepSeek V4',
              messagesSupport: 'yes',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-v4'
        })
      ],
      compatibility: null,
      gatewayEnabled: false
    })

    // The model picker already treats the vendor's Messages declaration as usable evidence.
    // No probe means "not verified yet", not "must use the gateway"; a contrary probe result
    // still switches this to gateway-required.
    expect(status).toEqual({ type: 'ready' })
  })

  it('returns ready for a native Messages provider with declared support and no evidence entry', () => {
    const activeAgent = createAgent()
    const activeSession = createSession({ agentId: activeAgent.id })
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession,
      providers: [
        createProvider({
          models: [
            {
              id: 'claude-sonnet',
              name: 'Claude Sonnet',
              messagesSupport: 'yes',
              capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
            }
          ]
        })
      ],
      compatibility: null
    })

    expect(status).toEqual({ type: 'ready' })
  })

  it('returns ready when shared runtime evidence proves a relay model through gateway', () => {
    const activeAgent = createAgent({ model: '302ai:deepseek-chat' })
    const activeSession = createSession({ agentId: activeAgent.id })
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession,
      providers: [
        createProvider({
          id: '302ai',
          name: '302.AI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: '' },
            { protocol: 'messages', baseUrl: 'https://api.302.ai' }
          ],

          models: [
            {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-chat'
        })
      ],
      compatibility: {
        providerId: '302ai',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'gateway',
        status: 'ready',
        summary: 'Agent gateway runtime probe passed.'
      }
    })

    expect(status).toEqual({ type: 'ready' })
  })

  it('returns no agents when the generic agent library is empty', () => {
    const status = resolveAgentPageStatus({
      agents: [],
      activeAgent: null,
      activeSession: null
    })

    expect(status).toEqual({ type: 'no-agents' })
  })

  it('returns no session when there is an active agent but no active session', () => {
    const activeAgent = createAgent()
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession: null,
      providers: [createProvider()]
    })

    expect(status).toEqual({ type: 'no-session' })
  })

  it('returns orphan session when the active session is not bound to the active agent', () => {
    const activeAgent = createAgent()
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession: createSession({ agentId: null }),
      providers: [createProvider()]
    })

    expect(status).toEqual({ type: 'orphan-session' })
  })

  it('returns ready when the current agent and session can chat', () => {
    const activeAgent = createAgent()
    const activeSession = createSession({ agentId: activeAgent.id })
    const status = resolveAgentPageStatus({
      agents: [activeAgent],
      activeAgent,
      activeSession,
      providers: [createProvider()]
    })

    expect(status).toEqual({ type: 'ready' })
  })
})

describe('resolveAgentPageStatus with the default agent model', () => {
  it('treats an unconfigured agent as ready when the configured default is a declared agent model', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: 'unconfigured:default-chat-model' })],
      activeAgent: createAgent({ model: 'unconfigured:default-chat-model' }),
      activeSession: createSession(),
      providers: [
        createProvider({
          models: [
            {
              id: 'claude-sonnet',
              name: 'Claude Sonnet',
              messagesSupport: 'yes',
              capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
            }
          ]
        })
      ],
      defaultAgentModelId: 'anthropic:claude-sonnet'
    })

    expect(status).toEqual({ type: 'ready' })
  })

  it('stays unavailable when the default itself cannot be used', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: 'unconfigured:default-chat-model' })],
      activeAgent: createAgent({ model: 'unconfigured:default-chat-model' }),
      activeSession: createSession(),
      providers: [createProvider({ hasApiKey: false })],
      defaultAgentModelId: 'anthropic:claude-sonnet'
    })

    expect(status).toEqual({ type: 'model-service-unavailable', reason: 'provider-not-ready' })
  })

  it('keeps the agent-bound model ahead of the default', () => {
    const status = resolveAgentPageStatus({
      agents: [createAgent({ model: 'unconfigured:default-chat-model' })],
      activeAgent: createAgent({ model: 'other:missing-model' }),
      activeSession: createSession(),
      providers: [createProvider({ models: [] })],
      defaultAgentModelId: 'anthropic:claude-sonnet'
    })

    expect(status).toEqual({ type: 'model-service-unavailable', reason: 'provider-missing' })
  })
})

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'General Agent',
    description: 'Generic agent',
    instructions: 'Help clearly.',
    model: 'anthropic:claude-sonnet',
    modelName: 'Anthropic / Claude Sonnet',
    mcps: [],
    disabledTools: [],
    configuration: {
      permission_mode: 'default',
      max_turns: 20,
      heartbeat_enabled: false,
      heartbeat_interval: 30
    },
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session 1',
    description: '',
    workspaceId: 'workspace-1',
    workspace: {
      id: 'workspace-1',
      name: 'System Workspace',
      path: '',
      type: 'system',
      orderKey: '0001',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    orderKey: '0001',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function createProvider(overrides: Partial<SafeModelProvider> = {}): SafeModelProvider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    endpoints: [
      { protocol: 'messages', baseUrl: 'https://api.anthropic.com' }
    ],
    enabled: true,
    baseUrl: 'https://api.anthropic.com',
    hasApiKey: true,
    apiKeyPreview: 'sk-t**********1234',
    isSystem: false,
    models: [
      {
        id: 'claude-sonnet',
        name: 'Claude Sonnet',
        capabilities: {
          chat: true,
          vision: false,
          embedding: false,
          tools: true,
          agentRuntimes: { claudeCode: true }
        }
      }
    ],
    defaultChatModelId: 'claude-sonnet',
    ...overrides
  }
}
