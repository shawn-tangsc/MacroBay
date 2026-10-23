import { describe, expect, it } from 'vitest'

import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { buildAgentModelProbeSignature } from './agentModelProbeSignature'

describe('agentModelProbeSignature', () => {
  it('includes provider, model, route, and secret version without exposing raw API keys', () => {
    const provider = baseProvider({
      apiKey: 'secret-key-value'
    })

    const signature = buildAgentModelProbeSignature({
      provider,
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })

    expect(signature).toContain('claude-code')
    expect(signature).toContain('direct')
    expect(signature).toContain('deepseek')
    expect(signature).toContain('deepseek-chat')
    expect(signature).not.toContain('secret-key-value')
  })

  it('changes signature when the API key changes', () => {
    const first = buildAgentModelProbeSignature({
      provider: baseProvider({ apiKey: 'first-key' }),
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })
    const second = buildAgentModelProbeSignature({
      provider: baseProvider({ apiKey: 'second-key' }),
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })

    expect(first).not.toBe(second)
  })

  it('includes gateway config version for gateway probes', () => {
    const signature = buildAgentModelProbeSignature({
      provider: baseProvider(),
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'gateway',
      gatewayConfigVersion: '3'
    })

    expect(signature.endsWith('|3')).toBe(true)
  })
})

function baseProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
      { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
    ],
    enabled: true,
    baseUrl: 'https://api.deepseek.com',

    apiKey: 'secret-key',
    models: [],
    ...overrides
  }
}
