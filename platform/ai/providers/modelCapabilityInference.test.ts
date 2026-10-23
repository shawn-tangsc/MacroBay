import { describe, expect, it } from 'vitest'

import { inferModelCapabilities, isChatProbeCandidate } from './modelCapabilityInference'

/**
 * PLAT-62：能力只按真实信息标注（显式 > type > id 模式）。
 * 没有信息就不显示，`tools` 只在显式 true 时出现。
 */
describe('PLAT-62 model capability inference', () => {
  it('infers non-chat capabilities from known model families', () => {
    expect(inferModelCapabilities({ id: 'BAAI/bge-m3' })).toEqual({ chat: false, embedding: true })
    expect(inferModelCapabilities({ id: 'Qwen2-VL-72B' })).toEqual({ chat: true, vision: true, tools: true })
    expect(inferModelCapabilities({ id: 'deepseek-r1-0528' })).toEqual({ chat: true, reasoning: true, tools: true })
    // seedream 是**生图**（seedance 才是视频）；此前被误判成视频，导致豆包 6 个 seedream 同时
    // 带 imageGeneration 与 videoGeneration 两个互斥位。
    expect(inferModelCapabilities({ id: 'doubao-seedream-3-0-t2i-250415' })).toEqual({
      chat: false,
      imageGeneration: true
    })
    expect(inferModelCapabilities({ id: 'T2V-01-Director' })).toEqual({ chat: false, videoGeneration: true })
    expect(inferModelCapabilities({ id: 'Doubao-tts01' })).toEqual({ chat: false, speech: true })
  })

  it('keeps plain text models chat-only (no fake tools chip)', () => {
    expect(inferModelCapabilities({ id: 'deepseek-v3.2' })).toEqual({ chat: true, tools: true })
  })

  it('honours the provider type field before id patterns', () => {
    expect(inferModelCapabilities({ id: 'some-model', type: 'image_generation' })).toEqual({
      chat: false,
      imageGeneration: true
    })
    expect(inferModelCapabilities({ id: 'some-model', type: 'visual_model' })).toEqual({
      chat: false
    })
    expect(inferModelCapabilities({ id: 'some-model', type: 'embedding' })).toEqual({
      chat: false,
      embedding: true
    })
    expect(inferModelCapabilities({ id: 'some-model', type: 'tts' })).toEqual({ chat: false, speech: true })
    expect(inferModelCapabilities({ id: 'some-model', type: 'video' })).toEqual({
      chat: false,
      videoGeneration: true
    })
  })

  it('lets explicit fields win over type/id inference', () => {
    expect(inferModelCapabilities({
      id: 'deepseek-r1',
      type: 'embedding',
      capabilities: { chat: true, reasoning: false, tools: true }
    })).toEqual({ chat: true, tools: true, embedding: true })
  })

  it('splits the coarse visual_model type by id and leaves unknown visuals unlabelled', () => {
    expect(inferModelCapabilities({ id: 'T2V-01-Director', type: 'visual_model' })).toEqual({
      chat: false,
      videoGeneration: true
    })
    expect(inferModelCapabilities({ id: 'MiniMax-Hailuo-02', type: 'visual_model' })).toEqual({
      chat: false,
      videoGeneration: true
    })
    expect(inferModelCapabilities({ id: 'Qwen/Qwen2-VL-72B-Instruct', type: 'visual_model' })).toEqual({
      chat: true,
      vision: true,
      tools: true
    })
    expect(inferModelCapabilities({ id: 'mystery-visual-model', type: 'visual_model' })).toEqual({ chat: false })
  })

  it('maps the remaining AIOnly type values (speech_model / text_model)', () => {
    expect(inferModelCapabilities({ id: 'Doubao-tts01', type: 'speech_model' })).toEqual({
      chat: false,
      speech: true
    })
    expect(inferModelCapabilities({ id: 'deepseek-v3.2', type: 'text_model' })).toEqual({ chat: true, tools: true })
  })

  it('does not invent vision for text models, and keeps tools from the capability catalog', () => {
    // 内置能力表（PLAT-73）认为 gpt-5 支持工具调用；视觉仍需证据。
    const capabilities = inferModelCapabilities({ id: 'gpt-5' })
    expect(capabilities.tools).toBe(true)
    expect(capabilities.vision).toBeUndefined()
    // 完全未知的模型：不虚构任何能力。
    const unknown = inferModelCapabilities({ id: 'acme-mystery-model' })
    expect(unknown.tools).toBeUndefined()
    expect(unknown.vision).toBeUndefined()
  })
  it('marks the real non-chat AIOnly model ids as non-candidates', () => {
    const ids = [
      'BAAI/bge-large-en-v1.5', 'BAAI/bge-large-zh-v1.5', 'BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3',
      'Pro/BAAI/bge-m3', 'Pro/BAAI/bge-reranker-v2-m3', 'diffusiongemma', 'fnlp/MOSS-TTSD-v0.5',
      'FunAudioLLM/CosyVoice2-0.5B', 'FunAudioLLM/SenseVoiceSmall', 'Kev-4B', 'Kwai-Kolors/Kolors',
      'SemIf', 'Tongyi-MAI/Z-Image', 'Tongyi-MAI/Z-Image-Turbo', 'Wan-AI/Wan2.2-I2V-A14B',
      'Wan-AI/Wan2.2-T2V-A14B', 'XingChenAGI/XingChenASR-Diarize-V3.0', 'XingChenAGI/XingChenASR-V3.2',
      'XingChenAGI/XingChenASR-V3.2-Ultra', 'XingChenAGI/XingChenGSR-V1.0'
    ]
    for (const id of ids) {
      const capabilities = inferModelCapabilities({ id })
      expect(capabilities.chat, id).toBe(false)
      expect(isChatProbeCandidate({ id, capabilities }), id).toBe(false)
    }
    for (const id of ['glm-4.6', 'kimi-k3', 'deepseek-v3.2']) {
      expect(isChatProbeCandidate({ id, capabilities: inferModelCapabilities({ id }) }), id).toBe(true)
    }
  })

  it('classifies wan/image/video families and never probes them', () => {
    expect(inferModelCapabilities({ id: 'wan2.7-image' })).toEqual({ chat: false, imageGeneration: true })
    expect(inferModelCapabilities({ id: 'wan2.7-i2v' })).toEqual({ chat: false, videoGeneration: true })
    expect(inferModelCapabilities({ id: 'hpappy-horse-1.0-t2v' })).toEqual({ chat: false, videoGeneration: true })
    for (const id of ['wan2.7-image', 'wan2.7-i2v', 'hpappy-horse-1.0-t2v']) {
      expect(isChatProbeCandidate({ id, capabilities: inferModelCapabilities({ id }) }), id).toBe(false)
    }
  })

})
