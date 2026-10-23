import { describe, expect, it } from 'vitest'

import {
  createSystemProviderPresets,
  needsModelProtocolNotice,
  providerProtocolDeclarationOf
} from './providerPresets'

describe('provider preset protocol declaration', () => {
  it('declares coverage next to the provider config (single source of truth)', () => {
    expect(providerProtocolDeclarationOf('lanyun')).toBe('declared')
    expect(providerProtocolDeclarationOf('tokenrhythm')).toBe('declared')
    for (const id of ['poe', 'aihubmix', 'burncloud']) {
      expect(providerProtocolDeclarationOf(id), id).toBe('endpoint-types')
    }
    expect(providerProtocolDeclarationOf('deepseek')).toBe('single-hint')
  })

  it('does not warn when the list already tells you enough', () => {
    for (const id of ['lanyun', 'tokenrhythm', 'poe', 'aihubmix', 'burncloud']) {
      expect(needsModelProtocolNotice(id), id).toBe(false)
    }
  })

  it('does not warn for first-party providers whose protocol is the API itself', () => {
    // OpenAI / Anthropic / Gemini 直连：协议由 API 决定，列表不给协议是正常的，
    // 让用户去"检测模型"纯属多余。
    for (const id of ['openai', 'anthropic', 'gemini']) {
      expect(providerProtocolDeclarationOf(id), id).toBe('native')
      expect(needsModelProtocolNotice(id), id).toBe(false)
      expect(needsModelProtocolNotice(id, [{}, {}]), id).toBe(false)
    }
  })

  it('warns for a single hint and for no hint at all', () => {
    // DeepSeek 只声明 `anthropic_messages` 一个子串，responses 可用却不声明 ⇒ 说了等于没说。
    expect(needsModelProtocolNotice('deepseek')).toBe(true)
    for (const id of ['dashscope', 'doubao', 'aionly', 'cephalon', 'qiniu', 'zai', 'mimo', 'moonshot']) {
      expect(providerProtocolDeclarationOf(id), id).toBe('none')
      expect(needsModelProtocolNotice(id), id).toBe(true)
    }
  })

  it('stays silent for unmeasured providers before they are synced', () => {
    // 没测过又没同步：不能凭空断言"这家不给协议"。
    expect(providerProtocolDeclarationOf('silicon')).toBeUndefined()
    expect(needsModelProtocolNotice('silicon')).toBe(false)
    expect(needsModelProtocolNotice('silicon', [])).toBe(false)
  })

  it('derives the answer from synced models for unmeasured providers', () => {
    // 同步完了、没有任何一条带 declarationSource ⇒ 列表确实什么都没给（硅基流动就是这样）。
    expect(needsModelProtocolNotice('silicon', [{}, {}])).toBe(true)
    // 有逐模型声明 ⇒ 列表给了线索，不提示。
    expect(needsModelProtocolNotice('silicon', [{}, { declarationSource: 'provider_list' }])).toBe(false)
    // 显式实测结论优先于同步结果。
    expect(needsModelProtocolNotice('lanyun', [{}])).toBe(false)
    expect(needsModelProtocolNotice('deepseek', [{ declarationSource: 'provider_list' }])).toBe(true)
  })

  it('only references provider ids that exist', () => {
    const ids = new Set(createSystemProviderPresets().map((preset) => preset.id))
    for (const id of ['lanyun', 'tokenrhythm', 'poe', 'aihubmix', 'burncloud', 'deepseek',
      'dashscope', 'doubao', 'aionly', 'cephalon', 'qiniu', 'zai', 'mimo', 'moonshot']) {
      expect(ids.has(id), id).toBe(true)
    }
  })
})
