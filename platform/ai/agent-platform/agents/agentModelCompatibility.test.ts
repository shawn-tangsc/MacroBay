import { describe, expect, it } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '../../providers/modelProviderTypes'
import { isAgentCompatibleModel, isAgentCompatibleProvider } from './agentModelCompatibility'

const chatCapabilities = {
  chat: true,
  vision: false,
  embedding: false,
  tools: true
}

describe('agent model compatibility', () => {
  it('requires ready Anthropic-shape providers before models can be selected for Claude Code agents', () => {
    const readyProvider = provider({
      id: 'anthropic',
      name: 'Anthropic',
      endpoints: [
        { protocol: 'messages', baseUrl: 'https://api.anthropic.com' } as const
      ],
    })

    expect(isAgentCompatibleProvider(readyProvider, 'claude-code', { requireReadyProvider: true })).toBe(true)
    expect(isAgentCompatibleProvider({ ...readyProvider, enabled: false }, 'claude-code', { requireReadyProvider: true })).toBe(false)
    expect(isAgentCompatibleProvider({ ...readyProvider, hasApiKey: false }, 'claude-code', { requireReadyProvider: true })).toBe(false)
    expect(
      isAgentCompatibleProvider(provider({ id: 'openai', name: 'OpenAI', endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.openai.com' } as const] }), 'claude-code', {
        requireReadyProvider: true
      })
    ).toBe(false)
  })

  it('requires explicit Claude Code runtime support on mixed Anthropic endpoint provider models', () => {
    const compatibleProvider = provider({
      id: '302ai',
      name: '302.AI',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.302.ai' }
        ]
    })
    const models = [
      model('deepseek-chat', 'DeepSeek Chat', 'DeepSeek'),
      model('chatgpt-4o-latest', 'ChatGPT 4o Latest', 'OpenAI'),
      model('o3', 'o3', 'OpenAI'),
      model('qwen3-235b-a22b', 'Qwen3 235B', 'Qwen'),
      model('gemini-2.5-pro-preview-06-05', 'Gemini 2.5 Pro Preview', 'Gemini'),
      model('claude-sonnet-4-20250514', 'Claude Sonnet 4', 'Anthropic', {
        ...chatCapabilities,
        agentRuntimes: { claudeCode: true }
      })
    ]

    expect(models.filter((item) => isAgentCompatibleModel(compatibleProvider, item, 'claude-code')).map((item) => item.id)).toEqual([
      'claude-sonnet-4-20250514'
    ])
  })

  it('does not expose Silicon models unless the user explicitly enables Claude Code runtime support', () => {
    const siliconProvider = provider({
      id: 'silicon',
      name: 'SiliconFlow',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
        ]
    })
    const models = [
      model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 'deepseek-ai'),
      model('deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 'deepseek-ai'),
      model('Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B A22B', 'Qwen')
    ]

    expect(models.filter((item) => isAgentCompatibleModel(siliconProvider, item, 'claude-code')).map((item) => item.id)).toEqual([])
    expect(
      isAgentCompatibleModel(
        siliconProvider,
        model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 'deepseek-ai', {
          ...chatCapabilities,
          agentRuntimes: { claudeCode: true }
        }),
        'claude-code'
      )
    ).toBe(true)
  })

  it('allows official DeepSeek Anthropic endpoint models for Claude Code agents', () => {
    const deepseekProvider = provider({
      id: 'deepseek',
      name: 'deepseek',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
    })
    const models = [
      model('deepseek-v4-flash', 'deepseek-v4-flash', 'DeepSeek'),
      model('deepseek-v4-pro', 'deepseek-v4-pro', 'DeepSeek', {
        ...chatCapabilities,
        agentRuntimes: { claudeCode: true }
      }),
      model('deepseek-chat', 'deepseek-chat', 'DeepSeek', {
        ...chatCapabilities,
        agentRuntimes: { claudeCode: true }
      }),
      model('deepseek-reasoner', 'deepseek-reasoner', 'DeepSeek', {
        ...chatCapabilities,
        agentRuntimes: { claudeCode: true }
      }),
      model('gpt-5', 'GPT-5', 'OpenAI')
    ]

    expect(models.filter((item) => isAgentCompatibleModel(deepseekProvider, item, 'claude-code')).map((item) => item.id)).toEqual([
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner'
    ])
  })

  it('lets explicit agent capability override model-family heuristics on Anthropic-compatible endpoints', () => {
    const compatibleProvider = provider({
      id: '302ai',
      name: '302.AI',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.302.ai' }
        ]
    })

    expect(isAgentCompatibleModel(compatibleProvider, model('deepseek-chat', 'DeepSeek Chat'), 'claude-code')).toBe(false)
    expect(
      isAgentCompatibleModel(
        compatibleProvider,
        model('deepseek-chat', 'DeepSeek Chat', 'DeepSeek', {
          ...chatCapabilities,
          agentRuntimes: { claudeCode: true }
        }),
        'claude-code'
      )
    ).toBe(true)
  })

  it('keeps models hidden when Claude Code runtime support is absent or explicitly disabled', () => {
    const deepseekProvider = provider({
      id: 'deepseek',
      name: 'deepseek',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ]
    })

    expect(isAgentCompatibleModel(deepseekProvider, model('deepseek-v4-pro', 'deepseek-v4-pro'), 'claude-code')).toBe(false)
    expect(
      isAgentCompatibleModel(
        deepseekProvider,
        model('deepseek-v4-pro', 'deepseek-v4-pro', 'DeepSeek', {
          ...chatCapabilities,
          agentRuntimes: { claudeCode: false }
        }),
        'claude-code'
      )
    ).toBe(false)
  })

  it('keeps mixed relay and local Anthropic endpoints on Claude-family models only', () => {
    const openRouterProvider = provider({
      id: 'openrouter',
      name: 'OpenRouter',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://openrouter.ai/api' }
        ]
    })
    const lmStudioProvider = provider({
      id: 'lmstudio',
      name: 'LM Studio',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'http://localhost:1234' }
        ]
    })
    const customAnthropicProvider = provider({
      id: 'custom-anthropic-relay',
      name: 'Custom Anthropic Relay',
      endpoints: [
        { protocol: 'messages', baseUrl: 'https://api.anthropic.com' } as const
      ],
    })
    const models = [
      model('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 'Gemini'),
      model('qwen/qwen3-235b-a22b', 'Qwen3 235B', 'Qwen'),
      model('mistralai/mistral-large', 'Mistral Large', 'Mistral'),
      model('gpt-5', 'GPT-5', 'OpenAI'),
      model('anthropic/claude-sonnet-4', 'Claude Sonnet 4', 'Anthropic')
    ]

    expect(models.filter((item) => isAgentCompatibleModel(openRouterProvider, item, 'claude-code')).map((item) => item.id)).toEqual([])
    expect(models.filter((item) => isAgentCompatibleModel(lmStudioProvider, item, 'claude-code')).map((item) => item.id)).toEqual([])
    expect(
      models.filter((item) => isAgentCompatibleModel(customAnthropicProvider, item, 'claude-code')).map((item) => item.id)
    ).toEqual([])
    expect(
      isAgentCompatibleModel(
        customAnthropicProvider,
        model('anthropic/claude-sonnet-4', 'Claude Sonnet 4', 'Anthropic', {
          ...chatCapabilities,
          agentRuntimes: { claudeCode: true }
        }),
        'claude-code'
      )
    ).toBe(true)
  })

  it('filters non-chat models even when the provider is compatible', () => {
    const anthropicProvider = provider({
      id: 'anthropic',
      name: 'Anthropic',
      endpoints: [
        { protocol: 'messages', baseUrl: 'https://api.anthropic.com' } as const
      ],
    })

    expect(
      isAgentCompatibleModel(
        anthropicProvider,
        model('claude-sonnet', 'Claude Sonnet', undefined, {
          ...chatCapabilities,
          agentRuntimes: { claudeCode: true }
        }),
        'claude-code'
      )
    ).toBe(true)
    expect(isAgentCompatibleModel(anthropicProvider, model('gpt-5', 'GPT-5'), 'claude-code')).toBe(false)
    expect(
      isAgentCompatibleModel(
        anthropicProvider,
        model('text-embedding', 'Text Embedding', undefined, {
          chat: false,
          vision: false,
          embedding: true,
          tools: false
        }),
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
  group?: string,
  capabilities: ModelDefinition['capabilities'] = chatCapabilities
): ModelDefinition {
  return {
    id,
    name,
    group,
    capabilities
  }
}
