import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider, ProviderState } from './modelProviderTypes'
import {
  applyModelSyncPlan,
  buildModelSyncPreview,
  listRemoteProviderModels,
  normalizeModelSyncPlan,
  previewProviderModelSync
} from './providerModelSync'

function createProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'openai',
    name: 'OpenAI',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' }
    ],
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    isSystem: true,
    models: [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: 'preset',
        presetModel: true,
        capabilities: { chat: true, vision: false, embedding: false, tools: true }
      },
      {
        id: 'local-only',
        name: 'Local Only',
        capabilities: { chat: true }
      }
    ],
    defaultChatModelId: 'gpt-5',
    ...overrides
  }
}

describe('provider model sync', () => {
  it('lists remote OpenAI-compatible models from the provider models endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-5', object: 'model' },
            { id: 'text-embedding-3-large', object: 'model' }
          ]
        }),
        { status: 200 }
      )
    )

    const models = await listRemoteProviderModels(createProvider(), { fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' })
      })
    )
    expect(models.map((model) => model.id)).toEqual(['gpt-5', 'text-embedding-3-large'])
    expect(models.find((model) => model.id === 'text-embedding-3-large')?.capabilities.embedding).toBe(true)
  })

  it('returns a structured failure instead of throwing when the remote list is rejected', async () => {
    const unauthorized = await previewProviderModelSync(createProvider(), {
      fetch: vi.fn(async () => new Response('', { status: 401 }))
    })
    const serverError = await previewProviderModelSync(createProvider(), {
      fetch: vi.fn(async () => new Response('', { status: 500 }))
    })
    const offline = await previewProviderModelSync(createProvider(), {
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
      })
    })

    expect(unauthorized).toMatchObject({ ok: false, reasonCode: 'http_401' })
    expect(serverError).toMatchObject({ ok: false, reasonCode: 'http_5xx' })
    expect(offline).toMatchObject({ ok: false, reasonCode: 'network_dns' })
    // 结构化失败也不泄露密钥或通道名。
    expect(JSON.stringify([unauthorized, serverError, offline])).not.toContain('sk-test')
    expect(JSON.stringify([unauthorized, serverError, offline])).not.toContain('platform:')
  })

  it('carries the upstream balance message so the UI can explain the real cause', async () => {
    const outcome = await previewProviderModelSync(createProvider(), {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Your account balance is insufficient. Please recharge.' } }), { status: 402 }))
    })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'account_balance_insufficient' })
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.upstreamMessage).toContain('balance is insufficient')
    expect(outcome.message).toContain('HTTP 402')
    expect(JSON.stringify(outcome)).not.toContain('sk-test')
  })

  it('summarizes a JSON error body into one readable line instead of raw JSON', async () => {
    const outcome = await previewProviderModelSync(createProvider(), {
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ code: 401, msg: 'APIkey或者用户异常', data: null }),
        { status: 401 }
      ))
    })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'http_401' })
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.message).toBe('HTTP 401 · APIkey或者用户异常')
    expect(outcome.upstreamMessage).toBe('APIkey或者用户异常')
    expect(outcome.message).not.toContain('{"')
    expect(outcome.message).not.toContain('"data":null')
    expect(outcome.upstreamMessage).not.toContain('{"')
    expect(JSON.stringify(outcome)).not.toContain('sk-test')
  })

  it('allows listing models for a disabled provider (read-only fetch)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }))
    const outcome = await previewProviderModelSync(createProvider({ enabled: false }), { fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(outcome.ok).toBe(true)
  })

  it('classifies missing key / invalid address sync attempts', async () => {
    const missingKey = await previewProviderModelSync(createProvider({ apiKey: '' }), { fetch: vi.fn() })
    const invalidUrl = await previewProviderModelSync(createProvider({ baseUrl: 'not-a-url' }), { fetch: vi.fn() })

    expect(missingKey).toMatchObject({ ok: false, reasonCode: 'missing_api_key' })
    expect(invalidUrl).toMatchObject({ ok: false, reasonCode: 'invalid_base_url' })
  })

  it('keeps the existing added/missing fields when the sync preview succeeds', async () => {
    const provider = createProvider({
      models: [
        { id: 'gpt-5', name: 'GPT-5', provider: 'preset', presetModel: true, capabilities: { chat: true, vision: false, embedding: false, tools: true } },
        { id: 'retired-model', name: 'Retired', provider: 'preset', presetModel: true, capabilities: { chat: true, vision: false, embedding: false, tools: true } }
      ]
    })
    const outcome = await previewProviderModelSync(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-6' }] }), { status: 200 }))
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok preview')
    expect(outcome.added.map((model) => model.id)).toEqual(['gpt-6'])
    expect(outcome.missing.map((item) => item.model.id)).toEqual(['retired-model'])
  })

  it('does not include the provider key when a model sync error echoes it', async () => {
    const provider = createProvider({ apiKey: 'fixture-provider-key-1234567890' })

    await expect(listRemoteProviderModels(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: provider.apiKey } }), { status: 401 }))
    })).rejects.not.toThrow(provider.apiKey)
  })

  it('does not include a URL-encoded provider key when model sync fails', async () => {
    const provider = createProvider({ apiKey: 'fixture-provider-key-1234+/=' })
    const encodedKey = encodeURIComponent(provider.apiKey!)

    await expect(listRemoteProviderModels(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: encodedKey } }), { status: 401 }))
    })).rejects.not.toThrow(encodedKey)
  })

  it('overwrites an existing preset model with the synced record', () => {
    const provider = createProvider({
      models: [{ id: 'gpt-5', name: 'gpt-5', presetModel: true, capabilities: { chat: true, tools: true } }]
    })
    const remote = {
      id: 'gpt-5',
      name: 'GPT-5',
      group: 'openai',
      contextLength: 400000,
      maxCompletionTokens: 128000,
      pricing: { currency: 'USD', promptPerMillion: 1.25, completionPerMillion: 10 },
      capabilities: { chat: true, tools: true, vision: true, reasoning: true }
    }

    const preview = buildModelSyncPreview(provider, [remote])
    expect(preview.updated.map((model) => model.id)).toEqual(['gpt-5'])
    expect(preview.updated[0]).toMatchObject({
      name: 'GPT-5',
      group: 'openai',
      contextLength: 400000,
      maxCompletionTokens: 128000,
      pricing: { promptPerMillion: 1.25 },
      capabilities: { chat: true, tools: true, vision: true, reasoning: true }
    })
    // 覆盖不等于放宽 providerDeclared：没给那四个字面字段就保持 undefined，避免放大 missing 清理组。
    expect(preview.updated[0]?.providerDeclared).toBeUndefined()
    expect(preview.missing).toHaveLength(0)

    const next = applyModelSyncPlan({ providers: [provider] }, 'openai', {
      toAdd: [],
      toUpdate: preview.updated,
      toRemove: []
    })
    expect(next.providers[0]?.models[0]).toMatchObject({ presetModel: true, contextLength: 400000 })
  })

  it('leaves user-edited models untouched', () => {
    const provider = createProvider({
      models: [{ id: 'gpt-5', name: 'GPT-5', capabilities: { chat: true, tools: false, capabilitiesEdited: true } }]
    })
    const preview = buildModelSyncPreview(provider, [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        contextLength: 1000,
        capabilities: { chat: true, tools: true, vision: true }
      }
    ])

    expect(preview.updated).toHaveLength(0)
    expect(preview.missing).toHaveLength(0)
  })

  it('builds a preview with added remote models and missing preset models only', () => {
    const preview = buildModelSyncPreview(createProvider(), [
      {
        id: 'gpt-5-mini',
        name: 'gpt-5-mini',
        capabilities: { chat: true, vision: false, embedding: false, tools: true }
      }
    ])

    expect(preview.added.map((model) => model.id)).toEqual(['gpt-5-mini'])
    expect(preview.missing.map((item) => item.model.id)).toEqual(['gpt-5'])
    expect(preview.missing.map((item) => item.model.id)).not.toContain('local-only')
  })

  it('applies selected additions and removals to the target provider only', () => {
    const state: ProviderState = {
      providers: [
        createProvider(),
        createProvider({
          id: 'deepseek',
          name: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          models: [
            {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              provider: 'preset',
              capabilities: { chat: true, vision: false, embedding: false, tools: true }
            }
          ]
        })
      ]
    }

    const next = applyModelSyncPlan(state, 'openai', {
      toAdd: [
        {
          id: 'gpt-5-mini',
          name: 'gpt-5-mini',
          capabilities: { chat: true, vision: false, embedding: false, tools: true }
        }
      ],
      toUpdate: [],
      toRemove: ['gpt-5']
    })

    expect(next.providers.find((provider) => provider.id === 'openai')?.models.map((model) => model.id)).toEqual([
      'local-only',
      'gpt-5-mini'
    ])
    expect(next.providers.find((provider) => provider.id === 'deepseek')?.models.map((model) => model.id)).toEqual([
      'deepseek-chat'
    ])
  })

  it('normalizes IPC sync plan payloads before applying them', () => {
    expect(
      normalizeModelSyncPlan({
        toAdd: [
          {
            id: ' chat-model ',
            name: ' Chat Model ',
            capabilities: { chat: true }
          },
          {
            id: '',
            name: 'Broken'
          }
        ],
        toRemove: ['old-model', '', 42]
      })
    ).toEqual({
      toAdd: [
        {
          id: 'chat-model',
          name: 'Chat Model',
          provider: 'remote',
          capabilities: { chat: true },
          priceTag: 'paid'
        }
      ],
      toUpdate: [],
      toRemove: ['old-model']
    })
  })

  it('preserves explicit agent capability in synced model payloads', () => {
    expect(
      normalizeModelSyncPlan({
        toAdd: [
          {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            capabilities: { chat: true, tools: true, agentRuntimes: { claudeCode: true } }
          }
        ],
        toRemove: []
      }).toAdd
    ).toEqual([
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'remote',
        capabilities: { chat: true, tools: true, agentRuntimes: { claudeCode: true } },
        priceTag: 'paid'
      }
    ])
  })
  it('preserves the manual free mark across sync-plan IPC normalization', () => {
    expect(
      normalizeModelSyncPlan({
        toAdd: [],
        toUpdate: [
          {
            id: 'paid-model',
            name: 'Paid Model',
            capabilities: { chat: true },
            freeOverride: true
          }
        ],
        toRemove: []
      }).toUpdate
    ).toEqual([
      {
        id: 'paid-model',
        name: 'Paid Model',
        provider: 'remote',
        capabilities: { chat: true },
        freeOverride: true,
        priceTag: 'free'
      }
    ])
  })

  it('normalizes zero-price sync payloads to the free price tag', () => {
    expect(
      normalizeModelSyncPlan({
        toAdd: [
          {
            id: 'free-model',
            name: 'Free Model',
            capabilities: { chat: true },
            pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 }
          }
        ],
        toRemove: []
      }).toAdd[0].priceTag
    ).toBe('free')
  })

  it('parses provider capability fields and records the declaration, not a probe result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'glm-5.1', supports_anthropic: true, supports_tools: true, supports_vision: false, supports_reasoning: true },
        { id: 'qwen3.7-max', supports_anthropic: false, supports_tools: true, supports_vision: true, supports_reasoning: true },
        { id: 'deepseek-r1', supports_anthropic: true, supports_tools: true, supports_vision: false, supports_reasoning: true },
        { id: 'plain-chat', supports_tools: false, supports_vision: false }
      ]
    }), { status: 200 }))

    const models = await listRemoteProviderModels(createProvider(), { fetch: fetchMock })
    const byId = Object.fromEntries(models.map((model) => [model.id, model]))

    expect(byId['glm-5.1']).toMatchObject({
      messagesSupport: 'yes',
      declarationSource: 'provider_list',
      capabilities: { chat: true, tools: true }
    })
    // PLAT-82：同步不再产生探测结论（历史值由同步链原样 forward，不由归一化新写）。
    expect(byId['glm-5.1'].probeStatus).toBeUndefined()
    expect(byId['glm-5.1'].probeReason).toBeUndefined()
    expect(byId['glm-5.1'].protocolProbedAt).toBeUndefined()
    // PLAT-77 D9：上游声明 supports_reasoning 即生效，不再用 id 正则二次否决。
    expect(byId['glm-5.1'].capabilities.reasoning).toBe(true)

    expect(byId['qwen3.7-max']).toMatchObject({
      messagesSupport: 'no',
      declarationSource: 'provider_list',
      capabilities: { chat: true, tools: true, vision: true }
    })
    expect(byId['qwen3.7-max'].probeStatus).toBeUndefined()
    expect(byId['qwen3.7-max'].capabilities.reasoning).toBe(true)

    expect(byId['deepseek-r1'].capabilities).toMatchObject({ chat: true, reasoning: true })
    expect(byId['plain-chat'].messagesSupport).toBeUndefined()
    expect(byId['plain-chat'].declarationSource).toBeUndefined()
    expect(byId['plain-chat'].capabilities.tools).toBeUndefined()
    expect(byId['plain-chat'].capabilities.vision).toBeUndefined()
  })

  it('updates existing declared models while respecting edited capabilities', () => {
    const local = createProvider({
      models: [
        { id: 'glm-5.1', name: 'glm-5.1', capabilities: { chat: true } },
        { id: 'qwen3.7-max', name: 'Qwen Custom', capabilities: { chat: true, capabilitiesEdited: true } }
      ]
    })
    const declared = (id: string, anthropic: boolean): Parameters<typeof buildModelSyncPreview>[1][number] => ({
      id,
      name: id,
      capabilities: { chat: true, tools: true, vision: true },
      messagesSupport: anthropic ? 'yes' : 'no',
      declarationSource: 'provider_list',
      providerDeclared: true
    })

    const preview = buildModelSyncPreview(local, [declared('glm-5.1', true), declared('qwen3.7-max', false)])
    expect(preview.added).toHaveLength(0)
    expect(preview.updated.map((model) => model.id)).toEqual(['glm-5.1'])

    const next = applyModelSyncPlan({ providers: [local] }, 'openai', {
      toAdd: [],
      toUpdate: preview.updated,
      toRemove: []
    })
    const models = next.providers[0].models
    expect(models.find((model) => model.id === 'glm-5.1')).toMatchObject({
      messagesSupport: 'yes',
      declarationSource: 'provider_list',
      capabilities: { tools: true, vision: true }
    })
    expect(models.find((model) => model.id === 'qwen3.7-max')?.messagesSupport).toBeUndefined()
  })

  it('parses context length and pricing (string numbers, effective pricing, discounts)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 'glm-5.1',
        context_length: 200000,
        max_completion_tokens: '32000',
        pricing: { currency: 'CNY', prompt: '8.00000000', completion: '28.00000000', cache_read: '2.00000000', has_discount: false },
        effective_pricing: { currency: 'CNY', prompt: '4.00000000', completion: '14.00000000', cache_read: '1.00000000' },
        has_discount: true
      }, {
        id: 'plain-chat'
      }]
    }), { status: 200 }))

    const models = await listRemoteProviderModels(createProvider(), { fetch: fetchMock })
    expect(models[0]).toMatchObject({
      id: 'glm-5.1',
      contextLength: 200000,
      maxCompletionTokens: 32000,
      pricing: {
        currency: 'CNY',
        promptPerMillion: 4,
        completionPerMillion: 14,
        cacheReadPerMillion: 1,
        hasDiscount: true
      }
    })
    expect(models[1].contextLength).toBeUndefined()
    expect(models[1].pricing).toBeUndefined()
  })

  it('injects custom headers into model sync requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await listRemoteProviderModels(createProvider({
      customHeaders: [
        { name: 'X-Test', value: '1' },
        { name: 'authorization', value: 'must-not-override' }
      ]
    }), { fetch: fetchMock })

    const headers = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-Test']).toBe('1')
    expect(headers.authorization).toBe('Bearer sk-test')
  })

})

