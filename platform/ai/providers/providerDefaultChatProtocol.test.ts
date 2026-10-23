import { describe, expect, it } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { createSystemProviderPresets } from './providerPresets'
import { normalizeProviderState } from './providerStore'
import { buildResponsesUrl } from './providerEndpoints'
import { resolveProviderChatBase } from './providerChatEndpoints'

/**
 * PLAT-69：每个协议各自的**默认链路** = 供应商端点清单的**第一条**（`endpoints[0]`）。
 *
 * | 供应商 | 默认端点（`endpoints[0]`） | 端点 |
 * | Anthropic 官方 | messages | /v1/messages |
 * | OpenAI 官方 | responses | /v1/responses |
 * | Gemini 官方 | gemini | :generateContent |
 * | 中转/聚合/兼容 | chat-completions | /v1/chat/completions |
 *
 * 模型没声明协议时运行时跟随 `endpoints[0]`；模型记录里只写**快照**（同步/新增那一刻的值）。
 */
function preset(id: string): ModelProvider {
  const found = createSystemProviderPresets().find((provider) => provider.id === id)
  if (!found) throw new Error(`Missing preset ${id}`)
  return found
}

function modelsOf(
  state: ReturnType<typeof normalizeProviderState>,
  providerId: string,
  modelId: string
): { chatProtocol?: string } | undefined {
  return state.providers.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId)
}

describe('PLAT-69 每个协议的默认聊天链路', () => {
  it('defaults the official Anthropic provider to the messages protocol', () => {
    const anthropic = preset('anthropic')

    expect(anthropic.baseUrl).toBe('https://api.anthropic.com')
    expect(anthropic.endpoints).toEqual([{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }])
    expect(anthropic.endpoints[0]?.protocol).toBe('messages')
    const chatModels = anthropic.models.filter((model) => model.capabilities.chat)
    expect(chatModels.length).toBeGreaterThan(0)
    for (const model of chatModels) expect(model.chatProtocol, model.id).toBe('messages')
  })

  it('defaults the official OpenAI provider to the responses protocol', () => {
    const openai = preset('openai')

    expect(openai.endpoints[0]?.protocol).toBe('responses')
    expect(resolveProviderChatBase(openai, 'responses')).toBe('https://api.openai.com/v1')
    const chatModels = openai.models.filter((model) => model.capabilities.chat)
    expect(chatModels.length).toBeGreaterThan(0)
    for (const model of chatModels) expect(model.chatProtocol, model.id).toBe('responses')
    // `/v1` base 不能再拼出 `/v1/v1/responses`。
    expect(buildResponsesUrl(resolveProviderChatBase(openai, 'responses') ?? ''))
      .toBe('https://api.openai.com/v1/responses')
  })

  it('keeps the gemini preset on the native protocol', () => {
    const gemini = preset('gemini')

    expect(gemini.endpoints[0]?.protocol).toBe('gemini')
    expect(gemini.baseUrl).toBe('https://generativelanguage.googleapis.com')
    for (const model of gemini.models.filter((entry) => entry.capabilities.chat)) {
      expect(model.chatProtocol, model.id).toBe('gemini')
    }
  })

  it('keeps every relay / aggregator provider on the default chat-completions chain', () => {
    // 只允许三家官方预设改默认链路；中转/聚合/兼容（含豆包：工具与流式在 chat 链路上）
    // 的默认端点与预设模型协议都保持 chat/completions（出站请求不变）。
    const official = new Set(['anthropic', 'openai', 'gemini'])
    for (const provider of createSystemProviderPresets()) {
      if (official.has(provider.id)) continue
      expect(provider.endpoints[0]?.protocol, provider.id).toBe('chat-completions')
      for (const model of provider.models.filter((entry) => entry.capabilities.chat)) {
        expect(model.chatProtocol, `${provider.id}/${model.id}`).toBe('chat-completions')
      }
    }
  })

  it('applies the provider default endpoint to persisted models that never chose a protocol', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }],
          enabled: true,
          apiKey: 'sk-ant-fixture',
          models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', capabilities: { chat: true } }]
        },
        {
          id: 'openai',
          name: 'OpenAI',
          endpoints: [{ protocol: 'responses', baseUrl: 'https://api.openai.com/v1' }],
          enabled: true,
          apiKey: 'sk-fixture',
          models: [{ id: 'gpt-5', name: 'GPT 5', capabilities: { chat: true } }]
        }
      ]
    })

    expect(modelsOf(state, 'anthropic', 'claude-sonnet-4-6')?.chatProtocol).toBe('messages')
    expect(modelsOf(state, 'openai', 'gpt-5')?.chatProtocol).toBe('responses')
    // 端点清单属于用户库：用户已有的 responses 端点（含地址）原样保留、默认位置不变；
    // 预设里用户没配过的 chat/completions 追加到末尾（预设新增协议自动补进）。
    expect(state.providers.find((provider) => provider.id === 'openai')?.endpoints)
      .toEqual([
        { protocol: 'responses', baseUrl: 'https://api.openai.com/v1' },
        { protocol: 'chat-completions', baseUrl: 'https://api.openai.com' }
      ])
  })

  it('keeps an explicitly chosen protocol on persisted models', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          endpoints: [
            { protocol: 'messages', baseUrl: 'https://api.anthropic.com' },
            { protocol: 'chat-completions', baseUrl: 'https://api.anthropic.com' }
          ],
          enabled: true,
          apiKey: 'sk-ant-fixture',
          models: [
            {
              id: 'claude-sonnet-4-6',
              name: 'Claude Sonnet 4.6',
              capabilities: { chat: true },
              chatProtocol: 'chat-completions'
            }
          ]
        }
      ]
    })

    const models = state.providers.find((provider) => provider.id === 'anthropic')?.models ?? []
    expect(models.find((model) => model.id === 'claude-sonnet-4-6')?.chatProtocol).toBe('chat-completions')
  })
})
