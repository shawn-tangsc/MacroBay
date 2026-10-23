import { describe, expect, it } from 'vitest'

import {
  addOrUpdateModel,
  createDefaultProviderState,
  normalizeProviderState,
  toSafeProvider
} from './providerStore'
import { applyModelSyncPlan } from './providerModelSync'

/**
 * T4/T5：模型级聊天协议必须能 round-trip（否则重启后被静默改回默认链路），
 * 脏值一律丢弃（宁可走默认 chat/completions，也不能把请求发到错的端点）。
 */
function stateWithModel(chatProtocol: unknown) {
  return normalizeProviderState({
    providers: [
      {
        id: 'acme',
        name: 'Acme',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }
        ],
        enabled: true,
        baseUrl: 'https://api.acme.test',
        models: [
          {
            id: 'acme-chat',
            name: 'Acme Chat',
            capabilities: { chat: true },
            chatProtocol
          }
        ]
      }
    ]
  })
}

describe('model chat protocol persistence', () => {
  it('round-trips responses / gemini / chat-completions through normalization', () => {
    for (const protocol of ['chat-completions', 'responses', 'gemini'] as const) {
      expect(stateWithModel(protocol).providers[0]?.models[0]?.chatProtocol).toBe(protocol)
    }
  })

  it('drops unknown values and falls back to the provider default protocol', () => {
    // T4/T5：协议是模型自己的事实；脏值丢弃，加载时按供应商默认端点回填一次快照。
    for (const value of ['anthropic', 'Responses', '', ' ', 42, null, undefined, {}]) {
      expect(stateWithModel(value).providers[0]?.models[0]?.chatProtocol).toBe('chat-completions')
    }
  })

  it('keeps the selection across a model update and a provider update', () => {
    let state = stateWithModel('responses')
    const updated = addOrUpdateModel(state, 'acme', {
      id: 'acme-chat',
      name: 'Acme Chat',
      capabilities: { chat: true },
      chatProtocol: 'responses'
    })
    expect(updated.providers[0]?.models[0]?.chatProtocol).toBe('responses')

    // 落盘 → 重新加载（JSON round-trip）后选择仍在
    state = normalizeProviderState(updated)
    expect(state.providers[0]?.models[0]?.chatProtocol).toBe('responses')
  })

  it('is visible on the safe provider view (renderer needs it to show the selection)', () => {
    const state = stateWithModel('gemini')
    const safe = toSafeProvider(state.providers[0]!)
    expect(safe.models[0]?.chatProtocol).toBe('gemini')
    // 安全视图不得带出原始 Key（`apiKeyPreview`/`hasApiKey` 是既有字段，属预期）
    expect((safe as unknown as Record<string, unknown>).apiKey).toBeUndefined()
  })

  it('survives a model sync update (provider-declared models must not wipe the user selection)', () => {
    const state = stateWithModel('responses')

    const synced = applyModelSyncPlan(state, 'acme', {
      toAdd: [{ id: 'acme-new', name: 'Acme New', capabilities: { chat: true } }],
      toUpdate: [{ id: 'acme-chat', name: 'Acme Chat (synced)', capabilities: { chat: true } }],
      toRemove: []
    })

    const models = synced.providers[0]?.models ?? []
    expect(models.find((model) => model.id === 'acme-chat')?.chatProtocol).toBe('responses')
    expect(models.find((model) => model.id === 'acme-new')?.chatProtocol).toBe('chat-completions')
  })

  it('gives every chat preset model its own protocol (declared, else the provider default)', () => {
    // T4/T5：协议写在模型记录上（不再是"不写字段 = 跟随默认"）。
    // 官方三家各有原生链路（gemini / messages / responses），其余 = 供应商默认（豆包是 chat/completions）。
    const official: Record<string, string> = {
      gemini: 'gemini',
      anthropic: 'messages',
      openai: 'responses'
    }
    const defaults = createDefaultProviderState()
    for (const provider of defaults.providers) {
      for (const model of provider.models) {
        if (!model.capabilities.chat) {
          expect(model.chatProtocol, `${provider.id}/${model.id}`).toBeUndefined()
          continue
        }
        expect(model.chatProtocol, `${provider.id}/${model.id}`)
          .toBe(official[provider.id] ?? provider.endpoints[0]?.protocol)
      }
    }
  })
})

describe('declared-but-unconfigured endpoints', () => {
  it('keeps an empty endpoint address through normalization so the row survives a restart', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'acme',
          name: 'Acme',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
            { protocol: 'responses', baseUrl: '' },
            { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' }
          ],
          enabled: true,
          models: []
        }
      ]
    })

    // 空串 = 已声明未配置：必须原样保留，否则清空的端点行重启后会复活。
    expect(state.providers[0]?.endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'responses', baseUrl: '' },
      { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' }
    ])
  })
})
