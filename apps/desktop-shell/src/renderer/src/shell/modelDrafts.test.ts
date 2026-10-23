import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { buildModelDefinitionFromDraft, createEmptyModelDraft, createModelDraftFromModel } from './modelDrafts'

describe('model drafts', () => {
  it('creates a chat-capable add-model draft without agent protocol support by default', () => {
    expect(createEmptyModelDraft()).toMatchObject({
      id: '',
      name: '',
      capabilities: {
        chat: true,
        vision: false,
        embedding: false,
        tools: true
      }
    })
    expect(createEmptyModelDraft().capabilities.agentRuntimes).toBeUndefined()
  })

  it('round-trips the model chat protocol through the draft', () => {
    const base: ModelDefinition = {
      id: 'acme-chat',
      name: 'Acme Chat',
      capabilities: { chat: true }
    }

    const responsesDraft = createModelDraftFromModel({ ...base, chatProtocol: 'responses' })
    expect(responsesDraft.chatProtocol).toBe('responses')
    expect(buildModelDefinitionFromDraft(responsesDraft).chatProtocol).toBe('responses')

    const geminiDraft = createModelDraftFromModel({ ...base, chatProtocol: 'gemini' })
    expect(buildModelDefinitionFromDraft(geminiDraft).chatProtocol).toBe('gemini')

    // 默认链路不写字段：老数据与新数据形状一致
    const defaultDraft = createModelDraftFromModel(base)
    expect(defaultDraft.chatProtocol).toBeUndefined()
    expect(buildModelDefinitionFromDraft(defaultDraft).chatProtocol).toBeUndefined()
  })

  it('round-trips the vendor declaration fields through the draft (PLAT-82)', () => {
    // 抽屉只编辑名字/能力，声明字段必须原样带回来，否则保存一次就丢厂商声明。
    const model: ModelDefinition = {
      id: 'automodel',
      name: 'AutoModel',
      capabilities: { chat: true },
      chatProtocol: 'messages',
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages']
    }

    const draft = createModelDraftFromModel(model)
    expect(draft).toMatchObject({
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages']
    })
    draft.name = 'AutoModel Edited'

    expect(buildModelDefinitionFromDraft(draft)).toMatchObject({
      name: 'AutoModel Edited',
      chatProtocol: 'messages',
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages']
    })
  })

  it('round-trips the detection evidence through the draft (PLAT-82)', () => {
    // 实测通过的证据也要随草稿往返：否则在抽屉里改一次能力就把「实测通过」洗掉了。
    const model: ModelDefinition = {
      id: 'silicon-v3',
      name: 'DeepSeek V3.2',
      capabilities: { chat: true },
      supportedProtocols: ['chat-completions', 'messages'],
      probedProtocols: ['messages']
    }

    const draft = createModelDraftFromModel(model)
    expect(draft.probedProtocols).toEqual(['messages'])
    expect(buildModelDefinitionFromDraft(draft).probedProtocols).toEqual(['messages'])

    // 没有证据的模型不多出字段
    expect(createModelDraftFromModel({ id: 'plain', name: 'Plain', capabilities: { chat: true } }).probedProtocols)
      .toBeUndefined()
  })

  it('round-trips the manual free mark and read-only price fields through the draft', () => {
    const model: ModelDefinition = {
      id: 'manual-free',
      name: 'Manual Free',
      capabilities: { chat: true },
      pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, displayPrecision: 4 },
      contextLength: 128000,
      maxCompletionTokens: 8192,
      freeOverride: true
    }

    const draft = createModelDraftFromModel(model)
    expect(draft).toMatchObject({ freeOverride: true, contextLength: 128000, maxCompletionTokens: 8192 })
    expect(draft.pricing).toEqual(model.pricing)
    const built = buildModelDefinitionFromDraft(draft)
    // 抽屉不编辑价格/上下文，但保存时不能把它们抹掉。
    expect(built).toMatchObject({
      freeOverride: true,
      priceTag: 'free',
      pricing: { currency: 'USD', promptPerMillion: 8, completionPerMillion: 28, displayPrecision: 4 },
      contextLength: 128000,
      maxCompletionTokens: 8192
    })

    // 关闭标记 = 删除字段，回到价格自动判定。
    const cleared = buildModelDefinitionFromDraft({ ...draft, freeOverride: undefined })
    expect(cleared.freeOverride).toBeUndefined()
    expect(cleared.priceTag).toBe('paid')
    expect(cleared.pricing).toEqual(model.pricing)
  })

  it('does not add price or free fields when the model has none', () => {
    const draft = createModelDraftFromModel({ id: 'plain', name: 'Plain', capabilities: { chat: true } })
    expect(draft.freeOverride).toBeUndefined()
    expect(draft.pricing).toBeUndefined()
    expect(buildModelDefinitionFromDraft(draft).freeOverride).toBeUndefined()
    expect(buildModelDefinitionFromDraft(draft).pricing).toBeUndefined()
  })

  it('preserves synced model metadata and runtime flags when editing a model', () => {
    const model: ModelDefinition = {
      id: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      group: 'deepseek-ai',
      provider: 'remote',
      capabilities: {
        chat: true,
        vision: false,
        embedding: false,
        tools: true,
        agentRuntimes: { claudeCode: true, openaiAgents: false }
      }
    }

    const draft = createModelDraftFromModel(model)
    draft.name = 'DeepSeek V3.2 Edited'
    draft.capabilities.tools = false

    expect(buildModelDefinitionFromDraft(draft)).toEqual({
      id: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2 Edited',
      group: 'deepseek-ai',
      provider: 'remote',
      capabilities: {
        chat: true,
        tools: false,
        agentRuntimes: { claudeCode: true, openaiAgents: false }
      },
      priceTag: 'paid'
    })
  })
})
