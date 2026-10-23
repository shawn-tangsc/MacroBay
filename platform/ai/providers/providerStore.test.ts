import { describe, expect, it, vi } from 'vitest'

import {
  SecretVaultError,
  type SecretMetadata,
  type SecretOwnerScope,
  type SecretRef,
  type SecretVault
} from '../../secrets'
import type { ModelProvider, PersistedProviderState, SafeModelProvider } from './modelProviderTypes'
import { resolveChatModel } from '../invocation/resolveChatModel'
import { createStructuredModelInvocationService } from '../invocation/structuredModelInvocation'

import {
  addOrUpdateModel,
  createDefaultProviderState,
  createProviderStore,
  isProviderConnectionReady,
  isSystemProviderId,
  maskSecret,
  normalizeProviderState,
  ProviderOrphanJournalPolicy,
  ProviderSecretMetadataPolicy,
  removeProvider,
  setDefaultChatModel,
  toSafeProvider,
  upsertProvider
} from './providerStore'
import { testModelProviderConnection } from './providerConnection'
import { listRemoteProviderModels } from './providerModelSync'

const providerKeyFixture = 'fixture-provider-key-1234567890'
const providerOwner: SecretOwnerScope = {
  ownerType: 'platform',
  ownerId: 'ai-providers',
  namespace: 'api-key'
}

