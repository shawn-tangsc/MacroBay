import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { previewProviderModelSync } from './providerModelSync'
import { createSystemProviderPresets } from './providerPresets'
import { normalizeProviderState } from './providerStore'
import { resolveProviderChatBase } from './providerChatEndpoints'

/**
 * PLAT-66：Gemini 的**主端点**是原生协议（主机名），不是 OpenAI 兼容前缀。
 * 实测：把主机名当 OpenAI 兼容 base 用 ⇒ `/v1/chat/completions` 必然 404。
 */
const GEMINI_HOST = 'https://generativelanguage.googleapis.com'

function geminiPreset(): ModelProvider {
  const preset = createSystemProviderPresets().find((provider) => provider.id === 'gemini')
  if (!preset) throw new Error('The gemini preset is missing.')
  return preset
}

describe('PLAT-66 Gemini 主端点是原生协议', () => {
  it('keeps the gemini preset on the host base with the native endpoint configured', () => {
    const gemini = geminiPreset()

    expect(gemini.endpoints).toEqual([{ protocol: 'gemini', baseUrl: GEMINI_HOST }])
    expect(gemini.endpoints[0]?.protocol).toBe('gemini')
    expect(gemini.baseUrl).toBe(GEMINI_HOST)
  })

  it('defaults every chat-capable gemini preset model to the native chat protocol', () => {
    const chatModels = geminiPreset().models.filter((model) => model.capabilities.chat)
    expect(chatModels.length).toBeGreaterThan(0)
    for (const model of chatModels) expect(model.chatProtocol, model.id).toBe('gemini')

    // 图片模型不写聊天协议（否则会在抽屉里显示一个用不了的选项）。
    const image = geminiPreset().models.find((model) => model.id === 'gemini-2.5-flash-image-preview')
    expect(image?.capabilities.chat).toBe(false)
    expect(image?.chatProtocol).toBeUndefined()
  })

  it('never marks gemini models as Claude Code capable (no /v1/messages)', () => {
    // PLAT-71：Gemini 不能跑 Claude Code（协议不通）；标了就会出现「能选但跑不了」。
    for (const model of geminiPreset().models) {
      expect(model.capabilities.agentRuntimes?.claudeCode, model.id).not.toBe(true)
    }
  })

  it('fills the missing native endpoint and model chat protocol from the preset', () => {
    // PLAT-72：不再有"历史错误地址纠正表"（JSON 迁移已取消）；这里只保证**缺字段**时
    // 预设能把原生端点与模型默认协议补齐，否则原生聊天会 endpoint_missing。
    const state = normalizeProviderState({
      providers: [
        {
          id: 'gemini',
          name: 'Gemini',
          endpoints: [
            { protocol: 'gemini', baseUrl: GEMINI_HOST }
          ],
          enabled: true,
          apiKey: 'fixture-gemini-key',
          models: [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { chat: true } }
          ]
        }
      ]
    })

    const gemini = state.providers.find((provider) => provider.id === 'gemini')
    expect(resolveProviderChatBase(gemini!, 'gemini')).toBe(GEMINI_HOST)
    expect(gemini?.models.find((model) => model.id === 'gemini-2.5-flash')?.chatProtocol).toBe('gemini')
  })

  it('keeps a user-edited gemini base and an explicitly chosen chat protocol', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'gemini',
          name: 'Gemini',
          endpoints: [
            { protocol: 'gemini', baseUrl: 'https://gemini-proxy.example.test' }
          ],
          enabled: true,
          models: [
            {
              id: 'gemini-2.5-flash',
              name: 'Gemini 2.5 Flash',
              capabilities: { chat: true },
              chatProtocol: 'chat-completions'
            }
          ]
        }
      ]
    })

    const gemini = state.providers.find((provider) => provider.id === 'gemini')
    // 用户改过的端点 base 保留；主地址由端点派生（原生 supplier 就是它自己的端点）。
    expect(gemini?.baseUrl).toBe('https://gemini-proxy.example.test')
    expect(resolveProviderChatBase(gemini!, 'gemini')).toBe('https://gemini-proxy.example.test')
    expect(gemini?.models.find((model) => model.id === 'gemini-2.5-flash')?.chatProtocol).toBe('chat-completions')
  })

  it('syncs the gemini model list through the native /v1beta/models endpoint', async () => {
    // PLAT-71：原生列表存在（/v1beta/models），不再报「不支持模型列表」。
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({
        models: [
          { name: 'models/gemini-9-experimental', displayName: 'Gemini 9 Experimental', supportedGenerationMethods: ['generateContent'] }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
    const outcome = await previewProviderModelSync(
      { ...geminiPreset(), apiKey: 'fixture-gemini-key' },
      { fetch: fetch as unknown as typeof globalThis.fetch }
    )

    expect(outcome).toMatchObject({ ok: true })
    if (outcome.ok !== true) return
    expect(outcome.added.map((model) => model.id)).toEqual(['gemini-9-experimental'])
    // T4/T5：同步时把供应商当前的默认端点快照进模型协议（gemini 预设的默认就是 gemini）。
    expect(outcome.added[0]?.chatProtocol).toBe('gemini')
    expect(geminiPreset().endpoints[0]?.protocol).toBe('gemini')
    const url = String((fetch.mock.calls[0] as unknown as [string])[0])
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(url).not.toContain('/v1/models')
  })
})
