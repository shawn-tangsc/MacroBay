import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import type { AgentModelGatewayService } from '../agentModelGateway/AgentModelGatewayService'
import type { AgentModelRuntimeProbeService } from './AgentModelRuntimeProbeService'
import { createAgentModelCompatibilityControl } from './createAgentModelCompatibilityControl'

const providerState: ProviderState = {
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' }
      ],
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret-key',
      models: [
        {
          id: 'gpt-5',
          name: 'GPT-5',
          capabilities: {
            chat: true,
            vision: false,
            embedding: false,
            tools: true,
            agentRuntimes: { claudeCode: true }
          }
        }
      ],
      defaultChatModelId: 'gpt-5'
    }
  ]
}

describe('createAgentModelCompatibilityControl', () => {
  it('syncs gateway provider config before probing the gateway route', async () => {
    const syncProviderConfig = vi.fn()
    const probe = vi.fn(async (input: { route: 'direct' | 'gateway' }) => ({
      route: input.route,
      providerId: 'openai',
      modelId: 'gpt-5',
      runtimeId: 'claude-code' as const,
      signature: `${input.route}-sig`,
      checkedAt: '2026-07-09T00:00:00.000Z',
      status: input.route === 'gateway' ? ('ready' as const) : ('auth-failed' as const),
      message: input.route === 'gateway' ? 'gateway ready' : 'direct failed'
    }))

    const invalidateGateway = vi.fn()
    const control = createAgentModelCompatibilityControl({
      getProviderState: async () => providerState,
      probeService: {
        probe,
        getCachedSnapshot: () => undefined,
        buildSignature: () => null,
        invalidateGateway
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: true,
          state: 'running',
          port: 18779,
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          updatedAt: '2026-07-09T00:00:00.000Z'
        }),
        syncProviderConfig,
        setEnabled: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        getAuthToken: () => 'token'
      } as unknown as AgentModelGatewayService
    })

    const result = await control.probeRuntimeCompatibility('openai', 'gpt-5', 'claude-code')

    expect(syncProviderConfig).toHaveBeenCalledWith(
      providerState.providers[0],
      providerState.providers[0]!.models[0]
    )
    expect(invalidateGateway).toHaveBeenCalled()
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ route: 'gateway' }))
    expect(result).toMatchObject({
      selectable: true,
      route: 'gateway',
      status: 'ready'
    })
  })

  it('returns unverified when Claude Code direct route has no probe evidence yet', async () => {
    const control = createAgentModelCompatibilityControl({
      getProviderState: async () => ({
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            endpoints: [
              { protocol: 'messages', baseUrl: 'https://api.anthropic.com' }
            ],
            enabled: true,
            baseUrl: 'https://api.anthropic.com',

            apiKey: 'secret-key',
            models: [
              {
                id: 'claude-sonnet',
                name: 'Claude Sonnet',
                capabilities: {
                  chat: true,
                  vision: false,
                  embedding: false,
                  tools: true,
                  agentRuntimes: { claudeCode: true }
                }
              }
            ],
            defaultChatModelId: 'claude-sonnet'
          }
        ]
      }),
      probeService: {
        probe: vi.fn(),
        getCachedSnapshot: () => undefined,
        buildSignature: () => null,
        invalidateGateway: vi.fn()
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: false,
          state: 'disabled',
          updatedAt: '2026-07-10T00:00:00.000Z'
        }),
        syncProviderConfig: vi.fn(),
        setEnabled: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        getAuthToken: () => ''
      } as unknown as AgentModelGatewayService
    })

    await expect(control.getRuntimeCompatibility('anthropic', 'claude-sonnet', 'claude-code')).resolves.toMatchObject({
      selectable: false,
      status: 'unknown',
      route: 'none'
    })
  })

  it('does not probe or sync a vaulted provider when runtime key resolution fails', async () => {
    const metadataState: ProviderState = {
      providers: [{ ...providerState.providers[0]!, apiKey: undefined, apiKeyRef: 'provider:6f70656e6169' }]
    }
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => metadataState.providers[0])
    })
    const probe = vi.fn()
    const syncProviderConfig = vi.fn()
    const control = createAgentModelCompatibilityControl({
      getProviderState,
      probeService: {
        probe,
        getCachedSnapshot: () => undefined,
        buildSignature: () => null,
        invalidateGateway: vi.fn()
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: true,
          state: 'running',
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          updatedAt: '2026-07-26T00:00:00.000Z'
        }),
        syncProviderConfig,
        setEnabled: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        getAuthToken: () => 'fixture-gateway-token'
      } as unknown as AgentModelGatewayService
    })

    const result = await control.probeRuntimeCompatibility('openai', 'gpt-5', 'claude-code')

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('openai')
    expect(probe).not.toHaveBeenCalled()
    expect(syncProviderConfig).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      selectable: false,
      route: 'none',
      status: 'missing-api-key'
    })
  })

  it('does not sync a vaulted provider into the gateway when runtime key resolution fails', async () => {
    const metadataState: ProviderState = {
      providers: [{ ...providerState.providers[0]!, apiKey: undefined, apiKeyRef: 'provider:6f70656e6169' }]
    }
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => metadataState.providers[0])
    })
    const syncProviderConfig = vi.fn()
    const start = vi.fn()
    const control = createAgentModelCompatibilityControl({
      getProviderState,
      probeService: {
        probe: vi.fn(),
        getCachedSnapshot: () => undefined,
        buildSignature: () => null,
        invalidateGateway: vi.fn()
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({ enabled: true, state: 'stopped', updatedAt: '2026-07-26T00:00:00.000Z' }),
        syncProviderConfig,
        setEnabled: vi.fn(),
        start,
        stop: vi.fn(),
        getAuthToken: () => 'fixture-gateway-token'
      } as unknown as AgentModelGatewayService
    })

    const result = await control.startModelGateway('openai', 'gpt-5')

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('openai')
    expect(syncProviderConfig).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('invalidates gateway-dependent snapshot reports when gateway is stopped or disabled', async () => {
    const invalidateGateway = vi.fn()
    const invalidateGatewayDependentReports = vi.fn(async () => undefined)
    const setEnabled = vi.fn((enabled: boolean) => ({
      enabled,
      state: enabled ? ('stopped' as const) : ('disabled' as const),
      updatedAt: '2026-07-10T00:00:00.000Z'
    }))
    const stop = vi.fn(async () => ({
      ok: true,
      snapshot: {
        enabled: true,
        state: 'stopped' as const,
        updatedAt: '2026-07-10T00:00:00.000Z'
      }
    }))

    const control = createAgentModelCompatibilityControl({
      getProviderState: async () => providerState,
      probeService: {
        probe: vi.fn(),
        getCachedSnapshot: () => undefined,
        buildSignature: () => null,
        invalidateGateway
      } as unknown as AgentModelRuntimeProbeService,
      gatewayService: {
        getSnapshot: () => ({
          enabled: true,
          state: 'running',
          port: 18779,
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          updatedAt: '2026-07-10T00:00:00.000Z'
        }),
        syncProviderConfig: vi.fn(),
        setEnabled,
        start: vi.fn(),
        stop,
        getAuthToken: () => 'token'
      } as unknown as AgentModelGatewayService,
      snapshotStore: {
        invalidateGatewayDependentReports
      } as never
    })

    await control.stopModelGateway()
    await control.setModelGatewayEnabled(false)

    expect(stop).toHaveBeenCalled()
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(invalidateGateway).toHaveBeenCalledTimes(2)
    expect(invalidateGatewayDependentReports).toHaveBeenCalledTimes(2)
  })
})