describe('model provider store', () => {
  it('uses the design-owned platform scope for provider API keys', () => {
    expect(ProviderSecretMetadataPolicy.owner).toEqual(providerOwner)
  })

  it('starts with system providers disabled and ready to configure', () => {
    const state = createDefaultProviderState()

    expect(state.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['openai', 'deepseek', 'silicon', 'dashscope', 'ollama', 'lmstudio', 'anthropic', 'gemini'])
    )
    expect(state.providers.find((provider) => provider.id === 'deepseek')).toMatchObject({
      id: 'deepseek',
      name: 'deepseek',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
        { protocol: 'responses', baseUrl: 'https://api.deepseek.com/v1' },
        { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
      ],
      enabled: false,
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      isSystem: true
    })
    expect(state.providers.find((provider) => provider.id === 'openai')?.models.map((model) => model.id)).toContain('gpt-5')
  })

  it('adds and updates OpenAI-compatible providers without leaking the API key in safe views', () => {
    const state = upsertProvider(createDefaultProviderState(), {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: '  https://example.test/v1  ' }
      ],
      enabled: true,
      apiKey: 'sk-test-1234567890',
      models: []
    })

    expect(state.providers.find((provider) => provider.id === 'provider-local')).toMatchObject({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test-1234567890',
      models: []
    })

    const localProvider = state.providers.find((provider) => provider.id === 'provider-local')
    expect(localProvider).toBeDefined()
    expect(toSafeProvider(localProvider!)).toMatchObject({
      id: 'provider-local',
      hasApiKey: true,
      apiKeyPreview: 'sk-t**********7890'
    })
    expect(toSafeProvider(localProvider!)).not.toHaveProperty('apiKey')
  })

  it('treats a provider as connection-ready only when it is enabled and has an API key', () => {
    const state = upsertProvider(createDefaultProviderState(), {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: '',
      models: []
    })
    const provider = state.providers.find((item) => item.id === 'provider-local')

    expect(provider).toBeDefined()
    expect(isProviderConnectionReady(provider!)).toBe(false)

    const readyState = upsertProvider(state, {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: 'sk-test-1234567890',
      models: []
    })
    const readyProvider = readyState.providers.find((item) => item.id === 'provider-local')

    expect(isProviderConnectionReady(readyProvider!)).toBe(true)
    expect(isProviderConnectionReady(toSafeProvider(readyProvider!))).toBe(true)
  })

  it.each([
    { connectionStatus: 'unverified' as const, hasApiKey: true, ready: false },
    { connectionStatus: 'ready' as const, hasApiKey: true, ready: true },
    { connectionStatus: 'unavailable' as const, hasApiKey: false, ready: false },
    { connectionStatus: undefined, hasApiKey: true, ready: true }
  ])('preserves safe provider readiness for $connectionStatus status', ({ connectionStatus, hasApiKey, ready }) => {
    const provider: SafeModelProvider = {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      baseUrl: 'https://example.test/v1',
      models: [],
      hasApiKey,
      apiKeyPreview: 'fixt...7890',
      ...(connectionStatus === undefined ? {} : { connectionStatus })
    }

    expect(isProviderConnectionReady(provider)).toBe(ready)
  })

  it('manages models and only allows chat-capable models as the default chat model', () => {
    let state = upsertProvider(createDefaultProviderState(), {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: '',
      models: []
    })

    state = addOrUpdateModel(state, 'provider-local', {
      id: 'embed-only',
      name: 'Embedding Only',
      capabilities: { chat: false, vision: false, embedding: true, tools: false }
    })
    state = addOrUpdateModel(state, 'provider-local', {
      id: 'chat-model',
      name: 'Chat Model',
      capabilities: { chat: true, vision: true, embedding: false, tools: true, agentRuntimes: { claudeCode: true } }
    })

    expect(() => setDefaultChatModel(state, 'provider-local', 'embed-only')).toThrow(/chat-capable/)

    state = setDefaultChatModel(state, 'provider-local', 'chat-model')
    expect(state.providers.find((provider) => provider.id === 'provider-local')?.defaultChatModelId).toBe('chat-model')
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models.find((model) => model.id === 'chat-model')?.capabilities.agentRuntimes?.claudeCode
    ).toBe(true)

    state = setDefaultChatModel(state, 'provider-local', '')
    expect(state.providers.find((provider) => provider.id === 'provider-local')?.defaultChatModelId).toBeUndefined()
  })

  it('updates an existing model in place so capability toggles do not reshuffle the visible list', () => {
    let state = upsertProvider(createDefaultProviderState(), {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: '',
      models: [
        {
          id: 'first-model',
          name: 'First Model',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        },
        {
          id: 'second-model',
          name: 'Second Model',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        },
        {
          id: 'third-model',
          name: 'Third Model',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        }
      ]
    })

    state = addOrUpdateModel(state, 'provider-local', {
      id: 'second-model',
      name: 'Second Model',
      capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: { claudeCode: true } }
    })

    expect(state.providers.find((provider) => provider.id === 'provider-local')?.models.map((model) => model.id)).toEqual([
      'first-model',
      'second-model',
      'third-model'
    ])
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models.find((model) => model.id === 'second-model')?.capabilities.agentRuntimes?.claudeCode
    ).toBe(true)
  })

  it('keeps the manual free mark and clears it when the model is saved without it', () => {
    let state = upsertProvider(createDefaultProviderState(), {
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }],
      enabled: true,
      apiKey: '',
      models: []
    })
    const pricing = { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, displayPrecision: 4 }

    state = addOrUpdateModel(state, 'provider-local', {
      id: 'paid-model',
      name: 'Paid Model',
      capabilities: { chat: true },
      pricing,
      freeOverride: true
    })
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models[0]
    ).toMatchObject({ freeOverride: true, pricing, priceTag: 'free' })

    // 抽屉关闭开关后草稿里没有该字段 ⇒ 商店里也必须清掉（回到价格自动判定）。
    state = addOrUpdateModel(state, 'provider-local', {
      id: 'paid-model',
      name: 'Paid Model',
      capabilities: { chat: true },
      pricing
    })
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models[0]?.freeOverride
    ).toBeUndefined()
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models[0]?.priceTag
    ).toBe('paid')
  })

  it('recomputes the price tag for legacy models without the enum', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'provider-local',
          name: 'Local Provider',
          endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }],
          enabled: true,
          models: [
            {
              id: 'openrouter-free',
              name: 'OpenRouter Free',
              capabilities: { chat: true },
              pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 }
            }
          ]
        }
      ]
    })
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models[0]?.priceTag
    ).toBe('free')
  })

  it('keeps the manual free mark through persisted-state normalization', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'provider-local',
          name: 'Local Provider',
          endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }],
          enabled: true,
          models: [
            {
              id: 'free-model',
              name: 'Free Model',
              capabilities: { chat: true },
              freeOverride: true
            }
          ]
        }
      ]
    })
    expect(
      state.providers.find((provider) => provider.id === 'provider-local')?.models[0]?.freeOverride
    ).toBe(true)
  })

  it('applies model sync plans through the provider store API', async () => {
    const store = createProviderStore(undefined, createMemorySecretVault().vault)
    await store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: 'sk-test',
      models: [
        {
          id: 'old-model',
          name: 'Old Model',
          provider: 'preset',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        }
      ],
      defaultChatModelId: 'old-model'
    })

    const provider = await store.applyModelSync('provider-local', {
      toAdd: [
        {
          id: 'new-model',
          name: 'New Model',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        }
      ],
      toUpdate: [],
      toRemove: ['old-model']
    })

    expect(provider.models.map((model) => model.id)).toEqual(['new-model'])
    expect(provider.defaultChatModelId).toBe('new-model')
  })

  it('ignores malformed persisted model records instead of rejecting the provider', () => {
    const storeState = {
      providers: [
        {
          id: 'provider-local',
          name: 'Local Provider',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
          ],
          enabled: true,
          baseUrl: 'https://example.test/v1',
          models: [
            { id: 'chat-model', name: 'Chat Model', capabilities: { chat: true, vision: false, embedding: false, tools: false } },
            { id: '', name: 'Broken Model', capabilities: null }
          ]
        }
      ]
    }

    const state = normalizeProviderState(storeState)
    expect(state.providers.find((provider) => provider.id === 'provider-local')?.models).toEqual([
      {
        id: 'chat-model',
        name: 'Chat Model',
        capabilities: { chat: true, vision: false, embedding: false, tools: false },
        // T4/T5：聊天模型加载时按供应商默认端点回填一次协议快照。
        chatProtocol: 'chat-completions',
        // PLAT-82：协议支持集合同步回填（默认端点 ∪ 声明）。
        supportedProtocols: ['chat-completions'],
        // 归一后的价格档位：没有价格 ⇒ paid。
        priceTag: 'paid'
      }
    ])
  })

  it('preserves explicit agent model capability through normalization and preset merges', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'deepseek',
          name: 'deepseek',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' }
          ],
          enabled: true,
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'sk-user-configured',
          models: [
            {
              id: 'deepseek-v4-pro',
              name: 'deepseek-v4-pro',
              capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: { claudeCode: false } }
            }
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        }
      ]
    })

    expect(
      state.providers.find((provider) => provider.id === 'deepseek')?.models.find((model) => model.id === 'deepseek-v4-pro')?.capabilities.agentRuntimes?.claudeCode
    ).toBe(false)
  })

  it('keeps runtime-scoped agent capabilities independently for future agent runtimes', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'provider-local',
          name: 'Local Provider',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
          ],
          enabled: true,
          baseUrl: 'https://example.test/v1',
          models: [
            {
              id: 'claude-only',
              name: 'Claude Only',
              capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: { claudeCode: true, openaiAgents: false } }
            },
            {
              id: 'openai-only',
              name: 'OpenAI Only',
              capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: { claudeCode: false, openaiAgents: true } }
            }
          ]
        }
      ]
    })

    expect(state.providers.find((provider) => provider.id === 'provider-local')?.models.map((model) => model.capabilities.agentRuntimes)).toEqual([
      { claudeCode: true, openaiAgents: false },
      { claudeCode: false, openaiAgents: true }
    ])
  })

  it('merges system providers into persisted state without replacing user configuration', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'openai',
          name: 'My OpenAI',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://proxy.example.test/v1' }
          ],
          enabled: true,
          baseUrl: 'https://proxy.example.test/v1',
          apiKey: 'sk-user-configured',
          models: [
            {
              id: 'custom-chat',
              name: 'Custom Chat',
              capabilities: { chat: true, vision: false, embedding: false, tools: true }
            }
          ],
          defaultChatModelId: 'custom-chat'
        }
      ]
    })

    const openai = state.providers.find((provider) => provider.id === 'openai')
    expect(openai).toMatchObject({
      name: 'My OpenAI',
      enabled: true,
      baseUrl: 'https://proxy.example.test/v1',
      apiKey: 'sk-user-configured',
      isSystem: true,
      defaultChatModelId: 'custom-chat'
    })
    expect(openai?.models.map((model) => model.id)).toEqual(expect.arrayContaining(['custom-chat', 'gpt-5']))
    expect(state.providers.some((provider) => provider.id === 'deepseek')).toBe(true)
  })

  it('takes preset websites for system providers because websites are static metadata', () => {
    // PLAT-61：`websites` 是不可编辑的静态元数据 ⇒ 预设是权威。持久化记录里的旧链接
    // （例如 silicon 旧的控制台地址）不得盖住预设里新改的邀请链接；用户可编辑字段仍以持久化为准。
    const state = normalizeProviderState({
      providers: [
        {
          id: 'silicon',
          name: 'Silicon',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://proxy.example.test/v1' },
            { protocol: 'messages', baseUrl: 'https://proxy.example.test' }
          ],
          enabled: true,
          baseUrl: 'https://proxy.example.test/v1',

          models: [],
          websites: {
            official: 'https://old.example.test',
            apiKey: 'https://cloud.siliconflow.cn',
            docs: 'https://old.example.test/docs'
          }
        }
      ]
    })

    const silicon = state.providers.find((provider) => provider.id === 'silicon')
    expect(silicon?.websites).toMatchObject({
      official: 'https://cloud.siliconflow.cn',
      apiKey: 'https://cloud.siliconflow.cn/i/9GmeSjFn',
      docs: 'https://docs.siliconflow.cn/'
    })
    expect(silicon?.baseUrl).toBe('https://proxy.example.test/v1')
    expect(silicon?.endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: 'https://proxy.example.test/v1' },
      { protocol: 'messages', baseUrl: 'https://proxy.example.test' }
    ])
  })

  it('marks system provider ids as built in', () => {
    expect(isSystemProviderId('openai')).toBe(true)
    expect(isSystemProviderId('provider-local')).toBe(false)
  })

  it('keeps system metadata when a built-in provider is updated from the UI', () => {
    const state = upsertProvider(createDefaultProviderState(), {
      id: 'openai',
      name: 'OpenAI Proxy',
      endpoints: [
        { protocol: 'responses', baseUrl: 'https://proxy.example.test' }
      ],
      enabled: true,
      apiKey: 'sk-openai-user'
    })

    expect(state.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      id: 'openai',
      name: 'OpenAI Proxy',
      endpoints: [
        { protocol: 'responses', baseUrl: 'https://proxy.example.test' }
      ],
      enabled: true,
      baseUrl: 'https://proxy.example.test',
      apiKey: 'sk-openai-user',
      isSystem: true
    })
  })

  it('loads persisted provider state, updates it, and removes providers', async () => {
    const writes: unknown[] = []
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async (value: unknown) => {
        writes.push(value)
      }
    }, vault.vault)

    await expect(store.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider-local',
          hasApiKey: true,
          apiKeyPreview: maskSecret(providerKeyFixture)
        }),
        expect.objectContaining({
          id: 'openai',
          isSystem: true
        })
      ])
    )

    await store.upsert({
      id: 'provider-local',
      name: 'Renamed Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: false,
      models: []
    })

    const state = removeProvider(await store.getState(), 'provider-local')
    expect(state.providers.some((provider) => provider.id === 'provider-local')).toBe(false)
    expect(state.providers.some((provider) => provider.id === 'openai')).toBe(true)
    expect(writes).toHaveLength(1)
  })

  it('leaves a legacy provider record unconfigured without vault I/O or safe-output leakage', async () => {
    const persisted = legacyProviderState(providerKeyFixture)
    const writes: unknown[] = []
    const vault = createMemorySecretVault()
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        writes.push(value)
      }
    }, vault.vault)

    const providers = await store.list()
    const runtimeProvider = await store.resolveRuntimeProvider('provider-local')

    expect(providers.find((provider) => provider.id === 'provider-local')).toMatchObject({
      hasApiKey: false,
      connectionStatus: 'unavailable',
      apiKeyPreview: ''
    })
    expect(runtimeProvider).toMatchObject({ id: 'provider-local', apiKey: undefined, apiKeyRef: undefined })
    expect(JSON.stringify(providers)).not.toContain(providerKeyFixture)
    expect(writes).toEqual([])
    expect(vault.putCount).toBe(0)
    expect(vault.getCount).toBe(0)
    expect(vault.existsCount).toBe(0)
    expect(vault.hasCount).toBe(0)
    expect(vault.inspectCount).toBe(0)
  })

  it('keeps an already vaulted provider stable across restarts', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const storage = {
      read: async () => persisted,
      write: async (value: unknown) => {
        persisted = value
      }
    }

    await createProviderStore(storage, vault.vault).list()
    const retryStore = createProviderStore(storage, vault.vault)
    await retryStore.setEnabled('openai', true)

    expect(vault.putCount).toBe(0)
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
  })

  it('keeps a newly saved provider key available after a fresh store restart', async () => {
    let persisted: unknown = { providers: [] }
    const vault = createMemorySecretVault()
    const storage = {
      read: async () => persisted,
      write: async (value: PersistedProviderState) => {
        persisted = value
      }
    }

    await createProviderStore(storage, vault.vault).upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: providerKeyFixture,
      models: []
    })

    const restartedStore = createProviderStore(storage, vault.vault)
    const safeProvider = (await restartedStore.list()).find((provider) => provider.id === 'provider-local')
    const runtimeProvider = await restartedStore.resolveRuntimeProvider('provider-local')

    expect(safeProvider).toMatchObject({ id: 'provider-local', hasApiKey: true, connectionStatus: 'unverified' })
    expect(safeProvider).not.toHaveProperty('apiKey')
    expect(safeProvider).not.toHaveProperty('apiKeyRef')
    expect(runtimeProvider).toMatchObject({ id: 'provider-local', apiKey: providerKeyFixture })
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
  })

  it('keeps a valid current provider ref when loading metadata with a plaintext residue', async () => {
    const persisted = vaultedProviderStateWithRef(providerSecretRefFixture) as PersistedProviderState & {
      providers: Array<PersistedProviderState['providers'][number] & { apiKey?: string }>
    }
    persisted.providers[0] = { ...persisted.providers[0], apiKey: providerKeyFixture }
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const storage = {
      read: async () => persisted,
      write: async (value: PersistedProviderState) => {
        persisted.providers = value.providers
      }
    }

    const store = createProviderStore(storage, vault.vault)
    const listed = (await store.list()).find((provider) => provider.id === 'provider-local')

    expect(listed).toMatchObject({ id: 'provider-local', hasApiKey: true, connectionStatus: 'unverified' })
    expect(listed).not.toHaveProperty('apiKey')
    expect(listed).not.toHaveProperty('apiKeyRef')

    await store.setEnabled('provider-local', false)

    expect(persisted.providers[0]).toMatchObject({ apiKeyRef: providerSecretRefFixture })
    expect(persisted.providers[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
    expect(vault.putCount).toBe(0)
  })

  it('keeps a legacy provider unconfigured when metadata writes would fail', async () => {
    const persisted: unknown = legacyProviderState(providerKeyFixture)
    const vault = createMemorySecretVault()
    const storage = {
      read: async () => persisted,
      write: async () => { throw new Error('metadata-write-failed') }
    }

    await expect(createProviderStore(storage, vault.vault).list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider-local', hasApiKey: false })
    ]))
    expect(vault.values.size).toBe(0)
    expect(vault.putCount).toBe(0)
    expect(vault.getCount).toBe(0)
  })

  it('keeps the current vaulted key unchanged when rotation metadata persistence fails', async () => {
    let persisted: unknown = vaultedProviderState()
    const previousKey = 'fixture-provider-key-previous-1234567890'
    const nextKey = 'fixture-provider-key-rotated-1234567890'
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, previousKey]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async () => {
        throw new Error('metadata-write-failed')
      }
    }, vault.vault)

    await store.getState()
    await expect(store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: nextKey,
      models: []
    })).rejects.toMatchObject({ code: 'provider-secret-metadata-write-failed' })

    expect((persisted as { providers: Array<{ apiKeyRef?: string }> }).providers[0]?.apiKeyRef).toBe(providerSecretRefFixture)
    expect(vault.values.get(providerSecretRefFixture)).toBe(previousKey)
    expect(Array.from(vault.values.entries())).toEqual(expect.arrayContaining([
      [expect.not.stringMatching(new RegExp(`^${providerSecretRefFixture}$`)), nextKey]
    ]))
  })

  it('uses a fresh secret generation ref for every successful key rotation', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value: unknown) => {
        persisted = value
      }
    }, vault.vault)

    const refs = [providerSecretRefFixture]
    for (const value of ['fixture-rotation-one-1234567890', 'fixture-rotation-two-1234567890', 'fixture-rotation-three-1234567890']) {
      await store.upsert({
        id: 'provider-local',
        name: 'Local Provider',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
        ],
        enabled: true,
        apiKey: value,
        models: []
      })
      refs.push((persisted as { providers: Array<{ apiKeyRef: string }> }).providers[0]!.apiKeyRef)
    }

    expect(new Set(refs).size).toBe(refs.length)
  })

  it('serializes concurrent metadata updates for the same provider', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, vault.vault)

    await Promise.all([
      store.setEnabled('provider-local', false),
      store.addOrUpdateModel('provider-local', {
        id: 'added-model',
        name: 'Added Model',
        capabilities: { chat: true, vision: false, embedding: false, tools: false }
      })
    ])

    const savedProvider = (persisted as { providers: Array<ModelProvider> }).providers.find(
      (provider) => provider.id === 'provider-local'
    )
    expect(savedProvider).toMatchObject({
      enabled: false,
      apiKeyRef: providerSecretRefFixture
    })
    expect(savedProvider?.models.map((model) => model.id)).toContain('added-model')
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
  })

  it('leaves a legacy provider unconfigured when the vault is unavailable', async () => {
    const persisted = legacyProviderState(providerKeyFixture)
    const writes: unknown[] = []
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        writes.push(value)
      }
    }, createMemorySecretVault({ unavailable: true }).vault)

    const safeProvider = (await store.list()).find((provider) => provider.id === 'provider-local')
    const runtimeProvider = (await store.getState()).providers.find((provider) => provider.id === 'provider-local')

    expect(safeProvider).toMatchObject({
      hasApiKey: false,
      apiKeyPreview: ''
    })
    expect(runtimeProvider?.apiKey).toBeUndefined()
    expect(isProviderConnectionReady(runtimeProvider!)).toBe(false)
    expect(writes).toEqual([])
    expect(JSON.stringify(persisted)).toContain(providerKeyFixture)
    await expect(store.setEnabled('provider-local', false)).resolves.toMatchObject({ enabled: false })
  })

  it('does not access the vault for any legacy provider record', async () => {
    const persisted = {
      providers: [
        legacyProvider('provider-a', providerKeyFixture),
        legacyProvider('provider-b', 'fixture-provider-key-secondary-1234567890')
      ]
    }
    const writes: unknown[] = []
    const vault = createMemorySecretVault()
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        writes.push(value)
      }
    }, vault.vault)

    const providers = await store.list()

    expect(providers.find((provider) => provider.id === 'provider-a')).toMatchObject({ hasApiKey: false })
    expect(providers.find((provider) => provider.id === 'provider-b')).toMatchObject({ hasApiKey: false })
    expect(writes).toEqual([])
    expect(JSON.stringify(persisted)).toContain(providerKeyFixture)
    expect(JSON.stringify(persisted)).toContain('fixture-provider-key-secondary-1234567890')
    expect(vault.putCount).toBe(0)
    expect(vault.getCount).toBe(0)
    expect(vault.existsCount).toBe(0)
  })

  it('keeps provider list and upsert responses free of fixture keys and secret references', async () => {
    let persisted: unknown = legacyProviderState(providerKeyFixture)
    const vault = createMemorySecretVault()
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, vault.vault)

    const listed = await store.list()
    const updated = await store.upsert({
      id: 'provider-local',
      name: 'Renamed Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      models: []
    })
    const safeJson = JSON.stringify({ listed, updated })

    expect(safeJson).not.toContain(providerKeyFixture)
    expect(safeJson).not.toContain('apiKeyRef')
    expect(safeJson).not.toContain('apiKeyMigrationState')
    expect(safeJson).not.toContain('apiKeyStorageVersion')
  })

  it('lists vaulted providers through ciphertext presence only without reading, decrypting, or validating secret blobs', async () => {
    const secondaryRef = providerRefFixture('provider-secondary')
    let persisted: unknown = vaultedProviderStateWithSecondRef(secondaryRef)
    const writes: unknown[] = []
    const vault = createMemorySecretVault({
      values: new Map([
        [providerSecretRefFixture, providerKeyFixture],
        [secondaryRef, 'fixture-provider-key-secondary-1234567890']
      ])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        writes.push(value)
        persisted = value
      }
    }, vault.vault)

    const listed = await store.list()

    expect(vault.existsCount).toBe(2)
    expect(vault.getCount).toBe(0)
    expect(vault.hasCount).toBe(0)
    expect(vault.inspectCount).toBe(0)
    expect(writes).toEqual([])
    expect(JSON.stringify(listed)).not.toContain(providerKeyFixture)
    expect(JSON.stringify(listed)).not.toContain('apiKeyRef')
    expect(listed.find((provider) => provider.id === 'provider-local')).toMatchObject({
      hasApiKey: true,
      apiKeyPreview: maskSecret(providerKeyFixture),
      connectionStatus: 'unverified'
    })
    expect(listed.find((provider) => provider.id === 'provider-secondary')).toMatchObject({
      hasApiKey: true,
      connectionStatus: 'unverified'
    })
    expect(isProviderConnectionReady(listed.find((provider) => provider.id === 'provider-local')!)).toBe(false)
  })

  it('marks a missing final ciphertext unavailable without decrypting it during metadata listing', async () => {
    const persisted = vaultedProviderState()
    const vault = createMemorySecretVault()
    const store = createProviderStore({
      read: async () => persisted,
      write: async () => undefined
    }, vault.vault)

    const listed = await store.list()
    const metadataProvider = (await store.getState()).providers.find((provider) => provider.id === 'provider-local')

    expect(vault.existsCount).toBe(1)
    expect(vault.getCount).toBe(0)
    expect(vault.hasCount).toBe(0)
    expect(vault.inspectCount).toBe(0)
    expect(listed.find((provider) => provider.id === 'provider-local')).toMatchObject({ hasApiKey: false })
    expect(isProviderConnectionReady(metadataProvider!)).toBe(false)
  })

  it('marks a failed ciphertext presence check unavailable without exposing its failure or fixture key', async () => {
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]]),
      failExistsForRef: providerSecretRefFixture
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async () => undefined
    }, vault.vault)

    const listed = await store.list()
    const metadataProvider = (await store.getState()).providers.find((provider) => provider.id === 'provider-local')

    expect(vault.existsCount).toBe(1)
    expect(vault.getCount).toBe(0)
    expect(vault.hasCount).toBe(0)
    expect(vault.inspectCount).toBe(0)
    expect(listed.find((provider) => provider.id === 'provider-local')).toMatchObject({ hasApiKey: false })
    expect(isProviderConnectionReady(metadataProvider!)).toBe(false)
    expect(JSON.stringify({ listed, metadataProvider })).not.toContain(providerKeyFixture)
  })

  it('resolves a vaulted key only for the requested provider at runtime', async () => {
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async () => undefined
    }, vault.vault)

    await store.list()
    expect(vault.getCount).toBe(0)

    const provider = await store.resolveRuntimeProvider('provider-local')

    expect(vault.getCount).toBe(1)
    expect(provider).toMatchObject({ id: 'provider-local', apiKey: providerKeyFixture })
    expect(await store.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider-local', connectionStatus: 'ready' })
    ]))
  })

  it.each([
    { label: 'is absent', values: new Map<SecretRef, string>() },
    { label: 'fails integrity validation', values: new Map<SecretRef, string>([[providerSecretRefFixture, providerKeyFixture]]), failGetForRef: providerSecretRefFixture }
  ])('marks only the requested provider unavailable when its runtime secret $label', async ({ values, failGetForRef }) => {
    const vault = createMemorySecretVault({ values, failGetForRef })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async () => undefined
    }, vault.vault)

    await store.list()
    const runtimeProvider = await store.resolveRuntimeProvider('provider-local')
    const listed = await store.list()

    expect(vault.getCount).toBe(1)
    expect(runtimeProvider).toMatchObject({ id: 'provider-local', apiKey: undefined })
    expect(listed.find((provider) => provider.id === 'provider-local')).toMatchObject({
      hasApiKey: false,
      connectionStatus: 'unavailable'
    })
    expect(isProviderConnectionReady((await store.getState()).providers.find((provider) => provider.id === 'provider-local')!)).toBe(false)
    expect(JSON.stringify({ listed, runtimeProvider })).not.toContain(providerKeyFixture)
  })

  it('preserves vaulted metadata during non-key provider updates without reading the key', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, vault.vault)

    await store.setEnabled('provider-local', false)

    const savedProvider = (persisted as { providers: Array<Record<string, unknown>> }).providers.find(
      (provider) => provider.id === 'provider-local'
    )
    expect(vault.getCount).toBe(0)
    expect(savedProvider).toMatchObject({
      apiKeyRef: providerSecretRefFixture,
      apiKeyPreview: maskSecret(providerKeyFixture),
      apiKeyMigrationState: 'vault-backed',
      apiKeyStorageVersion: 1,
      enabled: false
    })
    expect(savedProvider).not.toHaveProperty('apiKey')
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
  })

  it('does not trust persisted preview text as renderer-safe secret metadata', async () => {
    const store = createProviderStore({
      read: async () => ({
        providers: [
          {
            ...legacyProvider('provider-local', ''),
            apiKeyRef: providerSecretRefFixture,
            apiKeyPreview: providerKeyFixture,
            apiKeyMigrationState: 'vault-backed',
            apiKeyStorageVersion: 1
          }
        ]
      }),
      write: async () => undefined
    }, createMemorySecretVault({ unavailable: true }).vault)

    expect(await store.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider-local', apiKeyPreview: '' })
    ]))
  })

  it('masks a direct provider preview before returning a renderer-safe DTO', () => {
    const safeProvider = toSafeProvider({
      ...legacyProvider('provider-local', ''),
      apiKeyPreview: providerKeyFixture
    } as unknown as ModelProvider)

    expect(JSON.stringify(safeProvider)).not.toContain(providerKeyFixture)
    expect(safeProvider.apiKeyPreview).toBe(maskSecret(providerKeyFixture))
  })

  it('does not accept renderer-supplied secret metadata in provider upserts', async () => {
    let persisted: unknown = createDefaultProviderState()
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, createMemorySecretVault().vault)

    await store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      models: [],
      ...({ apiKeyRef: 'renderer-selected-secret-ref' } as Record<string, unknown>)
    })

    expect(JSON.stringify(persisted)).not.toContain('renderer-selected-secret-ref')
    expect(JSON.stringify(await store.list())).not.toContain('renderer-selected-secret-ref')
  })

  it('does not hydrate a provider from a different provider secret reference', async () => {
    const vault = createMemorySecretVault({
      values: new Map([['provider:other-provider', providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => ({
        providers: [
          {
            id: 'provider-local',
            name: 'Local Provider',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
            ],
            enabled: true,
            baseUrl: 'https://example.test/v1',
            apiKeyRef: 'provider:other-provider',
            apiKeyPreview: maskSecret(providerKeyFixture),
            apiKeyMigrationState: 'vault-backed',
            apiKeyStorageVersion: 1,
            models: []
          }
        ]
      }),
      write: async () => undefined
    }, vault.vault)

    const provider = (await store.getState()).providers.find((item) => item.id === 'provider-local')

    expect(provider?.apiKey).toBeUndefined()
    expect(isProviderConnectionReady(provider!)).toBe(false)
  })

  it.each([
    ['an obsolete slot', `${providerSecretRefFixture}:slot-a`],
    ['a second obsolete slot', `${providerSecretRefFixture}:slot-b`],
    ['an unknown slot', `${providerSecretRefFixture}:slot-c`],
    ['a different provider historical slot', `${providerRefFixture('provider-secondary')}:slot-a`]
  ])('rejects %s during provider metadata normalization', async (_name, ref) => {
    const vault = createMemorySecretVault({
      values: new Map([[ref, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderStateWithRef(ref),
      write: async () => undefined
    }, vault.vault)

    const safeProvider = (await store.list()).find((provider) => provider.id === 'provider-local')

    expect(safeProvider).toMatchObject({
      id: 'provider-local',
      hasApiKey: false,
      connectionStatus: 'unavailable'
    })
    expect(safeProvider).not.toHaveProperty('apiKeyRef')
    expect(vault.existsCount).toBe(0)
  })

  it('clears secret metadata before deleting its vault value', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value: unknown) => {
        persisted = value
      }
    }, vault.vault)

    await store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: '',
      models: []
    })

    expect(JSON.stringify(persisted)).not.toContain('apiKeyRef')
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
    expect(vault.values.has(providerSecretRefFixture)).toBe(false)
  })

  it('records an unreachable owner-scoped ref after deletion failure and retries it on a later load', async () => {
    let persisted: unknown = vaultedProviderState()
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]]),
      failDeleteTimes: 1
    })
    const storage = {
      read: async () => persisted,
      write: async (value: unknown) => {
        persisted = value
      }
    }
    const store = createProviderStore(storage, vault.vault)

    await expect(store.remove('provider-local')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai' })
    ]))

    expect((persisted as { providers: Array<{ id: string }> }).providers.some(
      (provider) => provider.id === 'provider-local'
    )).toBe(false)
    expect(JSON.stringify(persisted)).not.toContain(providerKeyFixture)
    expect(vault.values.has(providerSecretRefFixture)).toBe(true)
    expect(persisted).toMatchObject({
      secretOrphans: [expect.objectContaining({ ref: providerSecretRefFixture })]
    })

    const retryStore = createProviderStore(storage, vault.vault)
    await retryStore.list()

    expect(vault.values.has(providerSecretRefFixture)).toBe(false)
    expect(persisted).not.toHaveProperty('secretOrphans')
  })

  it('rejects a mutation when the bounded orphan journal is full without dropping cleanup records', async () => {
    const retainedOrphans = Array.from({ length: ProviderOrphanJournalPolicy.maxEntries }, (_, index) => ({
      providerId: `orphan-${index}`,
      ref: providerRefFixture(`orphan-${index}`)
    }))
    let persisted: unknown = {
      ...vaultedProviderState(),
      secretOrphans: retainedOrphans
    }
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]]),
      deleteFails: true
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, vault.vault)

    await expect(store.remove('provider-local')).rejects.toMatchObject({
      code: 'provider-secret-orphan-journal-full'
    })

    expect((persisted as { secretOrphans: unknown[] }).secretOrphans).toHaveLength(ProviderOrphanJournalPolicy.maxEntries)
    expect((persisted as { secretOrphans: unknown[] }).secretOrphans).toEqual(retainedOrphans)
    expect((persisted as { providers: Array<{ id: string }> }).providers.some((provider) => provider.id === 'provider-local')).toBe(true)
    expect(vault.values.get(providerSecretRefFixture)).toBe(providerKeyFixture)
  })

  it('retains an over-capacity historical orphan journal when one bounded cleanup batch cannot delete it', async () => {
    const retainedOrphans = orphanRecords(ProviderOrphanJournalPolicy.maxEntries + 1)
    let persisted: unknown = {
      ...vaultedProviderState(),
      secretOrphans: retainedOrphans
    }
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]]),
      deleteFails: true
    })
    const writes: unknown[] = []
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        writes.push(value)
        persisted = value
      }
    }, vault.vault)

    await store.list()
    await expect(store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: 'fixture-provider-key-over-capacity-1234567890',
      models: []
    })).rejects.toMatchObject({ code: 'provider-secret-orphan-journal-full' })
    await expect(store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: '',
      models: []
    })).rejects.toMatchObject({ code: 'provider-secret-orphan-journal-full' })
    await expect(store.remove('provider-local')).rejects.toMatchObject({
      code: 'provider-secret-orphan-journal-full'
    })

    expect(vault.deleteCount).toBe(ProviderOrphanJournalPolicy.maxEntries)
    expect(writes).toEqual([])
    expect((persisted as { secretOrphans: unknown[] }).secretOrphans).toEqual(retainedOrphans)

    await expect(store.setEnabled('provider-local', false)).resolves.toMatchObject({
      id: 'provider-local',
      enabled: false
    })

    expect(writes).toHaveLength(1)
    expect((persisted as { providers: Array<{ id: string; enabled: boolean }> }).providers.find(
      (provider) => provider.id === 'provider-local'
    )).toMatchObject({ enabled: false })
    expect((persisted as { secretOrphans: unknown[] }).secretOrphans).toEqual(retainedOrphans)
  })

  it('keeps a legacy provider unconfigured while historical orphan recovery is over capacity', async () => {
    const retainedOrphans = orphanRecords(ProviderOrphanJournalPolicy.maxEntries + 1)
    const persisted = {
      ...legacyProviderState(providerKeyFixture) as { providers: unknown[] },
      secretOrphans: retainedOrphans
    }
    const writes: unknown[] = []
    const vault = createMemorySecretVault({ deleteFails: true })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value: unknown) => {
        writes.push(value)
      }
    }, vault.vault)

    const listed = await store.list()

    expect(vault.putCount).toBe(0)
    expect(writes).toEqual([])
    expect(JSON.stringify(persisted)).toContain(providerKeyFixture)
    expect(listed.find((provider) => provider.id === 'provider-local')).toMatchObject({
      hasApiKey: false,
      connectionStatus: 'unavailable'
    })
    await expect(store.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: 'fixture-provider-key-capacity-rejected-1234567890',
      models: []
    })).rejects.toMatchObject({ code: 'provider-secret-orphan-journal-full' })
  })

  it('persists the exact bounded remainder after historical orphan cleanup recovers and permits a later secret mutation', async () => {
    const retainedOrphans = orphanRecords(ProviderOrphanJournalPolicy.maxEntries + 1)
    let persisted: unknown = {
      ...vaultedProviderState(),
      secretOrphans: retainedOrphans
    }
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]]),
      failDeleteTimes: ProviderOrphanJournalPolicy.maxEntries
    })
    const storage = {
      read: async () => persisted,
      write: async (value: unknown) => {
        persisted = value
      }
    }

    await createProviderStore(storage, vault.vault).list()
    const retryStore = createProviderStore(storage, vault.vault)
    await retryStore.list()

    expect((persisted as { secretOrphans: unknown[] }).secretOrphans).toEqual([retainedOrphans.at(-1)])
    await expect(retryStore.upsert({
      id: 'provider-local',
      name: 'Local Provider',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
      ],
      enabled: true,
      apiKey: 'fixture-provider-key-recovered-1234567890',
      models: []
    })).resolves.toMatchObject({ id: 'provider-local', hasApiKey: true })
  })

  it('does not delete a recorded ref that is still reachable from current metadata', async () => {
    let persisted: unknown = {
      ...vaultedProviderState(),
      secretOrphans: [{ providerId: 'provider-local', ref: providerSecretRefFixture }]
    }
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, vault.vault)

    await store.setEnabled('provider-local', false)

    expect(vault.values.get(providerSecretRefFixture)).toBe(providerKeyFixture)
    expect(persisted).toMatchObject({
      secretOrphans: [expect.objectContaining({ ref: providerSecretRefFixture })]
    })
  })

  it('returns only safe providers after removal', async () => {
    let persisted: unknown = vaultedProviderState()
    const store = createProviderStore({
      read: async () => persisted,
      write: async (value) => {
        persisted = value
      }
    }, createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    }).vault)

    const providers = await store.remove('provider-local')

    expect(JSON.stringify(providers)).not.toContain(providerKeyFixture)
    expect(JSON.stringify(providers)).not.toContain('apiKeyRef')
  })

  it('resolves a vaulted key only in the main-process provider state used by connection, model sync, and chat invocation', async () => {
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => ({
        providers: [
          {
            id: 'provider-local',
            name: 'Local Provider',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
            ],
            enabled: true,
            baseUrl: 'https://example.test/v1',
            apiKeyRef: providerSecretRefFixture,
            apiKeyPreview: maskSecret(providerKeyFixture),
            apiKeyMigrationState: 'vault-backed',
            apiKeyStorageVersion: 1,
            models: [
              {
                id: 'chat-model',
                name: 'Chat Model',
                capabilities: { chat: true, vision: false, embedding: false, tools: true }
              }
            ],
            defaultChatModelId: 'chat-model'
          }
        ]
      }),
      write: async () => undefined
    }, vault.vault)
    const fetch = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).endsWith('/models')
        ? { data: [] }
        : { choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
      { status: 200 }
    )) as unknown as typeof globalThis.fetch
    const providerState = await store.getState()
    const provider = await store.resolveRuntimeProvider('provider-local')
    if (!provider) throw new Error('Missing runtime provider')
    const runtimeProviderState = {
      providers: providerState.providers.map((item) => item.id === provider.id ? provider : item)
    }

    expect(resolveChatModel(runtimeProviderState)).toMatchObject({
      ok: true,
      model: { apiKey: providerKeyFixture }
    })
    await testModelProviderConnection(provider, { fetch })
    await listRemoteProviderModels(provider, { fetch })
    await expect(createStructuredModelInvocationService({
      getProviderState: async () => runtimeProviderState,
      fetch
    }).invoke({
      taskId: 'fixture-task',
      messages: [{ role: 'user', content: 'fixture prompt' }],
      parse: (value) => value
    })).resolves.toMatchObject({ ok: true })

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${providerKeyFixture}` })
      })
    )
    expect(JSON.stringify(await store.list())).not.toContain(providerKeyFixture)
  })
})

function legacyProviderState(apiKey: string): unknown {
  return {
    providers: [legacyProvider('provider-local', apiKey)]
  }
}

function legacyProvider(id: string, apiKey: string): Record<string, unknown> {
  return {
    id,
    name: 'Local Provider',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
    ],
    enabled: true,
    baseUrl: 'https://example.test/v1',
    apiKey,
    models: []
  }
}

const providerSecretRefFixture = 'provider:70726f76696465722d6c6f63616c'

function providerRefFixture(providerId: string): SecretRef {
  return `provider:${Array.from(new TextEncoder().encode(providerId), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function vaultedProviderState(): PersistedProviderState {
  return vaultedProviderStateWithRef(providerSecretRefFixture)
}

function vaultedProviderStateWithRef(ref: SecretRef): PersistedProviderState {
  return {
    providers: [
      {
        id: 'provider-local',
        name: 'Local Provider',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test/v1' }
        ],
        enabled: true,
        baseUrl: 'https://example.test/v1',
        apiKeyRef: ref,
        apiKeyPreview: maskSecret(providerKeyFixture),
        apiKeyMigrationState: 'vault-backed',
        apiKeyStorageVersion: 1,
        models: []
      }
    ]
  }
}

function vaultedProviderStateWithSecondRef(secondaryRef: SecretRef): PersistedProviderState {
  const state = vaultedProviderState()
  return {
    providers: [
      ...state.providers,
      {
        id: 'provider-secondary',
        name: 'Secondary Provider',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://secondary.example.test/v1' }
        ],
        enabled: true,
        baseUrl: 'https://secondary.example.test/v1',
        apiKeyRef: secondaryRef,
        apiKeyPreview: 'fixt...7890',
        apiKeyMigrationState: 'vault-backed',
        apiKeyStorageVersion: 1,
        models: []
      }
    ]
  }
}

