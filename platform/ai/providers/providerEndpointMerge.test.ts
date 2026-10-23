import { describe, expect, it } from 'vitest'

import type { ModelChatProtocol, ProviderChatEndpoint } from './modelProviderTypes'
import { diffRemovedEndpointProtocols, mergeProviderEndpoints } from './providerEndpointMerge'

/**
 * 端点合并契约（预设 × 用户库）：
 *
 * | 场景 | 期望 |
 * | --- | --- |
 * | 预设新增协议、用户没配过 | 自动补进，追加在用户清单末尾 |
 * | 用户已有同协议端点（地址改过） | 保留用户的，不覆盖 |
 * | 用户手动删掉某个协议（墓碑） | 不补 |
 * | 用户重新添加该协议 | 墓碑清掉（由 `diffRemovedEndpointProtocols` 负责） |
 * | 用户清单为空 | 用预设清单，但减去墓碑 |
 * | `endpoints[0]` | 位置永远不变（追加只发生在末尾） |
 */
const chat: ProviderChatEndpoint = { protocol: 'chat-completions', baseUrl: 'https://ai.burncloud.com' }
const messages: ProviderChatEndpoint = { protocol: 'messages', baseUrl: 'https://ai.burncloud.com' }
const gemini: ProviderChatEndpoint = { protocol: 'gemini', baseUrl: 'https://ai.burncloud.com' }

function merge(
  userEndpoints: ProviderChatEndpoint[],
  presetEndpoints: ProviderChatEndpoint[],
  removedEndpointProtocols?: ModelChatProtocol[]
): ProviderChatEndpoint[] {
  return mergeProviderEndpoints(
    { endpoints: userEndpoints, ...(removedEndpointProtocols ? { removedEndpointProtocols } : {}) },
    { endpoints: presetEndpoints }
  )
}

describe('mergeProviderEndpoints appends preset protocols the user never configured', () => {
  it('appends a protocol newly added to the preset, keeping the user order', () => {
    expect(merge([chat, messages], [chat, messages, gemini])).toEqual([chat, messages, gemini])
  })

  it('keeps the user endpoint (including an edited base) instead of the preset one', () => {
    const edited: ProviderChatEndpoint = { protocol: 'messages', baseUrl: 'https://proxy.example.test/anthropic' }

    expect(merge([chat, edited], [chat, messages, gemini])).toEqual([chat, edited, gemini])
  })

  it('keeps endpoints the user configured that the preset does not declare', () => {
    const custom: ProviderChatEndpoint = { protocol: 'messages', baseUrl: 'https://proxy.example.test' }

    expect(merge([chat, custom], [chat, messages, gemini])).toEqual([chat, custom, gemini])
  })

  it('appends every preset protocol in preset order when the user has only the default', () => {
    expect(merge([chat], [chat, messages, gemini])).toEqual([chat, messages, gemini])
  })

  it('never changes the position of the default endpoint (endpoints[0])', () => {
    const merged = merge([messages, chat], [chat, messages, { protocol: 'responses', baseUrl: 'https://x.test' }])

    expect(merged[0]).toEqual(messages)
    expect(merged.map((endpoint) => endpoint.protocol)).toEqual(['messages', 'chat-completions', 'responses'])
  })
})

describe('mergeProviderEndpoints respects removed endpoint protocols', () => {
  it('does not re-add a tombstoned protocol', () => {
    expect(merge([chat, messages], [chat, messages, gemini], ['gemini'])).toEqual([chat, messages])
  })

  it('does not touch an endpoint the user still has even if it is tombstoned', () => {
    // 墓碑只在"预设想补"时生效：用户清单里真有的协议一律保留（清墓碑由写入点负责）。
    expect(merge([chat, gemini], [chat, gemini], ['gemini'])).toEqual([chat, gemini])
  })

  it('falls back to the preset list minus tombstones when the user has no endpoints', () => {
    expect(merge([], [chat, messages, gemini], ['gemini'])).toEqual([chat, messages])
  })

  it('keeps an all-tombstoned provider empty instead of resurrecting every endpoint', () => {
    expect(merge([], [chat, messages, gemini], ['gemini', 'messages', 'chat-completions'])).toEqual([])
  })

  it('keeps the original behavior (preset list) when there is no tombstone', () => {
    expect(merge([], [chat, messages, gemini])).toEqual([chat, messages, gemini])
  })
})

describe('diffRemovedEndpointProtocols writes only real user deletions', () => {
  it('records a protocol the new endpoint list no longer contains', () => {
    expect(diffRemovedEndpointProtocols({
      previousEndpoints: [chat, messages, gemini],
      nextEndpoints: [chat, messages]
    })).toEqual(['gemini'])
  })

  it('does not record anything when the user keeps (or edits) the same protocols', () => {
    expect(diffRemovedEndpointProtocols({
      previousEndpoints: [chat, messages],
      nextEndpoints: [chat, { protocol: 'messages', baseUrl: 'https://other.test' }]
    })).toBeUndefined()
  })

  it('clears the tombstone once the user adds the protocol back', () => {
    expect(diffRemovedEndpointProtocols({
      previousEndpoints: [chat, messages],
      nextEndpoints: [chat, messages, gemini],
      removedEndpointProtocols: ['gemini']
    })).toBeUndefined()
  })

  it('union-accumulates older tombstones that are still missing', () => {
    expect(diffRemovedEndpointProtocols({
      previousEndpoints: [chat, messages, gemini],
      nextEndpoints: [chat],
      removedEndpointProtocols: ['messages']
    })).toEqual(['gemini', 'messages'])
  })
})
