import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

/**
 * PLAT-62 追加：探针命中 Anthropic 协议不支持时，
 * lane 与最终结论都要是 `protocol-unsupported`，不能再说「该模型未启用 Claude Code 运行时」。
 */
function createProviderState(includeClaudeCodeCapability: boolean): ProviderState {
  return {
    providers: [
      {
        id: 'aionly',
        name: 'AIOnly',
        endpoints: [
          { protocol: 'messages', baseUrl: 'https://api.aionly.test' }
        ],
        enabled: true,
        baseUrl: 'https://api.aionly.test',

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
              ...(includeClaudeCodeCapability ? { agentRuntimes: { claudeCode: true } } : {})
            }
          }
        ],
        defaultChatModelId: 'glm-4.6'
      }
    ]
  }
}

const protocolSummary =
  'HTTP 500 · 模型 glm-4.6 下无渠道支持messages协议，请注意使用的接口协议'

function createService(options: {
  providerState: ProviderState
  probeStatus: 'unknown' | 'protocol-unsupported'
  writeReport: ReturnType<typeof vi.fn>
}) {
  const fetch = vi.fn(async () => new Response(
    JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    { status: 200 }
  ))
  const probe = vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
    route: input.route,
    providerId: 'aionly',
    modelId: 'glm-4.6',
    runtimeId: 'claude-code' as const,
    signature: `${input.route}-sig`,
    checkedAt: '2026-08-01T00:00:00.000Z',
    status: options.probeStatus,
    message: protocolSummary
  }))
  return createProviderRuntimeCheckService({
    getProviderState: async () => options.providerState,
    fetch,
    probeService: { probe, invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
    gatewayService: {
      getSnapshot: () => ({ enabled: false, state: 'disabled', updatedAt: '2026-08-01T00:00:00.000Z' }),
      syncProviderConfig: vi.fn()
    } as unknown as AgentModelGatewayService,
    snapshotStore: { writeReport: options.writeReport } as unknown as AgentRuntimeProbeSnapshotStore
  })
}

describe('ProviderRuntimeCheckService protocol unsupported', () => {
  it('overrides a model-not-enabled verdict when the probe hit the messages protocol', async () => {
    const writeReport = vi.fn(async (report) => report)
    const service = createService({
      providerState: createProviderState(false),
      probeStatus: 'unknown',
      writeReport
    })

    const report = await service.runChecks({ providerId: 'aionly', modelId: 'glm-4.6' })

    expect(report.direct?.failureCode).toBe('protocol_unsupported')
    expect(report.finalCompatibility.status).toBe('protocol-unsupported')
    expect(report.finalCompatibility.summary).not.toContain('not enabled for Claude Code')
    expect(report.finalCompatibility.selectable).toBe(false)
  })

  it('keeps a protocol-unsupported probe verdict even when the model has the runtime capability', async () => {
    const writeReport = vi.fn(async (report) => report)
    const service = createService({
      providerState: createProviderState(true),
      probeStatus: 'protocol-unsupported',
      writeReport
    })

    const report = await service.runChecks({ providerId: 'aionly', modelId: 'glm-4.6' })

    expect(report.direct?.failureCode).toBe('protocol_unsupported')
    expect(report.finalCompatibility.status).toBe('protocol-unsupported')
  })
})