function createMemorySecretVault(input: {
  unavailable?: boolean
  deleteFails?: boolean
  failDeleteTimes?: number
  failPutForRef?: SecretRef
  failExistsForRef?: SecretRef
  failGetForRef?: SecretRef
  failHasForRef?: SecretRef
  values?: Map<SecretRef, string>
} = {}): {
  vault: SecretVault
  values: Map<SecretRef, string>
  putCount: number
  getCount: number
  existsCount: number
  hasCount: number
  inspectCount: number
  deleteCount: number
} {
  const values = input.values ?? new Map<SecretRef, string>()
  let putCount = 0
  let getCount = 0
  let existsCount = 0
  let hasCount = 0
  let inspectCount = 0
  let deleteCount = 0
  let remainingDeleteFailures = input.failDeleteTimes ?? 0
  const assertAvailable = () => {
    if (input.unavailable) throw new SecretVaultError('secret-vault-unavailable')
  }
  const metadata = (ref: SecretRef): SecretMetadata => ({
    ref,
    owner: providerOwner,
    revision: 1,
    hasSecret: true,
    preview: 'secret-set',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  })

  return {
    vault: {
      async put({ ref, value }) {
        assertAvailable()
        const nextRef = ref ?? `provider:${values.size + 1}`
        if (input.failPutForRef === nextRef) throw new SecretVaultError('secret-vault-unavailable')
        if (values.has(nextRef)) throw new SecretVaultError('secret-vault-ref-conflict')
        values.set(nextRef, value)
        putCount += 1
        return metadata(nextRef)
      },
      async get(ref) {
        assertAvailable()
        getCount += 1
        if (input.failGetForRef === ref) throw new SecretVaultError('secret-vault-record-invalid')
        return values.get(ref) ?? null
      },
      async rotate(ref, _owner, value) {
        assertAvailable()
        if (!values.has(ref)) throw new SecretVaultError('secret-vault-secret-not-found')
        values.set(ref, value)
        return metadata(ref)
      },
      async delete(ref) {
        assertAvailable()
        deleteCount += 1
        if (input.deleteFails || remainingDeleteFailures > 0) {
          remainingDeleteFailures -= 1
          throw new SecretVaultError('secret-vault-unavailable')
        }
        values.delete(ref)
      },
      async exists(ref) {
        assertAvailable()
        existsCount += 1
        if (input.failExistsForRef === ref) throw new SecretVaultError('secret-vault-record-invalid')
        return values.has(ref)
      },
      async has(ref) {
        assertAvailable()
        hasCount += 1
        if (input.failHasForRef === ref) throw new SecretVaultError('secret-vault-record-invalid')
        return values.has(ref)
      },
      async inspect(ref) {
        assertAvailable()
        inspectCount += 1
        return values.has(ref) ? metadata(ref) : null
      }
    },
    values,
    get putCount() {
      return putCount
    },
    get getCount() {
      return getCount
    },
    get existsCount() {
      return existsCount
    },
    get hasCount() {
      return hasCount
    },
    get inspectCount() {
      return inspectCount
    },
    get deleteCount() {
      return deleteCount
    }
  }
}

