import { describe, expect, it } from 'vitest'

import type { ProviderChatEndpoint } from '../modelProviderTypes'
import { DEFAULT_MODEL_LIST_SHAPE } from './modelListShape'
import { resolveModelListShape } from './modelListShapes'
import { normalizeRemoteModels } from './remoteModelNormalize'

const chatEndpoints: ProviderChatEndpoint[] = [{ protocol: 'chat-completions', baseUrl: 'https://api.test' }]
const geminiEndpoints: ProviderChatEndpoint[] = [{ protocol: 'gemini', baseUrl: 'https://api.test' }]

function normalize(providerId: string, items: readonly unknown[], endpoints: ProviderChatEndpoint[] = chatEndpoints) {
  return normalizeRemoteModels(items, resolveModelListShape({ id: providerId, endpoints }))
}

function one(providerId: string, item: Record<string, unknown>, endpoints: ProviderChatEndpoint[] = chatEndpoints) {
  const models = normalize(providerId, [item], endpoints)
  expect(models).toHaveLength(1)
  return models[0]!
}

describe('remote model normalization', () => {
  it('keeps the minimal OpenAI shape minimal', () => {
    const model = one('openai', { id: 'auto', object: 'model', created: 1626777600, owned_by: 'OpenAI' })
    expect(model).toMatchObject({ id: 'auto', name: 'auto', group: 'OpenAI', provider: 'remote' })
    expect(model.contextLength).toBeUndefined()
    expect(model.pricing).toBeUndefined()
    expect(model.capabilities.chat).toBe(true)
  })

  it('reads context_length and max_tokens (qiniu style)', () => {
    const model = one('qiniu', { id: 'meituan/longcat-flash-lite', context_length: 256000, max_tokens: 320000 })
    expect(model.contextLength).toBe(256000)
    expect(model.maxCompletionTokens).toBe(320000)
    expect(model.group).toBe('meituan')
  })

  it('reads context_window + max_output_tokens and declared modalities (deepseek style)', () => {
    const model = one('deepseek', {
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      context_window: 1048576,
      max_output_tokens: 393216,
      input_modalities: ['text', 'image'],
      effort: { supported_levels: ['low', 'high'], default_level: 'high' },
      api_capabilities: { anthropic_messages: { system_prompt_update: 'in-history' } }
    })
    expect(model).toMatchObject({
      name: 'DeepSeek-V4.1-Flash',
      contextLength: 1048576,
      maxCompletionTokens: 393216,
      messagesSupport: 'yes',
      declarationSource: 'provider_list',
      capabilities: { chat: true, vision: true, reasoning: true }
    })
    // PLAT-82：同步只记厂商声明，探测结论（probeStatus/probeReason/protocolProbedAt）不再写。
    expect(model.probeStatus).toBeUndefined()
    expect(model.probeReason).toBeUndefined()
    expect(model.protocolProbedAt).toBeUndefined()
    // D7：`api_capabilities` 不是那四个字面字段，不能把 providerDeclared 放开。
    expect(model.providerDeclared).toBeUndefined()
  })

  it('reads nested token_limits and ignores an empty domain (doubao style)', () => {
    const model = one('doubao', {
      id: 'doubao-pro-32k',
      domain: '',
      task_type: ['TextGeneration'],
      token_limits: { context_window: 32768, max_input_token_length: 32768, max_output_token_length: 16384 }
    })
    expect(model.contextLength).toBe(32768)
    expect(model.maxCompletionTokens).toBe(16384)
    expect(model.capabilities.chat).toBe(true)
  })

  it('converts per-token pricing to per-million (gateway style)', () => {
    const model = one('gateway', {
      id: 'alibaba/qwen-3-14b',
      context_window: 40960,
      max_tokens: 16384,
      type: 'language',
      pricing: { input: '0.00000012', output: '0.00000024' },
      supported_parameters: ['max_tokens', 'tools'],
      modalities: { input: ['text', 'image'], output: ['text'] },
      tags: ['reasoning', 'tool-use']
    })
    expect(model.pricing).toEqual({ currency: 'USD', promptPerMillion: 0.12, completionPerMillion: 0.24 })
    expect(model.contextLength).toBe(40960)
    expect(model.capabilities).toMatchObject({ chat: true, tools: true, vision: true, reasoning: true })
  })

  it('prefers effective_pricing over pricing (tokenrhythm style)', () => {
    const model = one('tokenrhythm', {
      id: 'glm-5.1',
      context_length: 200000,
      max_completion_tokens: 128000,
      pricing: { currency: 'CNY', prompt: '8.00000000', completion: '28.00000000', cache_read: '2.00000000' },
      effective_pricing: { currency: 'CNY', prompt: '4.00000000', completion: '14.00000000', cache_read: '1.00000000' },
      has_discount: true,
      supports_tools: true,
      supports_vision: true,
      supports_reasoning: true,
      supports_anthropic: true
    })
    expect(model.pricing).toEqual({
      currency: 'CNY',
      promptPerMillion: 4,
      completionPerMillion: 14,
      cacheReadPerMillion: 1,
      hasDiscount: true
    })
    expect(model).toMatchObject({
      messagesSupport: 'yes',
      declarationSource: 'provider_list',
      providerDeclared: true,
      capabilities: { chat: true, tools: true, vision: true, reasoning: true }
    })
  })

  it('lets an explicit false veto the id heuristics', () => {
    const model = one('tokenrhythm', {
      id: 'qwen3.7-vl-preview',
      supports_vision: false,
      supports_tools: true
    })
    expect(model.capabilities.vision).not.toBe(true)
    expect(model.capabilities.tools).toBe(true)
  })

  it('maps supports_anthropic true/false to messages declaration', () => {
    const no = one('tokenrhythm', { id: 'gpt-5', supports_anthropic: false })
    expect(no).toMatchObject({ messagesSupport: 'no', declarationSource: 'provider_list' })
    expect(no.probeStatus).toBeUndefined()

    const yes = one('tokenrhythm', { id: 'glm-5', supports_anthropic: true })
    expect(yes).toMatchObject({ messagesSupport: 'yes', declarationSource: 'provider_list' })

    const missing = one('tokenrhythm', { id: 'plain-chat' })
    expect(missing.messagesSupport).toBeUndefined()
    expect(missing.declarationSource).toBeUndefined()
  })

  it('drops retired statuses case-insensitively but keeps Retiring (doubao style)', () => {
    const models = normalize('doubao', [
      { id: 'a', status: 'Shutdown' },
      { id: 'b', status: 'shutdown' },
      { id: 'c', status: 'Retiring' },
      { id: 'd', status: null }
    ])
    expect(models.map((model) => model.id)).toEqual(['c', 'd'])
  })

  it('handles presence and numeric-zero lifecycle rules', () => {
    expect(normalize('gateway', [
      { id: 'live', type: 'language' },
      { id: 'gone', type: 'language', deprecated_at: '2026-01-01' },
      { id: 'blank', type: 'language', deprecated_at: '' }
    ]).map((model) => model.id)).toEqual(['live', 'blank'])

    expect(normalize('lanyun', [
      { id: 'a', status: 1 },
      { id: 'b', status: 0 },
      { id: 'c', status: '0' }
    ]).map((model) => model.id)).toEqual(['a'])
  })

  it('treats Cephalon mode:embedding as non-chat even when model_type is language', () => {
    // 实测载荷：qwen3-embedding:latest 是 model_type=language + mode=embedding。
    const embedding = one('cephalon', { id: 'qwen3-embedding:latest', model_type: 'language', mode: 'embedding' })
    expect(embedding.capabilities).toMatchObject({ chat: false, embedding: true })

    // mode:chat 的普通模型不受影响。
    expect(one('cephalon', { id: 'glm-5', model_type: 'language', mode: 'chat' }).capabilities.chat).toBe(true)
  })

  it('maps Cephalon picture kind to imageGeneration via per-provider override', () => {
    const picture = one('cephalon', { id: 'NanoBanana2', model_type: 'picture' })
    expect(picture.capabilities).toMatchObject({ chat: false, imageGeneration: true })
  })

  it('classifies MiMo ASR/TTS ids as non-chat without any type field', () => {
    // 实测载荷只有 id/object/owned_by 三个字段，能力只能靠 id 推断；这四条必须不进聊天候选。
    const asr = one('mimo', { id: 'mimo-v2.5-asr' })
    expect(asr.capabilities).toMatchObject({ chat: false, transcription: true })
    for (const id of ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts-voicedesign']) {
      expect(one('mimo', { id }).capabilities, id).toMatchObject({ chat: false, speech: true })
    }
    for (const id of ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed']) {
      expect(one('mimo', { id }).capabilities.chat, id).toBe(true)
    }
  })

  it('marks gateway models as messages/responses capable so agents can pick them', () => {
    // 智能体候选判据读的是 `messagesSupport === 'yes'`，只写 `supportedProtocols` 不够：
    // 缺这一位时网关模型会被判成 model-not-enabled，直接从智能体下拉里消失。
    const model = normalizeRemoteModels(
      [{ id: 'deepseek/deepseek-v3.2' }],
      resolveModelListShape({ id: 'openrouter', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions', allProtocols: ['chat-completions', 'responses', 'messages'] }
    )[0]!
    expect(model.messagesSupport).toBe('yes')
    expect(model.responsesSupport).toBe('yes')
    // 但**不是**厂商逐模型声明：来源仍然留空。
    expect(model.declarationSource).toBeUndefined()
  })

  it('tags every model with all protocols when the gateway translates formats', () => {
    // OpenRouter 实测：任一模型 chat / messages / responses 三路都能进（网关做转换）⇒ 同步时
    // 直接并入声明，用户拿到模型就带齐三个标签，不必再跑「检测模型」。
    const models = normalizeRemoteModels(
      [{ id: 'minimax/minimax-m3.1-flash:free' }, { id: 'openai/gpt-image-1' }],
      resolveModelListShape({ id: 'openrouter', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions', allProtocols: ['chat-completions', 'responses', 'messages'] }
    )
    expect(models[0]?.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
    expect(models[0]?.chatProtocol).toBe('chat-completions')
    expect(models[1]?.supportedProtocols).toBeUndefined()
  })

  it('reads PPIO prices in CNY per million and its per-model endpoints', () => {
    // 实测 glm-4.7：pricing.prompt.price_per_m_decimal "4"、completion "16"（人民币/百万，
    // 与智谱官方价一致）。`endpoints` 逐模型声明协议，含 anthropic ⇒ messages。
    const model = normalizeRemoteModels(
      [{
        id: 'zai-org/glm-4.7',
        context_size: 204800,
        max_output_tokens: 131072,
        status: 1,
        pricing: {
          prompt: { price_per_m_decimal: '4' },
          completion: { price_per_m_decimal: '16' },
          input_cache_read: { price_per_m_decimal: '0.8' }
        },
        endpoints: ['chat/completions', 'anthropic'],
        features: ['function-calling', 'reasoning'],
        input_modalities: ['text', 'image'],
        output_modalities: ['text']
      }],
      resolveModelListShape({ id: 'ppio', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(model.pricing).toMatchObject({ currency: 'CNY', promptPerMillion: 4, completionPerMillion: 16 })
    expect(model.pricing?.cacheReadPerMillion).toBeCloseTo(0.8)
    expect(model.contextLength).toBe(204800)
    expect(model.supportedProtocols).toEqual(['chat-completions', 'messages'])
    expect(model.chatProtocol).toBe('chat-completions')
    expect(model.capabilities).toMatchObject({ chat: true, vision: true, tools: true, reasoning: true })
  })

  it('reads OpenRouter prices as per-token and scales them to per-million', () => {
    // 实测 gpt-5：pricing.prompt "0.00000125" = $1.25/百万；此前默认形状没乘 1e6，
    // UI 会显示成 0.00000125，少了 100 万倍。
    const model = normalizeRemoteModels(
      [{
        id: 'openai/gpt-5',
        context_length: 400000,
        pricing: { prompt: '0.00000125', completion: '0.00001', input_cache_read: '0.000000125' },
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        supported_parameters: ['tools', 'reasoning']
      }],
      resolveModelListShape({ id: 'openrouter', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(model.pricing).toMatchObject({ currency: 'USD', promptPerMillion: 1.25, completionPerMillion: 10 })
    expect(model.pricing?.cacheReadPerMillion).toBeCloseTo(0.125)
    expect(model.contextLength).toBe(400000)
    expect(model.capabilities).toMatchObject({ chat: true, vision: true, tools: true, reasoning: true })
  })

  it('reads Poe pricing, modalities and per-model endpoints', () => {
    const model = normalizeRemoteModels(
      [{
        id: 'claude-opus-4.8',
        context_length: 1048576,
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
        pricing: { prompt: '0.0000042929', completion: '0.0000214646', input_cache_read: null },
        supported_endpoints: ['/v1/messages', '/v1/responses', '/v1/chat/completions']
      }],
      resolveModelListShape({ id: 'poe', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    // 价格是 USD / token ⇒ ×1e6 到每百万。
    expect(model.pricing).toMatchObject({ currency: 'USD', promptPerMillion: 4.2929, completionPerMillion: 21.4646 })
    expect(model.contextLength).toBe(1048576)
    expect(model.capabilities).toMatchObject({ chat: true, vision: true })
    expect(model.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
    // 声明不抢默认路由。
    expect(model.chatProtocol).toBe('chat-completions')

    // 生图模型：output_modalities 含 image ⇒ 能力位；无 chat 端点声明 ⇒ 默认协议不写。
    const image = normalizeRemoteModels(
      [{ id: 'gpt-image-2', architecture: { output_modalities: ['image'] }, supported_endpoints: [] }],
      resolveModelListShape({ id: 'poe', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(image.capabilities).toMatchObject({ chat: false, imageGeneration: true })
    expect(image.chatProtocol).toBeUndefined()
  })

  it('reads BurnCloud supported_endpoint_types as per-model protocol support', () => {
    // 实测：108 条全有该字段；gemini 30 / openai 108 / image-generation 2。
    const gemini = normalizeRemoteModels(
      [{ id: 'gemini-2.5-flash', supported_endpoint_types: ['gemini', 'openai'] }],
      resolveModelListShape({ id: 'burncloud', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(gemini.supportedProtocols).toEqual(['chat-completions', 'gemini'])
    expect(gemini.declaredProtocols).toEqual(['chat-completions', 'gemini'])
    // 声明不抢默认路由：仍然是供应商默认端点。
    expect(gemini.chatProtocol).toBe('chat-completions')

    const plain = one('burncloud', { id: 'gpt-4o', supported_endpoint_types: ['openai'] })
    expect(plain.supportedProtocols).toEqual(['chat-completions'])
    expect(plain.supportedProtocols).not.toContain('gemini')
  })

  it('maps kinds to capability slots (aionly / gateway / lanyun)', () => {
    expect(one('aionly', { id: 'speech-02-hd', type: 'speech_model' }).capabilities).toMatchObject({
      chat: false,
      speech: true
    })
    expect(one('aionly', { id: 'wan2.2-t2v-plus', type: 'image_generation' }).capabilities).toMatchObject({
      chat: false,
      imageGeneration: true
    })
    expect(one('gateway', { id: 'cohere/rerank-v3.5', type: 'reranking' }).capabilities).toMatchObject({
      chat: false,
      rerank: true
    })
    expect(one('lanyun', { id: 'speech-2.6-turbo', model_type: '1003' }).capabilities).toMatchObject({
      chat: false,
      speech: true
    })
  })

  it('does not force chat:false for kinds without a capability slot', () => {
    const model = one('gateway', { id: 'liquid/d1', type: 'evaluation' })
    expect(model.capabilities.chat).toBe(true)
    expect(model.capabilities.embedding).toBeUndefined()
  })

  it('keeps gemini identity, family grouping and hybrid chat+embedding capabilities', () => {
    const models = normalize('gemini', [
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-3-pro-preview', supportedGenerationMethods: ['generateContent', 'embedContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/aqa-only', supportedGenerationMethods: ['countTokens'] }
    ], geminiEndpoints)

    expect(models.map((model) => model.id)).toEqual([
      'gemini-3.5-flash',
      'gemini-3-pro-preview',
      'text-embedding-004'
    ])
    expect(models[0]).toMatchObject({
      name: 'Gemini 3.5 Flash',
      group: 'gemini-3.5',
      provider: 'gemini',
      capabilities: { chat: true }
    })
    // T4/T5：没有传默认端点 ⇒ 模型不带协议（由调用方快照供应商默认）。
    // 混合模型：聊天与向量都要保留（否则会从聊天选择器里消失）。
    expect(models[1]?.capabilities).toMatchObject({ chat: true, embedding: true })
    expect(models[1]?.name).toBe('gemini-3-pro-preview')
    expect(models[2]).toMatchObject({ provider: 'gemini', capabilities: { chat: false, embedding: true } })
    expect(models[2]?.chatProtocol).toBeUndefined()
  })

  it('reads LANYUN prices from x_lanyun.price_rules (CNY per 1K → per 1M)', () => {
    const model = one('lanyun', {
      id: 'glm-5.3',
      model_type: 'chat',
      status: 1,
      context_size: 1024000,
      // 顶层这两个字段实测恒为 null，真价在 price_rules 里，单位 CNY / 1K tokens。
      input_token_price_per_m: null,
      output_token_price_per_m: null,
      x_lanyun: {
        price_type: 'TEXT_TOKEN',
        api_paths: ['/v1/chat/completions'],
        price_rules: [{ text_input_token: 0.008, text_output_token: 0.028, cache_use_token: 0.002 }]
      }
    })
    expect(model.pricing).toEqual({
      currency: 'CNY',
      promptPerMillion: 8,
      completionPerMillion: 28,
      cacheReadPerMillion: 2
    })
    expect(model.contextLength).toBe(1024000)
  })

  it('leaves LANYUN pricing undefined when price_rules is empty (no fabricated price)', () => {
    const model = one('lanyun', {
      id: 'automodel',
      model_type: 'chat',
      status: 1,
      x_lanyun: { price_type: null, price_rules: [] }
    })
    expect(model.pricing).toBeUndefined()
  })

  it('reads per-model api paths as Anthropic messages support (lanyun style)', () => {
    const withMessages = one('lanyun', {
      id: 'kimi-k3',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages'] }
    })
    expect(withMessages).toMatchObject({
      messagesSupport: 'yes',
      // PLAT-82：`api_paths` 里同时声明了 chat 与 messages ⇒ 两条都算支持。
      supportedProtocols: ['chat-completions', 'messages'],
      declarationSource: 'provider_list'
    })

    const chatOnly = one('lanyun', {
      id: 'qwen3.6-only-chat',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions'] }
    })
    expect(chatOnly.messagesSupport).toBe('no')
    expect(chatOnly.probeStatus).toBeUndefined()

    const silent = one('lanyun', { id: 'no-paths', model_type: 'chat', status: 1 })
    expect(silent.messagesSupport).toBeUndefined()
  })

  it('reads responses support from the provider payload', () => {
    expect(one('tokenrhythm', { id: 'glm-5', supports_responses: true })).toMatchObject({ responsesSupport: 'yes' })
    expect(one('tokenrhythm', { id: 'glm-6', supports_responses: false })).toMatchObject({ responsesSupport: 'no' })
    expect(one('tokenrhythm', { id: 'glm-7' }).responsesSupport).toBeUndefined()

    expect(one('lanyun', {
      id: 'automodel',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages', '/v1/responses'] }
    })).toMatchObject({
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      supportedProtocols: ['chat-completions', 'responses', 'messages']
    })

    expect(one('lanyun', {
      id: 'chat-only-model',
      model_type: 'chat',
      status: 1,
      x_lanyun: { api_paths: ['/v1/chat/completions', '/v1/messages'] }
    })).toMatchObject({ responsesSupport: 'no' })
  })

  it('falls back to the id family when owned_by is missing', () => {
    expect(one('qiniu', { id: 'deepseek-ai/DeepSeek-V3' }).group).toBe('deepseek-ai')
    expect(one('qiniu', { id: 'gpt-5' }).group).toBe('gpt')
    expect(one('qiniu', { id: 'plain' }).group).toBeUndefined()
  })

  it('lets a provider override the meaning of a kind that collides with the global table', () => {
    // 全局表把 `1002`（豆包视频 kind）当视频生成；某家声明它其实是多模态输入（vision）。
    const overridden = {
      ...DEFAULT_MODEL_LIST_SHAPE,
      kindSources: [{ path: 'type', read: 'value' }],
      kindOverrides: { '1002': ['cap.vision'] }
    } as typeof DEFAULT_MODEL_LIST_SHAPE
    const [model] = normalizeRemoteModels(
      [{ id: 'omni-1', type: '1002' }],
      overridden
    )
    expect(model?.capabilities).toMatchObject({ vision: true })
    // 覆盖是**替换**而不是叠加：全局表的 videoGeneration 不得同时置上。
    expect(model?.capabilities.videoGeneration ?? false).toBe(false)
  })

  it('keeps the global kind table when a provider declares no override', () => {
    const withoutOverride = {
      ...DEFAULT_MODEL_LIST_SHAPE,
      kindSources: [{ path: 'type', read: 'value' }]
    } as typeof DEFAULT_MODEL_LIST_SHAPE
    const [model] = normalizeRemoteModels([{ id: 'seedance', type: '1002' }], withoutOverride)
    expect(model?.capabilities).toMatchObject({ videoGeneration: true })
    expect(model?.capabilities.vision ?? false).toBe(false)
  })

  it('dedupes ids, skips unusable entries and never throws on junk', () => {
    const models = normalize('openai', [
      { id: 'auto' },
      { id: 'auto' },
      { id: '   ' },
      { name: 'no-id' },
      null,
      'nope'
    ])
    expect(models.map((model) => model.id)).toEqual(['auto'])
  })
})
