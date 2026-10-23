import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider, ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

/**
 * PLAT-66：默认端点就是原生 `gemini` 的供应商，「普通聊天」必须走**原生**探针
 * （`/v1beta/models/{model}:generateContent`），而不是 OpenAI 兼容的 `/v1/chat/completions`
 * （Google 原生 API 上没有那个路径，必然 404）。
 */
const GEMINI_HOST = 'https://generativelanguage.googleapis.com'

function geminiProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'gemini',
    name: 'Gemini',
    endpoints: [
      { protocol: 'gemini', baseUrl: GEMINI_HOST }
    ],
    enabled: true,
    baseUrl: GEMINI_HOST,
    apiKey: 'fixture-gemini-key-1234567890',
    models: [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        capabilities: { chat: true, vision: false, embedding: false, tools: false },
        chatProtocol: 'gemini'
      }
    ],
    defaultChatModelId: 'gemini-2.5-flash',
    ...overrides
  }
}

function createService(provider: ModelProvider, fetch: ReturnType<typeof vi.fn>) {
  const state: ProviderState = { providers: [provider] }
  return createProviderRuntimeCheckService({
    getProviderState: async () => state,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => new Date('2026-10-19T00:00:00.000Z'),
    probeService: { probe: vi.fn(), invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
    gatewayService: {
      getSnapshot: () => ({ enabled: false, state: 'disabled', updatedAt: '2026-10-19T00:00:00.000Z' }),
      syncProviderConfig: vi.fn()
    } as unknown as AgentModelGatewayService,
    snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
  })
}

describe('PLAT-66 Gemini 连接检查走原生探针', () => {
  it('probes the gemini native generateContent endpoint for ordinary chat', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }))
    const service = createService(geminiProvider(), fetch)

    const report = await service.runChecks({
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      runtimeId: 'openai-agents'
    })

    const urls = fetch.mock.calls.map((call) => String((call as unknown[])[0]))
    expect(urls).toContain(`${GEMINI_HOST}/v1beta/models/gemini-2.5-flash:generateContent`)
    // 绝不再打 OpenAI 兼容的 chat/completions。
    expect(urls.some((url) => url.includes('/chat/completions'))).toBe(false)
    expect(report.ordinaryChat.status).toBe('ready')
    // 主端点就是原生端点 ⇒ 不再重复产出 Gemini 端点 lane。
    expect(report.gemini).toBeUndefined()
  })

  it('explains a missing native endpoint without any request', async () => {
    const fetch = vi.fn()
    const service = createService(
      // 已声明但没配地址（空串）⇒ 原生端点缺失，不发任何请求。
      geminiProvider({ endpoints: [{ protocol: 'gemini', baseUrl: '' }] }),
      fetch
    )

    const report = await service.runChecks({
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      runtimeId: 'openai-agents'
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(report.ordinaryChat.failureCode).toBe('gemini_native_endpoint_missing')
    expect(report.ordinaryChat.status).not.toBe('ready')
  })

  it('classifies a retired-model reply from the native endpoint', async () => {
    const retired = 'Model gemini-2.0-flash has been retired and is no longer available.'
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: retired } }),
      { status: 502 }
    ))
    const service = createService(geminiProvider(), fetch)

    const report = await service.runChecks({
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      runtimeId: 'openai-agents'
    })

    // 原生探针同样复用统一分类（不走 OpenAI 链路也能得出「已下线」）。
    expect(report.ordinaryChat.failureCode).toBe('model_retired')
  })
})
