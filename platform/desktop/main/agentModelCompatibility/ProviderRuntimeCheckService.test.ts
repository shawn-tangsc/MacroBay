import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from './ProviderRuntimeCheckService'

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

describe('ProviderRuntimeCheckService', () => {
  it('reports chat success with direct auth failure and gateway unavailable', async () => {
    const writeReport = vi.fn(async (report) => report)
    const syncProviderConfig = vi.fn()
    const invalidateGateway = vi.fn()
    const probe = vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
      route: input.route,
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      signature: `${input.route}-sig`,
      checkedAt: '2026-07-10T00:00:00.000Z',
      status: input.route === 'direct' ? ('auth-failed' as const) : ('unknown' as const),
      message:
        input.route === 'direct'
          ? 'Direct Claude Code authentication failed.'
          : 'Agent model gateway is disabled.'
    }))

    const service = createProviderRuntimeCheckService({
      getProviderState: async () => providerState,
      fetch: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      probeService: {
        probe,
        invalidateGateway
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: false,
          state: 'disabled',
          port: 18779,
          updatedAt: '2026-07-10T00:00:00.000Z'
        }),
        syncProviderConfig
      } as unknown as AgentModelGatewayService,
      snapshotStore: {
        writeReport
      } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      checkGateway: true
    })

    expect(report.ordinaryChat.status).toBe('ready')
    expect(report.direct?.status).toBe('auth-failed')
    expect(report.gateway?.status).toBe('gateway-required')
    expect(report.finalCompatibility.selectable).toBe(false)
    expect(writeReport).toHaveBeenCalledWith(report)
    expect(syncProviderConfig).toHaveBeenCalled()
    expect(invalidateGateway).toHaveBeenCalled()
  })

  it('carries the decidable failure code of the ordinary chat probe into the report', async () => {
    const service = createProviderRuntimeCheckService({
      getProviderState: async () => providerState,
      fetch: vi.fn(async () => new Response('', { status: 401 })),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      probeService: {
        probe: vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
          route: input.route,
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
          runtimeId: 'claude-code' as const,
          signature: `${input.route}-sig`,
          checkedAt: '2026-07-10T00:00:00.000Z',
          status: 'auth-failed' as const,
          message: 'Direct Claude Code authentication failed.'
        })),
        invalidateGateway: vi.fn()
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: false, state: 'disabled', port: 18779, updatedAt: '2026-07-10T00:00:00.000Z' }),
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({ providerId: 'deepseek', modelId: 'deepseek-chat' })

    expect(report.ordinaryChat.status).toBe('auth-failed')
    expect(report.ordinaryChat.failureCode).toBe('http_401')
    // 成功/失败判定不变：仍然不可选。
    expect(report.finalCompatibility.selectable).toBe(false)
  })

  it('selects gateway as final route when direct fails and gateway probe passes', async () => {
    const service = createProviderRuntimeCheckService({
      getProviderState: async () => providerState,
      fetch: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      probeService: {
        probe: vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
          route: input.route,
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
          runtimeId: 'claude-code' as const,
          signature: `${input.route}-sig`,
          checkedAt: '2026-07-10T00:00:00.000Z',
          status: input.route === 'gateway' ? ('ready' as const) : ('auth-failed' as const),
          message: input.route === 'gateway' ? 'Gateway ready.' : 'Direct failed.'
        })),
        invalidateGateway: vi.fn()
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: true,
          state: 'running',
          port: 18779,
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          updatedAt: '2026-07-10T00:00:00.000Z'
        }),
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: {
        writeReport: vi.fn(async (report) => report)
      } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })

    expect(report.ordinaryChat.status).toBe('ready')
    expect(report.direct?.status).toBe('auth-failed')
    expect(report.gateway?.status).toBe('ready')
    expect(report.finalCompatibility).toMatchObject({
      selectable: true,
      route: 'gateway',
      status: 'ready'
    })
  })

  it('uses the main-process runtime resolver instead of an API-key override', async () => {
    const runtimeKeyFixture = 'fixture-runtime-key-1234567890'
    const rendererOverrideFixture = 'fixture-renderer-override-1234567890'
    const metadataState: ProviderState = {
      providers: [{ ...providerState.providers[0]!, apiKey: undefined, apiKeyRef: 'provider:646565707365656b' }]
    }
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => ({ ...providerState.providers[0]!, apiKey: runtimeKeyFixture }))
    })
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200 }
    ))
    const service = createProviderRuntimeCheckService({
      getProviderState,
      fetch,
      probeService: { probe: vi.fn(), invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: false, state: 'disabled', updatedAt: '2026-07-10T00:00:00.000Z' }),
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
    })

    await service.runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'openai-agents',
      ...({ apiKey: rendererOverrideFixture } as { apiKey: string })
    })

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('deepseek')
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${runtimeKeyFixture}` })
    }))
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(rendererOverrideFixture)
  })

  it('does not run connection or runtime probes when a vaulted provider cannot resolve a runtime key', async () => {
    const metadataState: ProviderState = {
      providers: [{ ...providerState.providers[0]!, apiKey: undefined, apiKeyRef: 'provider:646565707365656b' }]
    }
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => metadataState.providers[0])
    })
    const fetch = vi.fn()
    const probe = vi.fn()
    const syncProviderConfig = vi.fn()
    const service = createProviderRuntimeCheckService({
      getProviderState,
      fetch: fetch as unknown as typeof globalThis.fetch,
      probeService: { probe, invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: true, state: 'running', updatedAt: '2026-07-26T00:00:00.000Z' }),
        syncProviderConfig
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport: vi.fn(async (report) => report) } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      checkGateway: true
    })

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('deepseek')
    expect(fetch).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(syncProviderConfig).not.toHaveBeenCalled()
    expect(report.finalCompatibility).toMatchObject({
      selectable: false,
      route: 'none',
      status: 'missing-api-key'
    })
  })

  /**
   * PLAT-66：供应商停用 ⇒ 立刻短路，**一个网络请求都不发**（不再「按启用态探测」草稿），
   * 报告里也不带任何上游 message —— 渲染层只需说「先启用」。
   */
  it('short-circuits a disabled provider without any network request or upstream message', async () => {
    const disabledKeyFixture = 'fixture-disabled-provider-key-1234567890'
    const disabledProviderState: ProviderState = {
      providers: [{ ...providerState.providers[0]!, enabled: false, apiKey: disabledKeyFixture }]
    }
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200 }
    ))
    const probe = vi.fn()
    const syncProviderConfig = vi.fn()
    const writeReport = vi.fn(async (report) => report)
    const service = createProviderRuntimeCheckService({
      getProviderState: async () => disabledProviderState,
      fetch,
      probeService: { probe, invalidateGateway: vi.fn() } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: true, state: 'running', updatedAt: '2026-07-28T00:00:00.000Z' }),
        syncProviderConfig
      } as unknown as AgentModelGatewayService,
      snapshotStore: { writeReport } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const report = await service.runChecks({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      checkGateway: true
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(syncProviderConfig).not.toHaveBeenCalled()
    expect(report.finalCompatibility).toMatchObject({
      selectable: false,
      route: 'none',
      status: 'provider-disabled'
    })
    expect(report.ordinaryChat.status).not.toBe('ready')
    expect(report.direct?.status).not.toBe('ready')
    expect(report.gateway?.status).not.toBe('ready')
    expect(report.ordinaryChat.upstreamMessage).toBeUndefined()
    expect(JSON.stringify(report)).not.toContain(disabledKeyFixture)
    expect(writeReport).toHaveBeenCalledWith(report)
    expect(disabledProviderState.providers[0]?.enabled).toBe(false)
  })
})
