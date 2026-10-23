import { describe, expect, it } from 'vitest'

import type { ProviderChatEndpoint } from '../modelProviderTypes'
import { resolveModelListShape } from './modelListShapes'
import { normalizeRemoteModels } from './remoteModelNormalize'

/**
 * AIHubMix 富列表（`/api/v1/models`）的归一口径。
 *
 * 单独成文件：这里断言的是「逗号分隔字段 + USD/每百万 tokens」这一组事实，
 * 与默认形状的通用用例分开，避免把 `remoteModelNormalize.test.ts` 推过 500 行。
 */
const chatEndpoints: ProviderChatEndpoint[] = [{ protocol: 'chat-completions', baseUrl: 'https://api.test' }]

function normalize(items: readonly unknown[]) {
  return normalizeRemoteModels(items, resolveModelListShape({ id: 'aihubmix', endpoints: chatEndpoints }), {
    // 预设的默认端点仍是 chat/completions；同步时快照成 chatProtocol。
    providerDefaultProtocol: 'chat-completions'
  })
}

function one(item: Record<string, unknown>) {
  const models = normalize([item])
  expect(models).toHaveLength(1)
  return models[0]!
}

describe('aihubmix rich model list normalization', () => {
  it('normalizes the aihubmix rich entry (comma-separated fields, USD per million)', () => {
    const model = one({
      model_id: 'gpt-4o',
      model_name: 'GPT-4o',
      types: 'llm',
      endpoints: '',
      pricing: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 12.5 },
      context_length: 128000,
      max_output: 16384,
      input_modalities: 'text,image',
      output_modalities: 'text',
      retire_stage: 'active',
      reasoning: true,
      tool_call: true
    })
    expect(model).toMatchObject({
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextLength: 128000,
      maxCompletionTokens: 16384,
      pricing: { currency: 'USD', promptPerMillion: 2.5, completionPerMillion: 10, cacheReadPerMillion: 1.25 },
      capabilities: { chat: true, vision: true, tools: true, reasoning: true },
      chatProtocol: 'chat-completions',
      supportedProtocols: ['chat-completions']
    })
  })

  it('reads multi-value endpoints as supported protocols without moving the default route', () => {
    const model = one({ model_id: 'gpt-6-astra', types: 'llm', endpoints: 'chat_completions,responses' })
    expect(model.supportedProtocols).toEqual(['chat-completions', 'responses'])
    expect(model.declaredProtocols).toEqual(['chat-completions', 'responses'])
    // 声明不抢默认路由：仍是供应商默认端点。
    expect(model.chatProtocol).toBe('chat-completions')
    expect(model.responsesSupport).toBe('yes')
    expect(model.messagesSupport).toBe('no')

    expect(one({ model_id: 'claude-via-proxy', types: 'llm', endpoints: 'claude_api' })).toMatchObject({
      messagesSupport: 'yes',
      responsesSupport: 'no',
      supportedProtocols: ['chat-completions', 'messages']
    })
  })

  it('maps comma-separated aihubmix kinds to capability slots', () => {
    // id 不带任何能力提示，能力只能来自 `types`。
    expect(one({ model_id: 'model-a1', types: 'image_generation' }).capabilities).toMatchObject({
      chat: false,
      imageGeneration: true
    })
    expect(one({ model_id: 'model-a2', types: 'tts' }).capabilities).toMatchObject({
      chat: false,
      speech: true
    })
    expect(one({ model_id: 'model-a3', types: 'rerank' }).capabilities).toMatchObject({
      chat: false,
      rerank: true
    })
    expect(one({ model_id: 'model-a4', types: 'video' }).capabilities).toMatchObject({
      chat: false,
      videoGeneration: true
    })
    // 多值：`image_generation,llm` 仍是非聊天模型。
    expect(one({ model_id: 'model-a5', types: 'image_generation,llm' }).capabilities.chat).toBe(false)
    // `llm,search` 没有非聊天位 ⇒ 仍是聊天模型。
    expect(one({ model_id: 'model-a6', types: 'llm,search' }).capabilities.chat).toBe(true)
  })

  it('drops aihubmix entries whose retire_stage is deprecated', () => {
    const models = normalize([
      { model_id: 'active-1', types: 'llm', retire_stage: 'active' },
      { model_id: 'old-1', types: 'llm', retire_stage: 'deprecated' },
      { model_id: 'old-2', types: 'llm', retire_stage: ' Shutdown ' }
    ])
    expect(models.map((model) => model.id)).toEqual(['active-1'])
  })
})
