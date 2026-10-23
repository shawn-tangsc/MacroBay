import { describe, expect, it } from 'vitest'

import type { ModelCapabilities, ModelDefinition } from './modelProviderTypes'
import { normalizeModelCapabilities } from './modelCapabilities'
import { isChatProbeCandidate, resolveModelCapabilities } from './modelCapabilityInference'

/**
 * PLAT-76：能力拆分 —— `rerank` 独立，`audio` 拆成 `speech`（TTS）/ `transcription`（ASR）。
 *
 * 断言口径按 PM 给的样例：BGE Reranker 只算重排、Qwen3-Embedding 只算嵌入、
 * CosyVoice/TTS 算语音、whisper/ASR/SenseVoice 算转录、Qwen3-VL 是视觉+工具。
 * 三者都是非聊天族：`chat=false`、不进智能体/messages 探测候选。
 */
function model(id: string, capabilities: Partial<ModelCapabilities> = {}): ModelDefinition {
  return { id, name: id, capabilities: { chat: true, ...capabilities } }
}

describe('PLAT-76 model capability split', () => {
  it('classifies rerank separately from embedding', () => {
    expect(resolveModelCapabilities(model('BGE Reranker'))).toMatchObject({ chat: false, rerank: true })
    expect(resolveModelCapabilities(model('BGE Reranker')).embedding).toBeUndefined()
    expect(resolveModelCapabilities(model('bge-reranker-v2-m3'))).toMatchObject({ rerank: true })
    expect(resolveModelCapabilities(model('Qwen3-Embedding'))).toMatchObject({ chat: false, embedding: true })
    expect(resolveModelCapabilities(model('Qwen3-Embedding')).rerank).toBeUndefined()
  })

  it('splits speech synthesis from transcription', () => {
    expect(resolveModelCapabilities(model('CosyVoice-300M'))).toMatchObject({ chat: false, speech: true })
    expect(resolveModelCapabilities(model('TTS-1'))).toMatchObject({ speech: true })
    expect(resolveModelCapabilities(model('whisper-1'))).toMatchObject({ chat: false, transcription: true })
    expect(resolveModelCapabilities(model('ASR-2026'))).toMatchObject({ transcription: true })
    // SenseVoice 是 ASR 族：不能因为 id 里有 voice 就被判成 TTS。
    expect(resolveModelCapabilities(model('SenseVoice-Small'))).toMatchObject({ chat: false, transcription: true })
    expect(resolveModelCapabilities(model('SenseVoice-Small')).speech).toBeUndefined()
  })

  it('keeps a vision model as vision + tools', () => {
    expect(resolveModelCapabilities(model('Qwen3-VL-72B'))).toMatchObject({
      chat: true,
      vision: true,
      tools: true
    })
  })

  it('migrates legacy audio:true to speech and never keeps audio', () => {
    const migrated = normalizeModelCapabilities({ chat: false, audio: true })
    expect(migrated).toMatchObject({ chat: false, speech: true })
    expect((migrated as { audio?: boolean }).audio).toBeUndefined()

    // 老记录在解析时同样走迁移（id 看不出来也不能丢语音语义）。
    expect(resolveModelCapabilities({ id: 'legacy-voice', capabilities: { chat: true, audio: true } }))
      .toMatchObject({ chat: false, speech: true })
  })

  it('keeps the three new families out of chat, agent and messages probe candidates', () => {
    for (const id of ['BGE Reranker', 'CosyVoice-300M', 'whisper-1']) {
      const resolved = resolveModelCapabilities(model(id))
      expect(resolved.chat, id).toBe(false)
      expect(isChatProbeCandidate(model(id)), id).toBe(false)
    }
  })

  it('respects an explicit capability edit over id inference', () => {
    expect(resolveModelCapabilities(model('CosyVoice-300M', { speech: false, chat: true, capabilitiesEdited: true })))
      .toMatchObject({ chat: true, speech: false })
  })
})
