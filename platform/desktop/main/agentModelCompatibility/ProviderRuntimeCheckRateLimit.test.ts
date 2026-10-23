import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

/**
 * PLAT-62：Z.ai 免费模型 429（overloaded_error / 1305）时，
 * Claude Code 兼容性检查的 lane 必须带 `rate_limited`，且 summary 保留精简后的 request_id。
 */
const providerState: ProviderState = {
  providers: [
    {
      id: 'zai',
      name: 'Z.AI',
      endpoints: [
        { protocol: 'messages', baseUrl: 'https://api.z.ai/api/anthropic' }
      ],
      enabled: true,
      baseUrl: 'https://api.z.ai/api/anthropic',

      apiKey: 'secret-key',
      models: [
        {
          id: 'glm-4.6',
          name: 'GLM-4.6',
          capabilities: {
            chat: true,
            vision: false,
            embedding: false,
            tools: true,
            agentRuntimes: { claudeCode: true }
          }
        }
      ],
      defaultChatModelId: 'glm-4.6'
    }
  ]
}

const overloadedSummary =
  'HTTP 429 · overloaded_error (1305) · The service may be temporarily overloaded · request_id req_abc123'

describe('ProviderRuntimeCheckService rate limiting', () => {
  it('marks an overloaded Claude Code probe lane as rate_limited', async () => {
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200 }
    ))
    const probe = vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
      route: input.route,
      providerId: 'zai',
      modelId: 'glm-4.6',
      runtimeId: 'claude-code' as const,
      signature: `${input.route}-sig`,
      checkedAt: '2026-08-01T00:00:00.000Z',
      status: 'unknown' as const,
      message: overloadedSummary
    }))
    const service = createProviderRuntimeCheckService({
      getProviderState: async () => providerState,
      fetch,
      probeService: { probe, invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: false, state: 'disabled', updatedAt: '2026-08-01T00:00:00.000Z' }),
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({ providerId: 'zai', modelId: 'glm-4.6' })

    expect(report.direct?.status).toBe('unknown')
    expect(report.direct?.failureCode).toBe('rate_limited')
    expect(report.direct?.summary).toContain('request_id req_abc123')
    expect(report.direct?.summary).not.toContain('{"')
  })

  it('does not label an unrelated probe failure as rate_limited', async () => {
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200 }
    ))
    const probe = vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
      route: input.route,
      providerId: 'zai',
      modelId: 'glm-4.6',
      runtimeId: 'claude-code' as const,
      signature: `${input.route}-sig`,
      checkedAt: '2026-08-01T00:00:00.000Z',
      status: 'network-error' as const,
      message: 'Direct Claude Code runtime probe failed with ECONNRESET.'
    }))
    const service = createProviderRuntimeCheckService({
      getProviderState: async () => providerState,
      fetch,
      probeService: { probe, invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: false, state: 'disabled', updatedAt: '2026-08-01T00:00:00.000Z' }),
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({ providerId: 'zai', modelId: 'glm-4.6' })

    expect(report.direct?.failureCode).toBeUndefined()
  })
})
