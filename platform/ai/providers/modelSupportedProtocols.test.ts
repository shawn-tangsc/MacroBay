import { describe, expect, it } from 'vitest'

import type { ModelChatProtocol, ModelProvider, ProviderChatEndpoint } from './modelProviderTypes'
import { resolveModelListShape } from './modelList/modelListShapes'
import { normalizeRemoteModels } from './modelList/remoteModelNormalize'
import { applyModelSyncPlan } from './providerModelSync'
import {
  addOrUpdateModel,
  createDefaultProviderState,
  normalizeProviderState
} from './providerStore'

/**
 * PLAT-82：`supportedProtocols` = 厂商逐条声明 ∪ 供应商实际可用协议。
 *
 * 关键约束：
 *  - LANYUN 的 `x_lanyun.api_paths` 逐条声明 chat/messages/responses，一条模型可以同时支持三条；
 *  - TokenRhythm 的 `supports_anthropic` / `supports_responses` 布尔声明**并**供应商默认端点协议
 *    （声明 responses 的模型仍然能走 chat/completions）；
 *  - 纯 Gemini 只有 gemini（不凭空出现 chat/completions）；
 *  - `declarationSource: 'provider_list'` 只在布尔/路径声明命中时写，默认端点快照不产生它。
 */
function normalize(
  providerId: string,
  items: readonly unknown[],
  options: { endpoints?: ProviderChatEndpoint[]; providerDefaultProtocol?: ModelChatProtocol } = {}
) {
  return normalizeRemoteModels(
    items,
    resolveModelListShape({ id: providerId, endpoints: options.endpoints ?? chatEndpoints }),
    { ...(options.providerDefaultProtocol ? { providerDefaultProtocol: options.providerDefaultProtocol } : {}) }
  )
}

const chatEndpoints: ProviderChatEndpoint[] = [{ protocol: 'chat-completions', baseUrl: 'https://api.test' }]
const geminiEndpoints: ProviderChatEndpoint[] = [{ protocol: 'gemini', baseUrl: 'https://api.test' }]

function one(providerId: string, item: Record<string, unknown>, providerDefaultProtocol: ModelChatProtocol = 'chat-completions') {
  const models = normalize(providerId, [item], { providerDefaultProtocol })
  expect(models).toHaveLength(1)
  return models[0]!
}

