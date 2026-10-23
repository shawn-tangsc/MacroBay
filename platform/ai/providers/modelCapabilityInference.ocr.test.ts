import { describe, expect, it } from 'vitest'

import { inferModelCapabilities } from './modelCapabilityInference'
import type { ProviderChatEndpoint } from './modelProviderTypes'
import { resolveModelListShape } from './modelList/modelListShapes'
import { normalizeRemoteModels } from './modelList/remoteModelNormalize'

/**
 * OCR 是**第一类能力**，但不是「非聊天族」：OCR 模型是输入被限定为一张图的 VLM，
 * 仍走 chat/completions，所以 `chat: true` 且同时置 `vision`（输入是图片）+ `ocr`（专长标记）。
 */
const chatEndpoints: ProviderChatEndpoint[] = [{ protocol: 'chat-completions', baseUrl: 'https://api.test' }]

function normalize(items: readonly unknown[]) {
  return normalizeRemoteModels(items, resolveModelListShape({ id: 'aihubmix', endpoints: chatEndpoints }), {
    providerDefaultProtocol: 'chat-completions'
  })
}

describe('OCR capability inference', () => {
  it('infers ocr + vision while keeping the model chat-capable', () => {
    expect(inferModelCapabilities({ id: 'deepseek-ai/DeepSeek-OCR' })).toEqual({
      chat: true,
      vision: true,
      ocr: true
    })
    expect(inferModelCapabilities({ id: 'jina-ocr-v1' })).toEqual({
      chat: true,
      vision: true,
      ocr: true
    })
    expect(inferModelCapabilities({ id: 'qianfan-ocr' })).toEqual({
      chat: true,
      vision: true,
      ocr: true
    })
  })

  it('maps the aihubmix `ocr` kind to the ocr slot (id carries no hint)', () => {
    const [model] = normalize([{ model_id: 'model-a7', types: 'ocr' }])
    // 能力来自 `types`：id 里没有 ocr 字样，排除 id 正则兜底；OCR 不是非聊天族。
    expect(model?.capabilities).toMatchObject({ chat: true, ocr: true })
  })

  it('leaves ordinary text models byte-for-byte unchanged', () => {
    expect(inferModelCapabilities({ id: 'gpt-4o' })).toEqual({ chat: true, tools: true })
    expect(inferModelCapabilities({ id: 'deepseek-v3.2' })).toEqual({ chat: true, tools: true })
    expect(inferModelCapabilities({ id: 'Qwen2-VL-72B' })).toEqual({ chat: true, vision: true, tools: true })
    expect(inferModelCapabilities({ id: 'BAAI/bge-m3' })).toEqual({ chat: false, embedding: true })
    expect(inferModelCapabilities({ id: 'acme-mystery-model' })).toEqual({ chat: true })
  })
})
