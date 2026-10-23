import { describe, expect, it } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '../../../providers/modelProviderTypes'
import {
  hasClaudeCodeRuntimeCapability,
  hasDeclaredClaudeCodeSupport,
  isAgentRuntimeProviderCompatible,
  isAgentRuntimeSelectable,
  isClaudeCodeAnthropicEndpointProvider,
  resolveAgentRuntimeCompatibility
} from './AgentRuntimeCompatibilityService'
import type { AgentRuntimeProbeSnapshot } from './agentRuntimeCompatibilityTypes'

const chatCapabilities = {
  chat: true,
  vision: false,
  embedding: false,
  tools: true
}

describe('AgentRuntimeCompatibilityService', () => {
  it('rejects disabled providers when readiness is required', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const], enabled: false }),
      model: claudeModel(),
      runtimeId: 'claude-code',
      requireReadyProvider: true
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('provider-disabled')
    expect(result.route).toBe('none')
  })

  it('rejects providers missing an API key when readiness is required', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const], hasApiKey: false }),
      model: claudeModel(),
      runtimeId: 'claude-code',
      requireReadyProvider: true
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('missing-api-key')
  })

  it('rejects providers without an Anthropic endpoint when gateway is disabled', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({ id: 'openai', name: 'OpenAI', endpoints: [{ protocol: 'chat-completions', baseUrl: '' } as const] }),
      model: claudeModel(),
      runtimeId: 'claude-code'
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('missing-endpoint')
    expect(result.route).toBe('none')
  })

  it('rejects non-chat and embedding models', () => {
    const anthropic = provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const] })

    expect(
      resolveAgentRuntimeCompatibility({
        provider: anthropic,
        model: model('gpt-5', 'GPT-5'),
        runtimeId: 'claude-code'
      }).status
    ).toBe('model-not-enabled')

    expect(
      resolveAgentRuntimeCompatibility({
        provider: anthropic,
        model: model('text-embedding', 'Text Embedding', {
          chat: false,
          vision: false,
          embedding: true,
          tools: false
        }),
        runtimeId: 'claude-code'
      }).status
    ).toBe('model-not-enabled')
  })

  it('rejects models without explicit Claude Code runtime capability', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
      }),
      model: model('deepseek-chat', 'DeepSeek Chat'),
      runtimeId: 'claude-code'
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('model-not-enabled')
  })

  it('allows the no-gateway safe subset when static checks pass', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: 'https://api.anthropic.com' } as const
        ],
        baseUrl: 'https://api.anthropic.com'
      }),
      model: claudeModel('claude-sonnet', 'Claude Sonnet'),
      runtimeId: 'claude-code',
      requireReadyProvider: true
    })

    expect(result.selectable).toBe(true)
    expect(result.route).toBe('direct')
    expect(result.status).toBe('ready')
  })

  it('allows Anthropic-compatible provider endpoints as direct after the direct probe passes', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
        ],
        baseUrl: 'https://api.deepseek.com',
      }),
      model: claudeModel('deepseek-v4-pro', 'DeepSeek V4 Pro'),
      runtimeId: 'claude-code',
      requireReadyProvider: true,
      directProbe: probeSnapshot('direct', 'ready', 'Direct Claude Code runtime probe passed.')
    })

    expect(result.selectable).toBe(true)
    expect(result.route).toBe('direct')
    expect(result.status).toBe('ready')
  })

  it('allows a declared Messages model to use its relay endpoint directly when no probe exists', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'tokenrhythm',
        name: 'TokenRhythm',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' } as const,
          { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' } as const
        ],
        baseUrl: 'https://tokenrhythm.studio'
      }),
      model: {
        ...claudeModel('deepseek-v4-flash', 'DeepSeek V4 Flash'),
        messagesSupport: 'yes',
        declarationSource: 'provider_list'
      },
      runtimeId: 'claude-code',
      requireReadyProvider: true
    })

    expect(result.selectable).toBe(true)
    expect(result.route).toBe('direct')
    expect(result.status).toBe('ready')
  })

  it('keeps the direct route when the direct probe is rate-limited and the model declares Messages', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'tokenrhythm',
        name: 'TokenRhythm',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' } as const,
          { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' } as const
        ],
        baseUrl: 'https://tokenrhythm.studio'
      }),
      model: {
        ...claudeModel('deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash'),
        messagesSupport: 'yes',
        declarationSource: 'provider_list'
      },
      runtimeId: 'claude-code',
      requireReadyProvider: true,
      directProbe: probeSnapshot('direct', 'unknown', 'HTTP 429 · rate_limit_error · 请求过于频繁')
    })

    // A 429 says nothing about whether the Messages endpoint works; it must not force the gateway.
    expect(result.selectable).toBe(true)
    expect(result.route).toBe('direct')
    expect(result.status).toBe('ready')
  })

  it('selects direct route when the direct probe passes', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const] }),
      model: claudeModel(),
      runtimeId: 'claude-code',
      directProbe: probeSnapshot('direct', 'ready')
    })

    expect(result.selectable).toBe(true)
    expect(result.route).toBe('direct')
    expect(result.status).toBe('ready')
    expect(result.checkedAt).toBe('2026-07-09T00:00:00.000Z')
  })

  it('selects gateway route when direct probe fails but gateway probe passes', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
      }),
      model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
      runtimeId: 'claude-code',
      gatewayEnabled: true,
      directProbe: probeSnapshot('direct', 'auth-failed', 'Direct auth failed'),
      gatewayProbe: probeSnapshot('gateway', 'ready', 'Gateway probe passed')
    })

    expect(result.selectable).toBe(true)
    expect(result.route).toBe('gateway')
    expect(result.status).toBe('ready')
  })

  it('returns gateway-required when a relay direct probe fails and gateway is disabled', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
      }),
      model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
      runtimeId: 'claude-code',
      directProbe: probeSnapshot('direct', 'auth-failed', '401 authentication_failed')
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('gateway-required')
    expect(result.route).toBe('gateway')
  })

  it('returns gateway-required when direct auth fails, gateway is enabled, but gateway probe is absent', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
      }),
      model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
      runtimeId: 'claude-code',
      gatewayEnabled: true,
      directProbe: probeSnapshot('direct', 'auth-failed', '401 authentication_failed')
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('gateway-required')
    expect(result.route).toBe('gateway')
  })

  it('maps stopped gateway probes to gateway-stopped', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
      }),
      model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
      runtimeId: 'claude-code',
      gatewayEnabled: true,
      gatewayProbe: probeSnapshot('gateway', 'unknown', 'Agent model gateway is stopped.')
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('gateway-stopped')
    expect(result.route).toBe('gateway')
  })

  it('maps protocol probe failures to protocol-unsupported', () => {
    const result = resolveAgentRuntimeCompatibility({
      provider: provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const] }),
      model: claudeModel(),
      runtimeId: 'claude-code',
      directProbe: probeSnapshot('direct', 'protocol-unsupported', 'Invalid response shape')
    })

    expect(result.selectable).toBe(false)
    expect(result.status).toBe('protocol-unsupported')
  })

  // PLAT-82：声明是事实源，legacy `probeStatus` 只作兜底，不能再反转声明。
  it('lets the provider declaration win over the legacy probe status', () => {
    const declaredYes = { ...model('glm-5', 'GLM-5'), messagesSupport: 'yes' as const, probeStatus: 'failed' as const, declarationSource: 'provider_list' as const }
    const declaredNo = { ...model('glm-5', 'GLM-5'), messagesSupport: 'no' as const, probeStatus: 'passed' as const, declarationSource: 'provider_list' as const }
    const responsesOnly = { ...model('glm-5', 'GLM-5'), declarationSource: 'provider_list' as const }
    const legacyPassed = { ...model('gemini-3', 'Gemini 3'), probeStatus: 'passed' as const }

    expect(hasClaudeCodeRuntimeCapability(declaredYes)).toBe(true)
    expect(hasClaudeCodeRuntimeCapability(declaredNo)).toBe(false)
    // 只声明了 responses 的模型不算 messages 可用。
    expect(hasClaudeCodeRuntimeCapability(responsesOnly)).toBe(false)
    // 迁移前的真实探测结论仍然认。
    expect(hasClaudeCodeRuntimeCapability(legacyPassed)).toBe(true)

    expect(hasDeclaredClaudeCodeSupport(declaredYes)).toBe(true)
    expect(hasDeclaredClaudeCodeSupport(declaredNo)).toBe(false)
    expect(hasDeclaredClaudeCodeSupport(legacyPassed)).toBe(true)
  })

  it('keeps OpenAI Agents runtime separate from Claude Code capability', () => {
    const openAiOnlyModel = model('gpt-5', 'GPT-5', {
      ...chatCapabilities,
      agentRuntimes: { openaiAgents: true }
    })

    const claudeOnlyModel = claudeModel('claude-sonnet-4', 'Claude Sonnet 4')

    expect(
      resolveAgentRuntimeCompatibility({
        provider: provider({ id: 'openai', name: 'OpenAI', endpoints: [{ protocol: 'chat-completions', baseUrl: '' } as const] }),
        model: openAiOnlyModel,
        runtimeId: 'openai-agents',
        requireReadyProvider: true
      })
    ).toMatchObject({
      selectable: false,
      route: 'none',
      status: 'unknown'
    })

    expect(
      resolveAgentRuntimeCompatibility({
        provider: provider({ id: 'anthropic', name: 'Anthropic', endpoints: [{ protocol: 'messages', baseUrl: '' } as const] }),
        model: claudeOnlyModel,
        runtimeId: 'openai-agents'
      })
    ).toMatchObject({
      selectable: false,
      status: 'model-not-enabled'
    })

    expect(hasClaudeCodeRuntimeCapability(claudeOnlyModel)).toBe(true)
    expect(isClaudeCodeAnthropicEndpointProvider(provider({ id: 'openai', name: 'OpenAI', endpoints: [{ protocol: 'chat-completions', baseUrl: '' } as const] }))).toBe(false)
  })

  it('exposes helper selectors that match legacy agent model compatibility behavior', () => {
    const deepseekProvider = provider({
      id: 'deepseek',
      name: 'DeepSeek',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
    })

    expect(isAgentRuntimeProviderCompatible(deepseekProvider, 'claude-code', true)).toBe(true)
    expect(
      isAgentRuntimeSelectable(
        {
          provider: deepseekProvider,
          model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
          runtimeId: 'claude-code',
          requireReadyProvider: true
        },
        'claude-code'
      )
    ).toBe(false)
    expect(
      isAgentRuntimeSelectable(
        {
          provider: deepseekProvider,
          model: claudeModel('deepseek-chat', 'DeepSeek Chat'),
          runtimeId: 'claude-code',
          requireReadyProvider: true,
          gatewayEnabled: true,
          gatewayProbe: probeSnapshot('gateway', 'ready', 'Gateway probe passed')
        },
        'claude-code'
      )
    ).toBe(true)
    expect(
      isAgentRuntimeSelectable(
        {
          provider: deepseekProvider,
          model: model('deepseek-chat', 'DeepSeek Chat'),
          runtimeId: 'claude-code',
          requireReadyProvider: true
        },
        'claude-code'
      )
    ).toBe(false)
  })
})

