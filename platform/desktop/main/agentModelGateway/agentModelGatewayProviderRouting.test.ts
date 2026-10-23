import { describe, expect, it } from 'vitest'

import type { ModelDefinition, ModelProvider } from '../../../ai/providers/modelProviderTypes'
import {
  determineAgentModelGatewayApiType,
  formatOpenAiGatewayUrl,
  getAgentModelGatewayBaseUrlForApiType,
  resolveAgentModelGatewayProviderRoute
} from './agentModelGatewayProviderRouting'

describe('agentModelGatewayProviderRouting', () => {
  it('selects Anthropic Messages for Anthropic protocol providers', () => {
    const provider = providerBase({ endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }], baseUrl: 'https://api.anthropic.com' })
    expect(determineAgentModelGatewayApiType(provider, chatModel())).toBe('anthropic-messages')
    expect(getAgentModelGatewayBaseUrlForApiType(provider, 'anthropic-messages')).toBe('https://api.anthropic.com')
  })

  it('keeps OpenAI-compatible relay providers on the OpenAI gateway route even when anthropicBaseUrl exists', () => {
    const provider = providerBase({
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
        { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
      ],
      baseUrl: 'https://api.deepseek.com',
    })

    expect(resolveAgentModelGatewayProviderRoute(provider, chatModel('deepseek-chat'))).toEqual({
      apiType: 'openai-chat-completions',
      baseUrl: 'https://api.deepseek.com/v1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })
  })

  it('selects OpenAI responses for openai-response protocol providers', () => {
    const provider = providerBase({ endpoints: [{ protocol: 'responses', baseUrl: 'https://api.openai.com' }], baseUrl: 'https://api.openai.com' })
    expect(determineAgentModelGatewayApiType(provider, chatModel())).toBe('openai-responses')
  })

  it('formats OpenAI gateway URLs consistently with local presets', () => {
    expect(formatOpenAiGatewayUrl(providerBase({ baseUrl: 'https://api.openai.com' }))).toBe('https://api.openai.com/v1')
    expect(
      formatOpenAiGatewayUrl(
        providerBase({
          endpoints: [
            { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
          ],
          baseUrl: 'https://generativelanguage.googleapis.com'
        })
      )
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })
})

function providerBase(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' }
    ],
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
    models: [],
    ...overrides
  }
}

function chatModel(id = 'deepseek-chat'): ModelDefinition {
  return {
    id,
    name: id,
    capabilities: {
      chat: true,
      vision: false,
      embedding: false,
      tools: true
    }
  }
}
