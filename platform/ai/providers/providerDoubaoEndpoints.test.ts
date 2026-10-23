import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from './providerPresets'
import { normalizeProviderState } from './providerStore'
import { buildMessagesUrl, buildResponsesUrl } from './providerEndpoints'
import { resolveProviderChatBase } from './providerChatEndpoints'

/**
 * 火山方舟（豆包）官方三条路径（对应控制台文档「推荐使用方式」）：
 *  - Chat API（OpenAI 兼容）  `/api/v3/chat/completions`
 *  - Responses API            `/api/v3/responses`
 *  - Anthropic 兼容 API       `/api/compatible/v1/messages`  ← 注意不是 /api/v3
 * 预设必须与文档一致，否则 Anthropic 行测试 / messages 探测 / Claude Code 直连必然 404。
 */
function doubao() {
  const preset = createSystemProviderPresets().find((provider) => provider.id === 'doubao')
  if (!preset) throw new Error('Missing doubao preset')
  return preset
}

describe('doubao (volcengine ark) preset endpoints', () => {
  it('uses /api/v3 for the OpenAI-compatible chat base', () => {
    expect(doubao().baseUrl.replace(/\/+$/, '')).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('builds the documented anthropic-compatible messages url', () => {
    expect(buildMessagesUrl(resolveProviderChatBase(doubao(), 'messages') ?? '')).toBe(
      'https://ark.cn-beijing.volces.com/api/compatible/v1/messages'
    )
  })

  it('keeps chat/completions as the default protocol (tools + streaming live there)', () => {
    const chatModels = doubao().models.filter((model) => model.capabilities.chat)
    expect(chatModels.length).toBeGreaterThan(0)
    // 默认链路不降能力：Responses 端点仍然预置，但需要用户在模型抽屉里**显式**切过去。
    // T4/T5：协议写在模型上（豆包默认 chat/completions，工具与流式都在这条链路）。
    for (const model of chatModels) expect(model.chatProtocol, model.id).toBe('chat-completions')
    expect(doubao().endpoints[0]?.protocol).toBe('chat-completions')
    expect(resolveProviderChatBase(doubao(), 'responses')).toBeTruthy()
  })

  it('leaves the retired model generation behind and ships the documented one', () => {
    const ids = doubao().models.map((model) => model.id)
    // 旧一代在方舟已下线（调用返回 404 InvalidEndpointOrModel），不能再出现在预设里
    expect(ids).not.toContain('doubao-seed-1-8-251228')
    expect(ids).not.toContain('deepseek-v3-250324')
    expect(ids).toContain('doubao-seed-2-1-pro-260915')
    expect(ids).toContain('doubao-seed-2-0-pro-260215')
  })

  it('keeps the user endpoints and appends preset protocols the user never configured', () => {
    const state = normalizeProviderState({
      providers: [
        {
          id: 'doubao',
          name: 'doubao',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/' },
            { protocol: 'messages', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }
          ],
          enabled: true,
          models: []
        }
      ]
    })

    // 用户已有的端点归用户库：不"纠正"地址、不改变默认端点位置；
    // 预设里用户没配过、也没删过的 responses 追加到末尾（预设新增协议自动补进）。
    const doubaoProvider = state.providers.find((provider) => provider.id === 'doubao')!
    expect(doubaoProvider.endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { protocol: 'messages', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { protocol: 'responses', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }
    ])
  })

  it('ships the documented responses endpoint', () => {
    expect(buildResponsesUrl(resolveProviderChatBase(doubao(), 'responses') ?? '')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/responses'
    )
  })
})
