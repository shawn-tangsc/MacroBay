import { describe, expect, it, vi } from 'vitest'

import { createInUseModelPatrolRuntime } from './inUseModelPatrolRuntime'

function provider(id: string, modelIds: string[], defaultModelId = modelIds[0]) {
  return {
    id,
    enabled: true,
    apiKeyRef: `provider:${id}`,
    defaultChatModelId: defaultModelId,
    models: modelIds.map((modelId) => ({ id: modelId, name: modelId }))
  }
}

describe('in-use model patrol runtime', () => {
  it('probes only the models that are in use, never the whole catalogue', async () => {
    const testConnection = vi.fn(async () => ({ failureCode: null }))
    const runtime = createInUseModelPatrolRuntime({
      listProviders: async () => [
        provider('silicon', ['chat-a', 'chat-b', 'chat-c', 'chat-d']),
        provider('deepseek', ['chat-x', 'chat-y'])
      ],
      loadAgentModelIds: async () => ['deepseek:chat-y'],
      configuredDefaultModelIds: async () => ['silicon:chat-a'],
      testConnection
    })

    await runtime.runOnce()

    // 每个已配置供应商的默认聊天模型 + 智能体绑定，去重后最多 3 个——不是全部六七个。
    const probed = testConnection.mock.calls.map((call) => (call as unknown as [string, string])[1])
    expect(probed.length).toBeLessThanOrEqual(3)
    expect(probed).toContain('chat-a')
    expect(probed).toContain('chat-y')
    for (const unused of ['chat-b', 'chat-c', 'chat-d']) expect(probed).not.toContain(unused)
  })

  it('does not report a model retired after one failed day', async () => {
    let day = '2026-11-01T08:00:00Z'
    const runtime = createInUseModelPatrolRuntime({
      now: () => new Date(day),
      listProviders: async () => [provider('silicon', ['gone'])],
      loadAgentModelIds: async () => ['silicon:gone'],
      testConnection: async () => ({ failureCode: 'model_retired' })
    })

    // 只有一天失败：供应商维护或路由抖动都可能这样。
    expect(await runtime.runOnce()).toEqual([])
  })

  it('confirms a retired model on the second day and drops a transient failure', async () => {
    let day = '2026-11-01T08:00:00Z'
    const runtime = createInUseModelPatrolRuntime({
      now: () => new Date(day),
      listProviders: async () => [provider('silicon', ['gone', 'flaky'])],
      loadAgentModelIds: async () => ['silicon:gone', 'silicon:flaky'],
      testConnection: async (_providerId, modelId) =>
        modelId === 'gone' ? { failureCode: 'model_retired' } : { failureCode: 'rate_limited' }
    })

    expect(await runtime.runOnce()).toEqual([])
    day = '2026-11-02T08:00:00Z'
    const items = await runtime.runOnce()

    expect(items).toEqual([
      {
        providerId: 'silicon',
        modelId: 'gone',
        modelName: 'gone',
        reason: 'retired',
        firstObservedAt: '2026-11-01T08:00:00.000Z',
        lastObservedAt: '2026-11-02T08:00:00.000Z'
      }
    ])
  })

  it('forgets a model once a later pass finds it usable again', async () => {
    let recovered = false
    let day = '2026-11-01T08:00:00Z'
    const runtime = createInUseModelPatrolRuntime({
      now: () => new Date(day),
      listProviders: async () => [provider('silicon', ['chat-a'])],
      loadAgentModelIds: async () => ['silicon:chat-a'],
      testConnection: async () => ({ failureCode: recovered ? null : 'model_not_found' })
    })

    await runtime.runOnce()
    day = '2026-11-02T08:00:00Z'
    expect(await runtime.runOnce()).toHaveLength(1)
    recovered = true
    day = '2026-11-03T08:00:00Z'
    expect(await runtime.runOnce()).toEqual([])
  })

  it('swallows a thrown probe instead of failing the whole pass', async () => {
    let day = '2026-11-01T08:00:00Z'
    const runtime = createInUseModelPatrolRuntime({
      now: () => new Date(day),
      listProviders: async () => [provider('silicon', ['chat-a', 'chat-b'])],
      loadAgentModelIds: async () => ['silicon:chat-a', 'silicon:chat-b'],
      testConnection: async (_providerId, modelId) => {
        if (modelId === 'chat-a') throw new Error('boom')
        return { failureCode: 'model_retired' }
      }
    })

    await runtime.runOnce()
    day = '2026-11-02T08:00:00Z'
    const items = await runtime.runOnce()

    expect(items.map((item) => item.modelId)).toEqual(['chat-b'])
  })
})
