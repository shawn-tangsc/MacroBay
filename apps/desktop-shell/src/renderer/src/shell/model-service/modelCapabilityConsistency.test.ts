import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import { resolveModelCapabilities } from '@platform/ai/providers/modelCapabilityInference'

import { buildModelTypeCounts } from './ModelServiceModelTypeFilter'

/** PLAT-82：类型 pill 与模型行 chip 必须使用同一个能力解析（对话框不再有 range 计数）。 */
const mimoIds = [
  'mimo-v2.5-asr',
  'mimo-v2.5-tts',
  'mimo-v2.5-tts-voiceclone',
  'mimo-v2.5-tts-voicedesign',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2.5-flash',
  'mimo-v2.6-pro',
  'mimo-v2.6-pro-ultraspeed'
]

function model(id: string, edited = false): ModelDefinition {
  return {
    id,
    name: id,
    capabilities: { chat: true, ...(edited ? { capabilitiesEdited: true } : {}) }
  }
}

describe('PLAT-82 capability consistency', () => {
  it('keeps the type pills and the row chips on the same resolved capabilities', () => {
    const models = mimoIds.map((id) => model(id))
    const textPill = buildModelTypeCounts(models).text
    const chatRows = models.filter((entry) => resolveModelCapabilities(entry).chat).length

    expect(textPill).toBe(5)
    expect(chatRows).toBe(5)
    expect(buildModelTypeCounts(models).speech).toBe(3)
    expect(buildModelTypeCounts(models).transcription).toBe(1)
  })

  it('always resolves stale stored chat=true through id rules, unless edited', () => {
    expect(resolveModelCapabilities(model('mimo-v2.5-asr'))).toMatchObject({ chat: false, transcription: true })
    for (const id of mimoIds.slice(1, 4)) {
      expect(resolveModelCapabilities(model(id))).toMatchObject({ chat: false, speech: true })
    }
    for (const id of mimoIds.slice(0, 4)) expect(resolveModelCapabilities(model(id)).chat).toBe(false)
    for (const id of mimoIds.slice(4)) {
      expect(resolveModelCapabilities(model(id)).chat).toBe(true)
    }

    const edited = model('mimo-v2.5-asr', true)
    expect(resolveModelCapabilities(edited).chat).toBe(true)
  })
})
