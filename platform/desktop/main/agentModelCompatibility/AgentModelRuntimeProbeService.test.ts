import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'

const providerState: ProviderState = {
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
        { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
      ],
      enabled: true,
      baseUrl: 'https://api.deepseek.com',

      apiKey: 'secret-key',
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
    }
  ]
}

describe('AgentModelRuntimeProbeService', () => {
  it('caches probe snapshots by signature', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const service = new AgentModelRuntimeProbeService({
      fetch,
      now: () => new Date('2026-07-09T00:00:00.000Z')
    })

    const first = await service.probe({
      providerState,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })
    const second = await service.probe({
      providerState,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })

    expect(first).toBe(second)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached provider probes when provider settings change', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }))
    const service = new AgentModelRuntimeProbeService({
      fetch,
      now: () => new Date('2026-07-09T00:00:00.000Z')
    })

    await service.probe({
      providerState,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })

    service.invalidateProvider('deepseek')

    await service.probe({
      providerState: {
        providers: [
          {
            ...providerState.providers[0]!,
            apiKey: 'rotated-key'
          }
        ]
      },
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'direct'
    })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('invalidates gateway probe cache when gateway config version changes', async () => {
    const runGatewayProbe = vi.fn(async () => ({
      route: 'gateway' as const,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      signature: 'gateway-ready',
      checkedAt: '2026-07-09T00:00:00.000Z',
      status: 'ready' as const
    }))
    const service = new AgentModelRuntimeProbeService({
      fetch: vi.fn(),
      runGatewayProbe,
      now: () => new Date('2026-07-09T00:00:00.000Z')
    })

    await service.probe({
      providerState,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'gateway'
    })

    service.invalidateGateway()

    await service.probe({
      providerState,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      route: 'gateway'
    })

    expect(runGatewayProbe).toHaveBeenCalledTimes(2)
  })
})