describe('PLAT-82 model supported protocols', () => {
  it('collects all three LANYUN api_paths as supported protocols', () => {
    const model = one('lanyun', {
      id: 'automodel',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages', '/v1/responses'] }
    })

    expect(model.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
    // 声明只扩充"支持集合"，**不抢默认路由**：默认仍是供应商默认端点（chat/completions）。
    expect(model.chatProtocol).toBe('chat-completions')
    expect(model.declarationSource).toBe('provider_list')
  })

  it('keeps chat/completions when LANYUN only declares messages', () => {
    const model = one('lanyun', {
      id: 'chat-and-messages',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages'] }
    })
    expect(model.supportedProtocols).toEqual(['chat-completions', 'messages'])
    expect(model.chatProtocol).toBe('chat-completions')
  })

  it('merges the provider default endpoint into TokenRhythm boolean declarations', () => {
    const responsesOnly = one('tokenrhythm', { id: 'glm-5', supports_responses: true })
    expect(responsesOnly.chatProtocol).toBe('chat-completions')
    // 声明 responses 不等于失去 chat/completions：默认端点协议仍旧可用。
    expect(responsesOnly.supportedProtocols).toEqual(['chat-completions', 'responses'])
    expect(responsesOnly.declarationSource).toBe('provider_list')

    const anthropic = one('tokenrhythm', { id: 'claude-x', supports_anthropic: true })
    expect(anthropic.chatProtocol).toBe('chat-completions')
    expect(anthropic.supportedProtocols).toEqual(['chat-completions', 'messages'])

    const plain = one('tokenrhythm', { id: 'plain-chat' })
    expect(plain.supportedProtocols).toEqual(['chat-completions'])
    // 只有默认端点快照，没有厂商逐条声明 ⇒ 不写声明来源。
    expect(plain.declarationSource).toBeUndefined()
  })

  it('gives a pure Gemini model only the gemini protocol', () => {
    const model = one('gemini', { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, 'gemini')
    expect(model.chatProtocol).toBe('gemini')
    expect(model.supportedProtocols).toEqual(['gemini'])
    expect(model.declarationSource).toBeUndefined()
  })

  it('never lets the provider default endpoint drag non-chat models into a protocol pill', () => {
    // 产品仲裁 2026-10-20：媒体/向量模型只保留厂商逐条**声明**的协议；
    // 供应商默认端点（chat-completions）只并入聊天模型。
    const embedding = one('tokenrhythm', { id: 'text-embedding-3-large', type: 'embedding', supports_responses: true })
    expect(embedding.capabilities.chat).toBe(false)
    expect(embedding.chatProtocol).toBeUndefined()
    expect(embedding.supportedProtocols).toEqual(['responses'])

    const silentVideo = one('lanyun', { id: 'doubao-seedance-2-0', model_type: 'video', status: 1 })
    expect(silentVideo.capabilities.videoGeneration).toBe(true)
    expect(silentVideo.supportedProtocols).toBeUndefined()

    // 厂商确实逐条声明了 chat 路径的媒体模型才计入（以声明为准）。
    const declaredVideo = one('lanyun', {
      id: 'video-with-chat-path',
      model_type: 'video',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/video/generations'] }
    })
    expect(declaredVideo.capabilities.chat).toBe(false)
    expect(declaredVideo.supportedProtocols).toEqual(['chat-completions'])
  })

  it('backfills legacy models once and keeps declarations through an edit', () => {
    const legacy = normalizeProviderState({
      providers: [{
        id: 'lanyun',
        name: 'LANYUN',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://maas-api.lanyun.net' },
          { protocol: 'responses', baseUrl: 'https://maas-api.lanyun.net/v1' },
          { protocol: 'messages', baseUrl: 'https://maas-api.lanyun.net' }
        ],
        enabled: true,
        baseUrl: 'https://maas-api.lanyun.net',
        models: [{
          id: 'deepseek-ai/DeepSeek-R1',
          name: 'DeepSeek-R1',
          capabilities: { chat: true },
          messagesSupport: 'yes',
          responsesSupport: 'yes'
        }]
      }]
    })
    const lanyun = legacy.providers.find((provider) => provider.id === 'lanyun')!
    const backfilled = lanyun.models.find((model) => model.id === 'deepseek-ai/DeepSeek-R1')!
    expect(backfilled.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])

    // 编辑（只改名字/能力）后声明字段不得丢失。
    const editing = addOrUpdateModel(legacy, 'lanyun', {
      ...backfilled,
      name: 'DeepSeek-R1 (edited)'
    })
    const edited = editing.providers.find((provider) => provider.id === 'lanyun')!.models
      .find((model) => model.id === 'deepseek-ai/DeepSeek-R1')!
    expect(edited.name).toBe('DeepSeek-R1 (edited)')
    expect(edited.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
    expect(edited.messagesSupport).toBe('yes')
    expect(edited.responsesSupport).toBe('yes')

    // 抽屉不带声明字段回来（只改能力）时也必须保留。
    const editingAgain = addOrUpdateModel(editing, 'lanyun', {
      id: edited.id,
      name: edited.name,
      capabilities: { ...edited.capabilities, tools: true }
    })
    expect(editingAgain.providers.find((provider) => provider.id === 'lanyun')!.models
      .find((model) => model.id === 'deepseek-ai/DeepSeek-R1')!.supportedProtocols)
      .toEqual(['chat-completions', 'responses', 'messages'])
  })

  it('keeps provider defaults out of a legacy model that already declares protocols', () => {
    const state = createDefaultProviderState()
    const provider = state.providers.find((entry) => entry.id === 'lanyun')
    expect(provider?.endpoints[0]?.protocol).toBe('chat-completions')

    const withModel = addOrUpdateModel(state, 'lanyun', {
      id: 'declared-model',
      name: 'Declared Model',
      capabilities: { chat: true },
      chatProtocol: 'messages',
      supportedProtocols: ['messages', 'responses']
    })
    const model = withModel.providers.find((entry) => entry.id === 'lanyun')!.models
      .find((entry) => entry.id === 'declared-model')!
    expect(model.supportedProtocols).toEqual(['responses', 'messages'])
  })

  it('keeps the default endpoint out of declaredProtocols', () => {
    // TokenRhythm 无逐条声明的模型：可用集合有 chat/completions（默认端点），但声明集合为空。
    const plain = one('tokenrhythm', { id: 'plain-chat' })
    expect(plain.supportedProtocols).toEqual(['chat-completions'])
    expect(plain.declaredProtocols).toBeUndefined()

    // 媒体模型两条都不并默认端点。
    const video = one('lanyun', { id: 'seedance', model_type: 'video', status: 1 })
    expect(video.capabilities.videoGeneration).toBe(true)
    expect(video.supportedProtocols).toBeUndefined()
    expect(video.declaredProtocols).toBeUndefined()
  })

  it('only vendor declarations land in declaredProtocols', () => {
    const declared = one('lanyun', {
      id: 'automodel',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages'] }
    })
    // 可用集合含默认端点（chat）+ 声明（messages/chat）。
    expect(declared.supportedProtocols).toEqual(['chat-completions', 'messages'])
    // 声明集合**只**含厂商那条（chat 路径与 messages），不含任何"默认端点补充"。
    expect(declared.declaredProtocols).toEqual(['chat-completions', 'messages'])
    expect(declared.declarationSource).toBe('provider_list')
  })

  it('backfills declaredProtocols only from explicit messages/responses declarations', () => {
    const state = normalizeProviderState({
      providers: [{
        id: 'lanyun',
        name: 'LANYUN',
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://maas-api.lanyun.net' }],
        enabled: true,
        models: [
          {
            id: 'declared-model',
            name: 'Declared Model',
            capabilities: { chat: true },
            messagesSupport: 'yes',
            responsesSupport: 'no'
          },
          { id: 'plain-model', name: 'Plain Model', capabilities: { chat: true } },
          { id: 'video-model', name: 'Video Model', capabilities: { chat: false, videoGeneration: true } }
        ]
      }]
    })
    const models = state.providers.find((provider) => provider.id === 'lanyun')!.models
    const declared = models.find((model) => model.id === 'declared-model')!
    // 可用：默认端点 + 声明；声明：只有 messages。
    expect(declared.supportedProtocols).toEqual(['chat-completions', 'messages'])
    expect(declared.declaredProtocols).toEqual(['messages'])

    // 没有逐条声明 ⇒ 声明集合为空（默认端点不产生它）。
    expect(models.find((model) => model.id === 'plain-model')!.declaredProtocols).toBeUndefined()
    expect(models.find((model) => model.id === 'plain-model')!.supportedProtocols)
      .toEqual(['chat-completions'])
    // 媒体模型：两条都没有。
    const video = models.find((model) => model.id === 'video-model')!
    expect(video.declaredProtocols).toBeUndefined()
    expect(video.supportedProtocols).toBeUndefined()
  })

  it('keeps detection evidence (probedProtocols) through normalization and an edit', () => {
    const state = addOrUpdateModel(createDefaultProviderState(), 'silicon', {
      id: 'deepseek-v3-2',
      name: 'DeepSeek V3.2',
      capabilities: { chat: true },
      supportedProtocols: ['chat-completions', 'messages'],
      probedProtocols: ['messages']
    })
    const reloaded = normalizeProviderState(JSON.parse(JSON.stringify(state)))
    const model = reloaded.providers.find((entry) => entry.id === 'silicon')?.models
      .find((entry) => entry.id === 'deepseek-v3-2')

    expect(model?.probedProtocols).toEqual(['messages'])
    // 实测证据不会被默认端点带偏：chat/completions 仍是"按默认端点推断"。
    expect(model?.declaredProtocols).toBeUndefined()
  })

  it('writes declarationSource end-to-end through the sync plan', () => {
    const local: ModelProvider = {
      id: 'tokenrhythm',
      name: 'TokenRhythm',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' },
        { protocol: 'responses', baseUrl: 'https://tokenrhythm.studio/v1' },
        { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }
      ],
      enabled: true,
      baseUrl: 'https://tokenrhythm.studio',
      models: [{ id: 'legacy-chat', name: 'legacy-chat', capabilities: { chat: true } }]
    }
    // 真实链路：`listRemoteProviderModels` 会把供应商默认端点协议传给归一化。
    const remote = normalize('tokenrhythm', [
      { id: 'glm-5', supports_responses: true },
      { id: 'glm-6', supports_anthropic: true },
      { id: 'glm-7', supports_tools: true }
    ], { providerDefaultProtocol: 'chat-completions' })
    const next = applyModelSyncPlan({ providers: [local] }, 'tokenrhythm', {
      toAdd: remote,
      toUpdate: [],
      toRemove: ['legacy-chat']
    })
    const models = next.providers[0]!.models
    expect(models.find((model) => model.id === 'glm-5')).toMatchObject({
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses']
    })
    expect(models.find((model) => model.id === 'glm-6')).toMatchObject({
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'messages']
    })
    expect(models.find((model) => model.id === 'glm-7')?.declarationSource).toBeUndefined()
    expect(models.find((model) => model.id === 'glm-7')?.supportedProtocols).toEqual(['chat-completions'])
  })
})
