import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

/**
 * PLAT-63：`endpoints` 里声明了 `responses` 时，连接检查报告要在「普通聊天」之外
 * 多出一条 Responses 端点 lane（判定按端点语义），聊天主链路仍然只走 chat/completions。
 * 未配置时不产出该 lane。
 */
const baseProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const],
  enabled: true,
  // 主地址由端点派生；fixture 里显式写出便于断言。
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'secret-key',
  models: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
    }
  ],
  defaultChatModelId: 'deepseek-chat'
}

function createService(providerState: ProviderState, fetchImpl: typeof fetch): ReturnType<typeof createProviderRuntimeCheckService> {
  return createProviderRuntimeCheckService({
    getProviderState: async () => providerState,
    fetch: fetchImpl,
    now: () => new Date('2026-07-10T00:00:00.000Z'),
    probeService: {
      probe: vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
        route: input.route,
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        signature: `${input.route}-sig`,
        checkedAt: '2026-07-10T00:00:00.000Z',
        status: 'ready' as const,
        message: 'probe passed'
      })),
      invalidateGateway: vi.fn()
    } as unknown as AgentModelRuntimeProbeService,
    gatewayService: {
      getSnapshot: () => ({ enabled: false, state: 'disabled', port: 18779, updatedAt: '2026-07-10T00:00:00.000Z' }),
      syncProviderConfig: vi.fn()
    } as unknown as AgentModelGatewayService,
    snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
  })
}

describe('ProviderRuntimeCheckService Responses endpoint lane', () => {
  it('adds a Responses lane when the endpoint is configured and keeps chat on chat/completions', async () => {
    const providerState: ProviderState = {
      providers: [
        { ...baseProvider, endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'responses', baseUrl: 'https://api.deepseek.com/responses-base' } as const
        ] }
      ]
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/responses') ? new Response('', { status: 404 }) : new Response('{"ok":true}', { status: 200 })
    )

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]))
    expect(urls).toContain('https://api.deepseek.com/v1/chat/completions')
    expect(urls).toContain('https://api.deepseek.com/responses-base/v1/responses')
    expect(report.ordinaryChat.status).toBe('ready')
    expect(report.responses?.verdict).toBe('missing')
    expect(report.responses?.status).toBe(404)
  })

  it('classifies an auth failure on the Responses endpoint without failing ordinary chat', async () => {
    const providerState: ProviderState = {
      providers: [{ ...baseProvider, endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'responses', baseUrl: 'https://api.deepseek.com/responses-base' } as const
        ] }]
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/responses')
        ? new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 })
        : new Response('{"ok":true}', { status: 200 })
    )

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(report.ordinaryChat.status).toBe('ready')
    expect(report.responses?.verdict).toBe('exists_auth_failed')
    expect(report.responses?.message).toContain('HTTP 401')
  })

  it('omits the Responses lane when the endpoint is not configured', async () => {
    const providerState: ProviderState = { providers: [baseProvider] }
    const fetchImpl = vi.fn(async (_url: string) => new Response('{"ok":true}', { status: 200 }))

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(report.responses).toBeUndefined()
    expect(fetchImpl.mock.calls.every((call) => !String(call[0]).includes('/responses'))).toBe(true)
  })
})
