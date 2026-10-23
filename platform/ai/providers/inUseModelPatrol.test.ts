import { describe, expect, it } from 'vitest'

import {
  collectInUseModelTargets,
  mergeInUseModelRetiredItems,
  splitUniqueModelId,
  toInUseModelRetiredReason,
  type InUseModelTarget
} from './inUseModelPatrol'

/**
 * PLAT-75：巡检目标必须**只有**"在用模型"（默认聊天模型 + 智能体绑定），最多 3 个；
 * 只有 retired/not_found 才算下线，其它失败保持沉默。
 */
function provider(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    enabled: true,
    apiKeyRef: `provider:${id}`,
    models: [
      { id: 'chat-a', name: 'Chat A' },
      { id: 'chat-b', name: 'Chat B' }
    ],
    ...overrides
  }
}

describe('PLAT-75 in-use model patrol targets', () => {
  it('patrols the configured default models first so user choices are never squeezed out', () => {
    const targets = collectInUseModelTargets({
      providers: [
        provider('silicon', { defaultChatModelId: 'chat-a' }),
        provider('deepseek', { defaultChatModelId: 'chat-b' }),
        provider('openai', { defaultChatModelId: 'chat-a' })
      ],
      configuredDefaultModelIds: ['openai:chat-b'],
      agentModelIds: ['silicon:chat-b']
    })

    expect(targets[0]).toEqual({ providerId: 'openai', modelId: 'chat-b', modelName: 'Chat B', source: 'configured' })
    expect(targets).toHaveLength(3)
  })

  it('collects default chat models plus agent-bound models, deduped and capped', () => {
    const targets = collectInUseModelTargets({
      providers: [
        provider('silicon', { defaultChatModelId: 'chat-a' }),
        provider('deepseek', { defaultChatModelId: 'chat-b' }),
        provider('openai', { defaultChatModelId: 'chat-a' })
      ],
      agentModelIds: ['silicon:chat-a', 'deepseek:chat-b', 'openai:chat-a', 'openai:chat-b']
    })

    expect(targets).toEqual([
      { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' },
      { providerId: 'deepseek', modelId: 'chat-b', modelName: 'Chat B', source: 'default' },
      { providerId: 'openai', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    ])
    expect(targets).toHaveLength(3)
  })

  it('never targets disabled, keyless, model-less or unknown providers', () => {
    expect(collectInUseModelTargets({
      providers: [
        provider('disabled', { enabled: false, defaultChatModelId: 'chat-a' }),
        provider('keyless', { apiKeyRef: undefined, defaultChatModelId: 'chat-a' }),
        provider('no-default'),
        provider('missing-model', { defaultChatModelId: 'ghost' })
      ],
      agentModelIds: ['unknown:chat-a', 'disabled:chat-a', 'not-a-unique-id']
    })).toEqual([])
  })

  it('splits unique model ids on the first colon only', () => {
    expect(splitUniqueModelId('openai:gpt-5')).toEqual({ providerId: 'openai', modelId: 'gpt-5' })
    expect(splitUniqueModelId('google:models/gemini:2.5')).toEqual({ providerId: 'google', modelId: 'models/gemini:2.5' })
    expect(splitUniqueModelId('no-colon')).toBeNull()
    expect(splitUniqueModelId(':leading')).toBeNull()
    expect(splitUniqueModelId('trailing:')).toBeNull()
  })

  it('treats only retired / not_found as offline', () => {
    expect(toInUseModelRetiredReason('model_retired')).toBe('retired')
    expect(toInUseModelRetiredReason('model_not_found')).toBe('not_found')
    for (const code of ['rate_limited', 'network_timeout', 'http_401', 'http_500', 'unknown', undefined, null] as const) {
      expect(toInUseModelRetiredReason(code), String(code)).toBeNull()
    }
  })

  it('merges reports without duplicates and clears entries that recovered', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    const other: InUseModelTarget = { providerId: 'deepseek', modelId: 'chat-b', modelName: 'Chat B', source: 'agent' }

    const first = mergeInUseModelRetiredItems([], [{ target, reason: 'retired' }])
    const repeated = mergeInUseModelRetiredItems(first, [{ target, reason: 'retired' }])
    expect(repeated).toEqual([{ providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', reason: 'retired' }])

    const both = mergeInUseModelRetiredItems(repeated, [{ target: other, reason: 'not_found' }])
    expect(both).toHaveLength(2)

    const healed = mergeInUseModelRetiredItems(both, [{ target, reason: null }])
    expect(healed).toEqual([{ providerId: 'deepseek', modelId: 'chat-b', modelName: 'Chat B', reason: 'not_found' }])
  })
})
