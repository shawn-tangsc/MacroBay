import { describe, expect, it } from 'vitest'

import type { ModelChatProtocol, ModelDefinition } from './modelProviderTypes'
import {
  addOrUpdateModel,
  applyProbedProtocols,
  createDefaultProviderState,
  createProviderStore,
  normalizeProviderState,
  toSafeProvider,
  upsertProvider
} from './providerStore'

/**
 * PLAT-62：模型级协议检测结果必须**持久化 round-trip**，
 * 并在 Safe view 里带出（渲染层徽标/筛选要用）。
 */
const probedModel = {
  id: 'glm-4.6',
  name: 'GLM-4.6',
  capabilities: { chat: true },
  messagesSupport: 'yes' as const,
  responsesSupport: 'yes' as const,
  declarationSource: 'provider_list' as const,
  supportedProtocols: ['chat-completions', 'responses', 'messages'] as ModelChatProtocol[],
  protocolProbedAt: '2026-08-01T00:00:00.000Z',
  probeStatus: 'passed' as const,
  contextLength: 200000,
  maxCompletionTokens: 32000,
  pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28, cacheReadPerMillion: 2, hasDiscount: true }
}

describe('PLAT-62 model protocol persistence', () => {
  it('keeps messagesSupport/protocolProbedAt across addOrUpdateModel + normalize round-trip', () => {
    const state = addOrUpdateModel(createDefaultProviderState(), 'aionly', probedModel)
    const reloaded = normalizeProviderState(JSON.parse(JSON.stringify(state)))

    const model = reloaded.providers.find((provider) => provider.id === 'aionly')?.models
      .find((entry) => entry.id === 'glm-4.6')
    expect(model).toMatchObject({
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages'],
      protocolProbedAt: '2026-08-01T00:00:00.000Z',
      probeStatus: 'passed',
      contextLength: 200000,
      pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28, hasDiscount: true }
    })
  })

  it('keeps the probe result when the provider is upserted from the UI', () => {
    const withModel = addOrUpdateModel(createDefaultProviderState(), 'aionly', probedModel)
    const provider = withModel.providers.find((entry) => entry.id === 'aionly')
    if (!provider) throw new Error('expected aionly')

    const next = upsertProvider(withModel, {
      id: 'aionly',
      name: provider.name,
      enabled: true,
      endpoints: provider.endpoints,
      models: provider.models
    })
    const model = normalizeProviderState(JSON.parse(JSON.stringify(next))).providers
      .find((entry) => entry.id === 'aionly')?.models.find((entry) => entry.id === 'glm-4.6')

    expect(model?.messagesSupport).toBe('yes')
    expect(model?.responsesSupport).toBe('yes')
    expect(model?.declarationSource).toBe('provider_list')
    expect(model?.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
    expect(model?.protocolProbedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(model?.probeStatus).toBe('passed')
  })

  it('keeps probedProtocols (detection evidence) when the drawer saves without it', () => {
    const withEvidence = addOrUpdateModel(createDefaultProviderState(), 'aionly', {
      ...probedModel,
      probedProtocols: ['messages']
    })
    // 抽屉保存只带名字/能力/协议，不带证据 ⇒ 证据必须保留，且仍可 round-trip。
    const edited = addOrUpdateModel(withEvidence, 'aionly', {
      id: 'glm-4.6',
      name: 'GLM-4.6 (renamed)',
      capabilities: { chat: true }
    })
    const model = normalizeProviderState(JSON.parse(JSON.stringify(edited))).providers
      .find((entry) => entry.id === 'aionly')?.models.find((entry) => entry.id === 'glm-4.6')

    expect(model?.name).toBe('GLM-4.6 (renamed)')
    expect(model?.probedProtocols).toEqual(['messages'])
  })

  it('records passed protocols in one write and never removes evidence', async () => {
    const writes: unknown[] = []
    const store = createProviderStore({
      read: async () => ({
        providers: [{
          id: 'silicon',
          name: 'Silicon',
          enabled: true,
          endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }],
          models: [{ id: 'deepseek-v3-2', name: 'DeepSeek V3.2', capabilities: { chat: true }, chatProtocol: 'chat-completions' }]
        }]
      }),
      write: async (value: unknown) => { writes.push(value) }
    })
    const initial = await store.list()
    const before = initial.find((entry) => entry.id === 'silicon')?.models.find((entry) => entry.id === 'deepseek-v3-2')
    const baseline = writes.length

    // 一次 run 一次写入：两个模型 / 多条协议都进同一次 save。
    await store.recordProbedProtocols('silicon', [
      { modelId: 'deepseek-v3-2', protocols: ['messages', 'chat-completions'] }
    ])
    expect(writes.length - baseline).toBe(1)

    const model = (await store.list()).find((entry) => entry.id === 'silicon')?.models
      .find((entry) => entry.id === 'deepseek-v3-2')
    // 通过的协议并进 supportedProtocols，并记进 probedProtocols（来源标记）。
    expect(model?.supportedProtocols).toEqual(['chat-completions', 'messages'])
    expect(model?.probedProtocols).toEqual(['chat-completions', 'messages'])

    // 写库只动这两个字段：状态文案（成功/失败/跳过）永远不进记录。
    const withoutEvidence = (value: ModelDefinition | undefined): Record<string, unknown> => {
      if (!value) throw new Error('expected model')
      const { supportedProtocols: _supported, probedProtocols: _probed, ...rest } = value
      return rest as Record<string, unknown>
    }
    expect(withoutEvidence(model)).toEqual(withoutEvidence(before))
    expect(model).not.toHaveProperty('probeStatus')
    expect(model).not.toHaveProperty('probeReason')

    // 重复写入同样的证据 ⇒ 不产生新写入（不会每轮检测都刷库）。
    await store.recordProbedProtocols('silicon', [
      { modelId: 'deepseek-v3-2', protocols: ['messages'] }
    ])
    expect(writes.length - baseline).toBe(1)
  })

  it('keeps the declared set untouched when a declared protocol passes', () => {
    const state = addOrUpdateModel(createDefaultProviderState(), 'aionly', {
      ...probedModel,
      declaredProtocols: ['messages', 'responses']
    })
    const provider = state.providers.find((entry) => entry.id === 'aionly')
    if (!provider) throw new Error('expected aionly')

    // 已声明 + 实测通过 ⇒ 只记证据，不把声明改写成"实测"。
    const next = applyProbedProtocols(state, 'aionly', [{ modelId: 'glm-4.6', protocols: ['messages'] }])
    const model = next.providers.find((entry) => entry.id === 'aionly')?.models
      .find((entry) => entry.id === 'glm-4.6')

    expect(model?.declaredProtocols).toEqual(['responses', 'messages'])
    expect(model?.probedProtocols).toEqual(['messages'])
    expect(model?.supportedProtocols).toEqual(['chat-completions', 'responses', 'messages'])
  })

  it('exposes the probe fields in the renderer-safe view', () => {
    const provider = createDefaultProviderState().providers.find((entry) => entry.id === 'aionly')
    if (!provider) throw new Error('expected aionly')
    const safe = toSafeProvider({
      ...provider,
      apiKey: 'secret-key',
      models: [probedModel]
    })

    expect(safe.models[0]).toMatchObject({
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages'],
      protocolProbedAt: '2026-08-01T00:00:00.000Z',
      probeStatus: 'passed',
      contextLength: 200000,
      pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28, hasDiscount: true }
    })
    expect(JSON.stringify(safe)).not.toContain('secret-key')
  })
})