describe('PLAT-70 provider lifecycle status (volcengine ark)', () => {
  it('skips models the provider reports as Shutdown', async () => {
    const provider = createProvider()
    const outcome = await previewProviderModelSync(provider, {
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'doubao-seed-2-1-pro-260915', object: 'model', status: null },
              { id: 'doubao-lite-32k-240428', object: 'model', status: 'Shutdown' },
              { id: 'doubao-pro-4k-240515', object: 'model', status: 'shutdown' },
              { id: 'doubao-retiring-model', object: 'model', status: 'Retiring' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.added.map((model) => model.id)).toEqual([
      'doubao-seed-2-1-pro-260915',
      // Retiring 仍可用：只提示、不丢弃
      'doubao-retiring-model'
    ])
  })

  it('offers to remove synced models the provider no longer lists', () => {
    const provider = createProvider({
      models: [
        ...createProvider().models,
        {
          id: 'doubao-lite-32k-240428',
          name: 'doubao-lite-32k',
          provider: 'remote',
          providerDeclared: true,
          capabilities: { chat: true, vision: false, embedding: false, tools: false }
        }
      ]
    })

    const preview = buildModelSyncPreview(provider, [
      {
        id: 'gpt-5-mini',
        name: 'gpt-5-mini',
        capabilities: { chat: true, vision: false, embedding: false, tools: true }
      }
    ])

    // 已下线的同步模型会出现在「待清理」里，由用户勾选确认后才删除
    expect(preview.missing.map((item) => item.model.id)).toContain('doubao-lite-32k-240428')
    // 手填模型（非 preset、非 providerDeclared）永远不进清理列表
    expect(preview.missing.map((item) => item.model.id)).not.toContain('local-only')
  })
})
