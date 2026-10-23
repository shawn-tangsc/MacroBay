import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

/**
 * PLAT-63 第二阶段 A：`endpoints` 里声明了 `gemini` 时，报告要再多一条 Gemini 原生 lane
 * （与 Responses 同构），聊天主链路仍然只走 chat/completions；未配置不产出 lane。
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

function createService(
  providerState: ProviderState,
  fetchImpl: typeof fetch
): ReturnType<typeof createProviderRuntimeCheckService> {
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

function urlsOf(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => String(call[0]))
}

describe('ProviderRuntimeCheckService Gemini endpoint lane', () => {
  it('adds a Gemini lane next to the Responses lane and keeps chat on chat/completions', async () => {
    const providerState: ProviderState = {
      providers: [
        {
          ...baseProvider,
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'responses', baseUrl: 'https://api.deepseek.com/responses-base' } as const,
            { protocol: 'gemini', baseUrl: 'https://api.deepseek.com/gemini-base' } as const
          ]
        }
      ]
    }
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/responses')) return new Response('', { status: 200 })
      if (url.includes(':generateContent')) return new Response('', { status: 404 })
      return new Response('{"ok":true}', { status: 200 })
    })

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    const urls = urlsOf(fetchImpl)
    expect(urls).toContain('https://api.deepseek.com/v1/chat/completions')
    expect(urls).toContain('https://api.deepseek.com/responses-base/v1/responses')
    expect(urls).toContain(
      'https://api.deepseek.com/gemini-base/v1beta/models/deepseek-chat:generateContent'
    )
    expect(report.ordinaryChat.status).toBe('ready')
    expect(report.responses?.verdict).toBe('available')
    expect(report.gemini?.verdict).toBe('missing')
    expect(report.gemini?.status).toBe(404)
  })

  it('omits the Gemini lane when only Responses is configured and vice versa', async () => {
    const responsesOnly: ProviderState = {
      providers: [{ ...baseProvider, endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'responses', baseUrl: 'https://api.deepseek.com/responses-base' } as const
        ] }]
    }
    const responsesFetch = vi.fn(async (url: string) =>
      url.includes('/responses') ? new Response('', { status: 401 }) : new Response('{"ok":true}', { status: 200 })
    )
    const responsesReport = await createService(
      responsesOnly,
      responsesFetch as unknown as typeof fetch
    ).runChecks({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    expect(responsesReport.responses?.verdict).toBe('exists_auth_failed')
    expect(responsesReport.gemini).toBeUndefined()
    expect(urlsOf(responsesFetch).some((url) => url.includes(':generateContent'))).toBe(false)

    const geminiOnly: ProviderState = {
      providers: [{ ...baseProvider, endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'gemini', baseUrl: 'https://api.deepseek.com/gemini-base' } as const
        ] }]
    }
    const geminiFetch = vi.fn(async (url: string) =>
      url.includes(':generateContent') ? new Response('', { status: 400 }) : new Response('{"ok":true}', { status: 200 })
    )
    const geminiReport = await createService(geminiOnly, geminiFetch as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(geminiReport.gemini?.verdict).toBe('exists_param_error')
    expect(geminiReport.responses).toBeUndefined()
    expect(urlsOf(geminiFetch).some((url) => url.includes('/responses'))).toBe(false)
  })

  it('adds no Gemini lane at all when the endpoint is not configured', async () => {
    const providerState: ProviderState = { providers: [baseProvider] }
    const fetchImpl = vi.fn(async (_url: string) => new Response('{"ok":true}', { status: 200 }))

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(report.gemini).toBeUndefined()
    expect(urlsOf(fetchImpl).some((url) => url.includes(':generateContent'))).toBe(false)
  })

  it('never puts the API key into the Gemini lane message or the fetch URL', async () => {
    const providerState: ProviderState = {
      providers: [{ ...baseProvider, endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
          { protocol: 'gemini', baseUrl: 'https://api.deepseek.com/gemini-base' } as const
        ] }]
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes(':generateContent')
        ? new Response(JSON.stringify({ error: { message: 'API key not valid: secret-key' } }), { status: 401 })
        : new Response('{"ok":true}', { status: 200 })
    )

    const report = await createService(providerState, fetchImpl as unknown as typeof fetch).runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(report.gemini?.message).toContain('HTTP 401')
    expect(report.gemini?.message).not.toContain('secret-key')
    expect(urlsOf(fetchImpl).some((url) => url.includes('secret-key'))).toBe(false)
  })
})
