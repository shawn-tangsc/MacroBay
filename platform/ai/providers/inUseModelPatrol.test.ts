import { describe, expect, it } from 'vitest'

import {
  collectInUseModelTargets,
  advanceInUseModelPatrol,
  createInUseModelPatrolState,
  splitUniqueModelId,
  inUseModelRetiredStaleness,
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

  it('counts a saved image default as an in-use model (C10 keeps the field and its value)', () => {
    // 绘画模型控件已按 C10 撤掉，但字段与读者已设的值保留：`configuredDefaultModelIds`
    // 读的是 modelDefaults 的**全部**值（repositories.ts），所以它仍要参与在用巡检。
    const targets = collectInUseModelTargets({
      providers: [{
        id: 'silicon',
        enabled: true,
        apiKeyRef: 'provider:silicon',
        models: [{ id: 'flux-image', name: 'FLUX Image' }]
      }],
      configuredDefaultModelIds: ['silicon:flux-image']
    })

    expect(targets).toEqual([
      { providerId: 'silicon', modelId: 'flux-image', modelName: 'FLUX Image', source: 'configured' }
    ])
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

  it('does not call a model retired after a single observation', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }

    const once = advanceInUseModelPatrol(createInUseModelPatrolState(), [{ target, reason: 'retired' }], new Date('2026-11-01T08:00:00Z'))

    expect(once.retired).toEqual([])
    expect(once.pending).toHaveLength(1)
  })

  it('still refuses after two observations on the same day', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    const first = advanceInUseModelPatrol(createInUseModelPatrolState(), [{ target, reason: 'retired' }], new Date('2026-11-01T08:00:00Z'))
    const second = advanceInUseModelPatrol(first, [{ target, reason: 'retired' }], new Date('2026-11-01T20:00:00Z'))

    expect(second.retired).toEqual([])
    expect(second.pending[0]?.observedDays).toEqual(['2026-11-01'])
  })

  it('confirms retirement on the second day with the same code, and keeps both timestamps', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    const first = advanceInUseModelPatrol(createInUseModelPatrolState(), [{ target, reason: 'retired' }], new Date('2026-11-01T08:00:00Z'))
    const second = advanceInUseModelPatrol(first, [{ target, reason: 'retired' }], new Date('2026-11-02T08:00:00Z'))

    expect(second.retired).toEqual([{
      providerId: 'silicon',
      modelId: 'chat-a',
      modelName: 'Chat A',
      reason: 'retired',
      firstObservedAt: '2026-11-01T08:00:00.000Z',
      lastObservedAt: '2026-11-02T08:00:00.000Z'
    }])
  })

  it('resets the count when the code changes, instead of borrowing the old day', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    const first = advanceInUseModelPatrol(createInUseModelPatrolState(), [{ target, reason: 'retired' }], new Date('2026-11-01T08:00:00Z'))
    const changed = advanceInUseModelPatrol(first, [{ target, reason: 'not_found' }], new Date('2026-11-02T08:00:00Z'))

    expect(changed.retired).toEqual([])
    expect(changed.pending[0]?.observedDays).toEqual(['2026-11-02'])
  })

  it('clears a retired model as soon as a pass finds it usable', () => {
    const target: InUseModelTarget = { providerId: 'silicon', modelId: 'chat-a', modelName: 'Chat A', source: 'default' }
    const first = advanceInUseModelPatrol(createInUseModelPatrolState(), [{ target, reason: 'retired' }], new Date('2026-11-01T08:00:00Z'))
    const retired = advanceInUseModelPatrol(first, [{ target, reason: 'retired' }], new Date('2026-11-02T08:00:00Z'))
    const healed = advanceInUseModelPatrol(retired, [{ target, reason: null }], new Date('2026-11-03T08:00:00Z'))

    expect(healed.retired).toEqual([])
    expect(healed.pending).toEqual([])
  })

  it('reports staleness from the last confirmed observation', () => {
    const item = {
      providerId: 'silicon',
      modelId: 'chat-a',
      modelName: 'Chat A',
      reason: 'retired' as const,
      firstObservedAt: '2026-10-28T08:00:00.000Z',
      lastObservedAt: '2026-10-29T08:00:00.000Z'
    }

    expect(inUseModelRetiredStaleness(item, new Date('2026-10-30T08:00:00Z'))).toEqual({ days: 1, stale: false })
    expect(inUseModelRetiredStaleness(item, new Date('2026-11-01T08:00:00Z'))).toEqual({ days: 3, stale: true })
  })
})