function orphanRecords(count: number): Array<{ providerId: string; ref: SecretRef }> {
  return Array.from({ length: count }, (_, index) => {
    const providerId = `orphan-${index}`
    return { providerId, ref: providerRefFixture(providerId) }
  })
}

describe('provider API key reveal seam', () => {
  it('reveals the vault-backed key for a known provider without mutating metadata or safe views', async () => {
    const writes: unknown[] = []
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, providerKeyFixture]])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async (value: unknown) => {
        writes.push(value)
      }
    }, vault.vault)

    await expect(store.revealApiKey('provider-local')).resolves.toBe(providerKeyFixture)

    expect(writes).toEqual([])
    expect(vault.getCount).toBe(1)
    expect(vault.putCount).toBe(0)
    const listed = (await store.list()).find((provider) => provider.id === 'provider-local')
    expect(listed).not.toHaveProperty('apiKey')
    expect(listed).not.toHaveProperty('apiKeyRef')
    expect(JSON.stringify(listed)).not.toContain(providerKeyFixture)
  })

  it('returns null for a provider without stored key material and never invents a value', async () => {
    const store = createProviderStore(undefined, createMemorySecretVault().vault)

    await expect(store.revealApiKey('openai')).resolves.toBeNull()
  })

  it('treats blank vault material as absent instead of returning an empty secret', async () => {
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, '   ']])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async () => undefined
    }, vault.vault)

    await expect(store.revealApiKey('provider-local')).resolves.toBeNull()
  })

  it('returns the trimmed key when the vault value carries surrounding whitespace', async () => {
    const vault = createMemorySecretVault({
      values: new Map([[providerSecretRefFixture, `  ${providerKeyFixture}  `]])
    })
    const store = createProviderStore({
      read: async () => vaultedProviderState(),
      write: async () => undefined
    }, vault.vault)

    await expect(store.revealApiKey('provider-local')).resolves.toBe(providerKeyFixture)
  })

  it('rejects unknown provider ids without reading the vault', async () => {
    const vault = createMemorySecretVault()
    const store = createProviderStore(undefined, vault.vault)

    await expect(store.revealApiKey('missing-provider')).rejects.toThrow(/was not found/)
    expect(vault.getCount).toBe(0)
  })
})
