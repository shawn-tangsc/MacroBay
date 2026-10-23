import { describe, expect, it } from 'vitest'

import type { AgentProductToolPackageBinding } from '@platform/ai/agent-platform/productTools/productAgentToolSchemas'

import { createCryptoMarketAnalystAgentSeed } from './cryptoMarketAnalyst'

describe('crypto market analyst product seed', () => {
  it('uses one stable agent id without creating an ordinary session automatically', () => {
    const seed = createCryptoMarketAnalystAgentSeed()

    expect(seed.agents).toHaveLength(1)
    expect(seed.agents?.[0]).toMatchObject({
      id: 'crypto-market-analyst',
      type: 'claude-code',
      name: '数字货币市场解读员'
    })
    expect(seed.sessions).toEqual([])
    expect(seed.messagesBySessionId).toEqual({})
    expect(seed.agentSkills).toEqual([{ agentId: 'crypto-market-analyst', skillId: 'market-analysis-skill-v1', isEnabled: true }])
  })

  it('seeds the default read-only product tool package binding', () => {
    const seed = createCryptoMarketAnalystAgentSeed()
    const binding = seed.agentProductToolPackages?.[0] as AgentProductToolPackageBinding | undefined

    expect(binding).toEqual({
      agentId: 'crypto-market-analyst',
      productId: 'market-intelligence',
      permissionMode: 'allow-read-only',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('localizes the built-in copy for English workspaces', () => {
    const seed = createCryptoMarketAnalystAgentSeed([], { language: 'en-US' })
    const agent = seed.agents?.[0]

    expect(agent).toMatchObject({
      id: 'crypto-market-analyst',
      name: 'Crypto Market Analyst',
      description: 'Generates conditional analysis from traceable market evidence.'
    })
    expect(agent?.instructions).toContain('crypto market analyst')
    expect(agent?.modelName).toBe('No model selected')
  })

  it('keeps the model unconfigured until a compatible provider is available', () => {
    expect(createCryptoMarketAnalystAgentSeed().agents?.[0]?.model).toBe('unconfigured:default-chat-model')
    // 只有 chat/completions 端点、没有 messages 端点 ⇒ 不是 Claude Code 兼容供应商。
    const seed = createCryptoMarketAnalystAgentSeed([{
      id: 'chat-only',
      enabled: true,
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.test' }],
      baseUrl: 'https://example.test',
      hasApiKey: true,
      models: [{ id: 'chat', capabilities: { chat: true } }]
    }] as never)
    expect(seed.agents?.[0]?.model).toBe('unconfigured:default-chat-model')
    expect(seed.workspaces).toEqual([])
  })
})
