import { describe, expect, it } from 'vitest'

import type { ProviderState } from '../../../../providers/modelProviderTypes'
import { createClaudeCodeProviderEnvironment } from './ClaudeCodeProviderEnvironment'

const readyProviderState: ProviderState = {
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      endpoints: [
        { protocol: 'messages', baseUrl: 'https://anthropic.proxy.test' } as const
      ],
      enabled: true,
      baseUrl: 'https://api.anthropic.com',

      apiKey: 'secret-key',
      models: [
        {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          capabilities: {
            chat: true,
            vision: true,
            embedding: false,
            tools: true,
            agentRuntimes: { claudeCode: true }
          }
        }
      ],
      defaultChatModelId: 'claude-sonnet-4-5'
    }
  ]
}

describe('Claude Code provider environment', () => {
  it('resolves provider:model ids into Claude SDK env and safe model metadata', () => {
    const resolved = createClaudeCodeProviderEnvironment(readyProviderState, 'anthropic:claude-sonnet-4-5')

    expect(resolved).toMatchObject({
      ok: true,
      modelId: 'claude-sonnet-4-5',
      env: {
        ANTHROPIC_API_KEY: 'secret-key',
        ANTHROPIC_BASE_URL: 'https://anthropic.proxy.test',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5',
        CLAUDE_CODE_USE_BEDROCK: '0'
      },
      metadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://anthropic.proxy.test',
        route: 'direct'
      },
      compatibility: {
        selectable: true,
        route: 'direct',
        status: 'ready'
      }
    })
  })

  it('forwards a declared absence of reasoning support into provider metadata', () => {
    const state: ProviderState = {
      providers: [
        {
          ...readyProviderState.providers[0]!,
          models: [
            {
              id: 'plain-chat',
              name: 'Plain Chat',
              capabilities: { chat: true, reasoning: false, agentRuntimes: { claudeCode: true } }
            }
          ],
          defaultChatModelId: 'plain-chat'
        }
      ]
    }

    const resolved = createClaudeCodeProviderEnvironment(state, 'anthropic:plain-chat')

    expect(resolved).toMatchObject({
      ok: true,
      metadata: {
        modelId: 'plain-chat',
        modelReasoningSupported: false
      }
    })
  })

  it('uses the messages endpoint base for the direct Anthropic env', () => {
    const state: ProviderState = {
      providers: [
        {
          ...readyProviderState.providers[0]!,
          endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com/v1' }]
        }
      ]
    }

    const resolved = createClaudeCodeProviderEnvironment(state, 'anthropic:claude-sonnet-4-5')

    expect(resolved).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1'
      },
      metadata: {
        baseUrl: 'https://api.anthropic.com/v1'
      }
    })
  })

  it('returns model-not-ready for malformed unique model ids', () => {
    expect(createClaudeCodeProviderEnvironment(readyProviderState, 'missing-separator')).toEqual({
      ok: false,
      errorCode: 'model-not-ready',
      message: 'Claude Code provider environment requires a provider:model id.'
    })
  })

  it('rejects non-Anthropic providers without an Anthropic-compatible endpoint before SDK startup', () => {
    const state: ProviderState = {
      providers: [
        {
          id: 'silicon',
          name: 'Silicon',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' } as const
          ],
          enabled: true,
          baseUrl: 'https://api.siliconflow.cn',
          apiKey: 'secret-key',
          models: [
            {
              id: 'deepseek-ai/DeepSeek-V4-Pro',
              name: 'DeepSeek V4 Pro',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-ai/DeepSeek-V4-Pro'
        }
      ]
    }

    expect(createClaudeCodeProviderEnvironment(state, 'silicon:deepseek-ai/DeepSeek-V4-Pro')).toMatchObject({
      ok: false,
      errorCode: 'unsupported-provider-protocol',
      compatibility: {
        status: 'missing-endpoint'
      }
    })
  })

  it('rejects non-Anthropic provider models that are not compatible with Claude Code', () => {
    const state: ProviderState = {
      providers: [
        {
          id: '302ai',
          name: '302.AI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.302.ai' } as const,
            { protocol: 'messages', baseUrl: 'https://api.302.ai' } as const
          ],
          enabled: true,
          baseUrl: 'https://api.302.ai',

          apiKey: 'secret-key',
          models: [
            {
              id: 'o3',
              name: 'o3',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true
              }
            }
          ],
          defaultChatModelId: 'o3'
        }
      ]
    }

    expect(createClaudeCodeProviderEnvironment(state, '302ai:o3')).toMatchObject({
      ok: false,
      errorCode: 'unsupported-provider-protocol',
      compatibility: {
        status: 'model-not-enabled'
      }
    })
  })

  it('rejects mixed relay non-Claude models even when the provider has an Anthropic endpoint', () => {
    const state: ProviderState = {
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://openrouter.ai/api/v1' } as const,
            { protocol: 'messages', baseUrl: 'https://openrouter.ai/api' } as const
          ],
          enabled: true,
          baseUrl: 'https://openrouter.ai/api/v1',

          apiKey: 'secret-key',
          models: [
            {
              id: 'google/gemini-2.5-pro',
              name: 'Gemini 2.5 Pro',
              capabilities: {
                chat: true,
                vision: true,
                embedding: false,
                tools: true
              }
            }
          ],
          defaultChatModelId: 'google/gemini-2.5-pro'
        }
      ]
    }

    expect(createClaudeCodeProviderEnvironment(state, 'openrouter:google/gemini-2.5-pro')).toMatchObject({
      ok: false,
      errorCode: 'unsupported-provider-protocol',
      compatibility: {
        status: 'model-not-enabled'
      }
    })
  })

  it('uses Claude Code host-managed auth token env for non-native Anthropic-compatible direct routes', () => {
    const state: ProviderState = {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          enabled: true,
          baseUrl: 'https://api.deepseek.com',

          apiKey: 'secret-key',
          models: [
            {
              id: 'deepseek-v4-pro',
              name: 'DeepSeek V4 Pro',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            },
            {
              id: 'deepseek-v4-flash',
              name: 'DeepSeek V4 Flash',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        }
      ]
    }

    expect(
      createClaudeCodeProviderEnvironment(state, 'deepseek:deepseek-v4-pro', {
        directProbe: {
          route: 'direct',
          status: 'ready',
          providerId: 'deepseek',
          modelId: 'deepseek-v4-pro',
          runtimeId: 'claude-code',
          signature: 'direct-ready',
          checkedAt: '2026-07-10T00:00:00.000Z'
        }
      })
    ).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_API_KEY: 'secret-key',
        ANTHROPIC_AUTH_TOKEN: 'secret-key',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
        CLAUDE_CODE_EFFORT_LEVEL: 'max'
      },
      metadata: {
        providerId: 'deepseek',
        // 默认端点（`endpoints[0]`）是 chat/completions；messages 是显式切换的那条。
        protocol: 'chat-completions',
        baseUrl: 'https://api.deepseek.com/anthropic',
        route: 'direct'
      }
    })
  })

  it('allows relay provider models through the local gateway after gateway probe passes', () => {
    const state: ProviderState = {
      providers: [
        {
          id: '302ai',
          name: '302.AI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.302.ai' } as const,
            { protocol: 'messages', baseUrl: 'https://api.302.ai' } as const
          ],
          enabled: true,
          baseUrl: 'https://api.302.ai',

          apiKey: 'secret-key',
          models: [
            {
              id: 'claude-sonnet-4-20250514',
              name: 'Claude Sonnet 4',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'claude-sonnet-4-20250514'
        }
      ]
    }

    expect(
      createClaudeCodeProviderEnvironment(state, '302ai:claude-sonnet-4-20250514', {
        gatewayEnabled: true,
        directProbe: {
          route: 'direct',
          status: 'auth-failed',
          providerId: '302ai',
          modelId: 'claude-sonnet-4-20250514',
          runtimeId: 'claude-code',
          signature: 'direct-auth-failed',
          checkedAt: '2026-07-09T00:00:00.000Z'
        },
        gatewayProbe: {
          route: 'gateway',
          status: 'ready',
          providerId: '302ai',
          modelId: 'claude-sonnet-4-20250514',
          runtimeId: 'claude-code',
          signature: 'gateway-ready',
          checkedAt: '2026-07-09T00:00:00.000Z'
        },
        gateway: {
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          authToken: 'local-gateway-token'
        }
      })
    ).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_API_KEY: 'local-gateway-token',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:18779/anthropic'
      },
      metadata: {
        providerId: '302ai',
        protocol: 'chat-completions',
        baseUrl: 'http://127.0.0.1:18779/anthropic',
        route: 'gateway'
      }
    })
  })

  it('uses local gateway env when compatibility selects the gateway route', () => {
    const resolved = createClaudeCodeProviderEnvironment(readyProviderState, 'anthropic:claude-sonnet-4-5', {
      gatewayEnabled: true,
      directProbe: {
        route: 'direct',
        status: 'auth-failed',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        signature: 'direct-auth-failed',
        checkedAt: '2026-07-09T00:00:00.000Z'
      },
      gatewayProbe: {
        route: 'gateway',
        status: 'ready',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        signature: 'gateway-ready',
        checkedAt: '2026-07-09T00:00:00.000Z'
      },
      gateway: {
        baseUrl: 'http://127.0.0.1:18779/anthropic',
        authToken: 'local-gateway-token'
      }
    })

    expect(resolved).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_API_KEY: 'local-gateway-token',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:18779/anthropic'
      },
      metadata: {
        route: 'gateway',
        baseUrl: 'http://127.0.0.1:18779/anthropic'
      }
    })
  })

  it('fails before SDK startup when compatibility rejects the route', () => {
    const resolved = createClaudeCodeProviderEnvironment(readyProviderState, 'anthropic:claude-sonnet-4-5', {
      directProbe: {
        route: 'direct',
        status: 'auth-failed',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        signature: 'direct-auth-failed',
        checkedAt: '2026-07-09T00:00:00.000Z',
        message: '401 authentication_failed'
      }
    })

    expect(resolved).toMatchObject({
      ok: false,
      errorCode: 'runtime-not-ready',
      message: expect.stringContaining('401 authentication_failed')
    })
  })

  it('maps provider readiness errors without leaking the API key', () => {
    const state: ProviderState = {
      providers: [
        {
          ...readyProviderState.providers[0]!,
          apiKey: ''
        }
      ]
    }

    const resolved = createClaudeCodeProviderEnvironment(state, 'anthropic:claude-sonnet-4-5')

    expect(resolved).toEqual({
      ok: false,
      errorCode: 'missing-api-key',
      message: 'Claude Code provider is missing an API key.'
    })
    expect(JSON.stringify(resolved)).not.toMatch(/secret-key|ANTHROPIC_API_KEY/)
  })

  it('does not leak the API key through metadata on success', () => {
    const resolved = createClaudeCodeProviderEnvironment(readyProviderState, 'anthropic:claude-sonnet-4-5')

    expect(JSON.stringify(resolved.ok ? resolved.metadata : resolved)).not.toMatch(/secret-key|ANTHROPIC_API_KEY/)
  })

  it('marks only the official Anthropic first-party endpoint as server-web-tool capable', () => {
    const official: ProviderState = {
      providers: [
        {
          ...readyProviderState.providers[0]!,
          endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }]
        }
      ]
    }
    const officialResult = createClaudeCodeProviderEnvironment(official, 'anthropic:claude-sonnet-4-5')
    expect(officialResult).toMatchObject({
      ok: true,
      metadata: { route: 'direct', serverWebToolsSupported: true }
    })

    const relayResult = createClaudeCodeProviderEnvironment(readyProviderState, 'anthropic:claude-sonnet-4-5')
    expect(relayResult).toMatchObject({
      ok: true,
      metadata: { route: 'direct', serverWebToolsSupported: false }
    })
  })

  it('marks a declared third-party messages endpoint as not server-web-tool capable', () => {
    const state: ProviderState = {
      providers: [
        {
          id: 'tokenrhythm',
          name: 'TokenRhythm',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' },
            { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }
          ],
          enabled: true,
          baseUrl: 'https://tokenrhythm.studio',
          apiKey: 'secret-key',
          models: [
            {
              id: 'deepseek-v4.1-flash-1017',
              name: 'deepseek-v4.1-flash-1017',
              messagesSupport: 'yes',
              capabilities: { chat: true, tools: true, agentRuntimes: { claudeCode: true } }
            }
          ],
          defaultChatModelId: 'deepseek-v4.1-flash-1017'
        }
      ]
    }

    expect(createClaudeCodeProviderEnvironment(state, 'tokenrhythm:deepseek-v4.1-flash-1017')).toMatchObject({
      ok: true,
      metadata: { route: 'direct', serverWebToolsSupported: false }
    })
  })
})
