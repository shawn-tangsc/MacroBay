import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '../../providers/modelProviderTypes'
import { createAgentStoreState } from '../store/agentStore'
import { createPlatformAgentSeed } from './defaultAgentSeed'

describe('platform agent seed', () => {
  it('creates a generic default assistant without product-specific wording', () => {
    const state = createAgentStoreState(createPlatformAgentSeed())
    const serialized = JSON.stringify(state)

    expect(state.agents).toHaveLength(1)
    expect(state.sessions).toHaveLength(1)
    expect(state.mcpServers.map((server) => server.id)).toEqual(['builtin-filesystem', 'builtin-git'])
    expect(state.mcpToolsByServerId['builtin-filesystem'].map((tool) => tool.name)).toEqual([
      'read_file',
      'list_directory',
      'search_files'
    ])
    expect(state.mcpToolsByServerId['builtin-git'].map((tool) => tool.name)).toEqual(['status', 'log', 'diff'])
    expect(state.mcpServers.every((server) => server.installSource === 'builtin')).toBe(true)
    expect(state.activeAgentId).toBe('default-assistant')
    expect(state.activeSessionId).toBe('default-assistant-session')
    expect(serialized).not.toMatch(/交易|复盘|行情|Binance|MACD|订单流|BTC|ETH/)
  })

  it('selects only a ready Claude Code compatible model for the default assistant', () => {
    const state = createAgentStoreState(
      createPlatformAgentSeed([
        provider({
          id: '302ai',
          name: '302.AI',
          endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' },
          { protocol: 'messages', baseUrl: 'https://api.302.ai' }
        ],
          models: [
            model('o3', 'o3'),
            model('claude-sonnet-4-20250514', 'Claude Sonnet 4', true)
          ],
          defaultChatModelId: 'o3'
        })
      ])
    )

    expect(state.agents[0]?.model).toBe('302ai:claude-sonnet-4-20250514')
    expect(state.agents[0]?.modelName).toBe('302.AI / Claude Sonnet 4')
  })

  it('selects configured official DeepSeek Anthropic models for the default assistant', () => {
    const state = createAgentStoreState(
      createPlatformAgentSeed([
        provider({
          id: 'deepseek',
          name: 'deepseek',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          baseUrl: 'https://api.deepseek.com',

          models: [
            model('deepseek-v4-flash', 'deepseek-v4-flash', true),
            model('deepseek-v4-pro', 'deepseek-v4-pro', true)
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        })
      ])
    )

    expect(state.agents[0]?.model).toBe('deepseek:deepseek-v4-pro')
    expect(state.agents[0]?.modelName).toBe('deepseek / deepseek-v4-pro')
  })

  it('prefers a provider default chat model that is explicitly agent-capable over another provider fallback model', () => {
    const state = createAgentStoreState(
      createPlatformAgentSeed([
        provider({
          id: 'silicon',
          name: 'Silicon',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' } as const,
            { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' } as const
          ],
          baseUrl: 'https://api.siliconflow.cn',

          models: [
            model('deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2', false),
            model('deepseek-ai/DeepSeek-V3.1-Terminus', 'DeepSeek V3.1 Terminus', true)
          ],
          defaultChatModelId: 'deepseek-ai/DeepSeek-V3.2'
        }),
        provider({
          id: 'deepseek',
          name: 'deepseek',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          baseUrl: 'https://api.deepseek.com',

          models: [
            model('deepseek-v4-flash', 'deepseek-v4-flash', true),
            model('deepseek-v4-pro', 'deepseek-v4-pro', true)
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        })
      ])
    )

    expect(state.agents[0]?.model).toBe('deepseek:deepseek-v4-pro')
    expect(state.agents[0]?.modelName).toBe('deepseek / deepseek-v4-pro')
  })

  it('keeps the default assistant unconfigured when providers are not ready or compatible', () => {
    const state = createAgentStoreState(
      createPlatformAgentSeed([
        provider({
          id: 'openai',
          name: 'OpenAI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: '' } as const
          ],
          models: [model('gpt-5', 'GPT-5')]
        }),
        provider({
          id: 'anthropic',
          name: 'Anthropic',
          endpoints: [
            { protocol: 'messages', baseUrl: '' } as const
          ],
          hasApiKey: false,
          models: [model('claude-sonnet', 'Claude Sonnet')]
        })
      ])
    )

    expect(state.agents[0]?.model).toBe('unconfigured:default-chat-model')
  })

  it('creates Chinese fallback seed text by default and English when locale is en-US', () => {
    const zh = createAgentStoreState(createPlatformAgentSeed())
    expect(zh.agents[0]?.name).toBe('默认助手')
    expect(zh.messagesBySessionId[zh.activeSessionId!]?.[0]?.searchableText).toContain('你好')

    const en = createAgentStoreState(createPlatformAgentSeed([], { locale: 'en-US' }))
    expect(en.agents[0]?.name).toBe('Default Assistant')
    expect(en.messagesBySessionId[en.activeSessionId!]?.[0]?.searchableText).toContain('Hello')
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

function model(id: string, name: string, claudeCode = false): SafeModelProvider['models'][number] {
  return {
    id,
    name,
    capabilities: {
      chat: true,
      vision: false,
      embedding: false,
      tools: true,
      ...(claudeCode ? { agentRuntimes: { claudeCode: true } } : {})
    }
  }
}