function provider(input: Partial<SafeModelProvider> & Pick<SafeModelProvider, 'id' | 'name'>): SafeModelProvider {
  return {
    id: input.id,
    name: input.name,
    enabled: input.enabled ?? true,
    endpoints: input.endpoints ?? [{ protocol: 'chat-completions', baseUrl: 'https://example.test' }],
    baseUrl: input.baseUrl ?? 'https://example.test',
    hasApiKey: input.hasApiKey ?? true,
    apiKeyPreview: input.apiKeyPreview ?? 'sk...test',
    isSystem: input.isSystem ?? true,
    websites: input.websites,
    models: input.models ?? [],
    defaultChatModelId: input.defaultChatModelId
  }
}

function model(
  id: string,
  name: string,
  capabilities: ModelDefinition['capabilities'] = chatCapabilities
): ModelDefinition {
  return {
    id,
    name,
    capabilities
  }
}

function claudeModel(id = 'claude-sonnet-4', name = 'Claude Sonnet 4'): ModelDefinition {
  return model(id, name, {
    ...chatCapabilities,
    agentRuntimes: { claudeCode: true }
  })
}

function probeSnapshot(
  route: AgentRuntimeProbeSnapshot['route'],
  status: AgentRuntimeProbeSnapshot['status'],
  message?: string
): AgentRuntimeProbeSnapshot {
  return {
    route,
    status,
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    runtimeId: 'claude-code',
    signature: `${route}:${status}`,
    checkedAt: '2026-07-09T00:00:00.000Z',
    ...(message ? { message } : {})
  }
}
