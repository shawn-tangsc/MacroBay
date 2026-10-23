import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from './providerPresets'
import { addOrUpdateModel, normalizeProviderState } from './providerStore'
import { applyModelSyncPlan } from './providerModelSync'

/**
 * PLAT-63 C：加载期（normalize / mergeSystemProviderPresets）**绝不删除任何模型**。
 * 旧预设模型改为归档：保留数据 + `presetStale: true`，删除只发生在「获取模型列表」的
 * 用户确认里（见 providerModelSync 的「本地多余（预设已变更）」组）。
 */
const basePreset = createSystemProviderPresets().find((provider) => provider.id === 'silicon')!
const keptPreset = basePreset.models[0]

function state(models: unknown[]): unknown {
  return {
    providers: [{
      id: 'silicon',
      name: 'Xirang',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://example.test' }
      ],
      enabled: true,
      baseUrl: 'https://example.test',
      models
    }]
  }
}

const staleFixture = {
  id: 'stale-preset',
  name: 'Stale Preset',
  group: 'legacy',
  presetModel: true,
  capabilities: { chat: true }
}

type NormalizedModel = {
  id: string
  presetStale?: boolean
  probeStatus?: string
  messagesSupport?: string
  capabilities: { capabilitiesEdited?: boolean }
}

function normalizedModels(value: unknown): NormalizedModel[] {
  const next = normalizeProviderState(value)
  return next.providers.find((provider) => provider.id === 'silicon')!.models as NormalizedModel[]
}

describe('PLAT-63 C stale preset models are archived, never deleted while loading', () => {
  it('keeps a stale preset model, flags it presetStale, and never shrinks the model id set', () => {
    const input = state([
      staleFixture,
      {
        id: keptPreset.id,
        name: keptPreset.name,
        group: keptPreset.group,
        presetModel: true,
        capabilities: { chat: true, capabilitiesEdited: true },
        probeStatus: 'passed',
        probeReason: 'provider_capability'
      },
      {
        id: 'custom-x',
        name: 'Custom X',
        provider: 'custom',
        capabilities: { chat: true, tools: true }
      }
    ])

    const before = (input as { providers: Array<{ models: Array<{ id: string }> }> })
      .providers[0]!.models.map((model) => model.id)
    const models = normalizedModels(input)
    const ids = models.map((model) => model.id)

    // 硬约束：normalize 前后模型 id 集合不得减少。
    for (const id of before) expect(ids).toContain(id)
    expect(models.find((model) => model.id === 'stale-preset')?.presetStale).toBe(true)
    expect(models.find((model) => model.id === keptPreset.id)?.presetStale).toBeUndefined()
    expect(models.find((model) => model.id === 'custom-x')?.presetStale).toBeUndefined()

    // 既有字段不回归。
    const kept = models.find((model) => model.id === keptPreset.id)
    expect(kept?.probeStatus).toBe('passed')
    expect(kept?.capabilities.capabilitiesEdited).toBe(true)
    expect(ids.indexOf('custom-x')).toBeGreaterThan(ids.indexOf(keptPreset.id))
  })

  it('preserves presetStale across a load → normalize round trip', () => {
    const first = normalizeProviderState(state([staleFixture]))
    const stale = first.providers
      .find((provider) => provider.id === 'silicon')!
      .models.find((model) => model.id === 'stale-preset')
    expect(stale?.presetStale).toBe(true)

    const second = normalizeProviderState(first)
    const sillicon = second.providers.find((provider) => provider.id === 'silicon')!
    expect(sillicon.models.find((model) => model.id === 'stale-preset')?.presetStale).toBe(true)
    // 多次 round-trip 不重复。
    expect(sillicon.models.filter((model) => model.id === 'stale-preset')).toHaveLength(1)
  })

  it('clears the stale flag when a model returns to the current preset', () => {
    const first = normalizeProviderState(state([staleFixture]))
    const withReturning = {
      providers: first.providers.map((provider) => provider.id === 'silicon'
        ? {
            ...provider,
            models: provider.models.map((model) => model.id === keptPreset.id
              ? { ...model, presetStale: true }
              : model)
          }
        : provider)
    }

    const models = normalizedModels(withReturning)
    expect(models.find((model) => model.id === keptPreset.id)?.presetStale).toBeUndefined()
  })
})

describe('PLAT-66/PLAT-63 C synced models are never archived as stale', () => {
  it('keeps a synced model that merely carries a group label and never flags it', () => {
    // 回归：曾经用 `group` 判定"预设模型"，导致同步来的模型在下次加载时被当成旧预设删除。
    const models = normalizedModels(state([
      {
        id: 'synced-model-x',
        name: 'Synced X',
        group: 'owned-by-someone',
        capabilities: { chat: true },
        messagesSupport: 'yes',
        probeStatus: 'passed'
      }
    ]))

    const synced = models.find((model) => model.id === 'synced-model-x')
    expect(synced, 'synced model must survive normalization').toBeTruthy()
    expect(synced?.presetStale).toBeUndefined()
    expect(synced?.messagesSupport).toBe('yes')
  })
})

describe('PLAT-70 deleting a preset model survives a restart', () => {
  it('does not re-add a preset model the user removed', () => {
    const preset = createSystemProviderPresets().find((provider) => provider.id === 'silicon')!
    const target = preset.models[0]

    const removed = normalizeProviderState({
      providers: [{
        id: 'silicon',
        name: 'Silicon',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' }
        ],
        enabled: true,
        baseUrl: 'https://example.test',
        models: preset.models.map((model) => ({ ...model })),
        removedPresetModelIds: [target.id]
      }]
    })

    const provider = (removed as { providers: Array<{ id: string, models: Array<{ id: string }> }> })
      .providers.find((item) => item.id === 'silicon')!
    expect(provider.models.map((model) => model.id)).not.toContain(target.id)
    expect(provider.models.length).toBe(preset.models.length - 1)
  })
})

describe('PLAT-70 preset models keep their origin flag after a merge', () => {
  it('marks merged preset models as preset origin so deletion can be remembered', () => {
    const preset = createSystemProviderPresets().find((provider) => provider.id === 'silicon')!
    const merged = normalizeProviderState({
      providers: [{
        id: 'silicon',
        name: 'Silicon',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.test' }
        ],
        enabled: true,
        baseUrl: 'https://example.test',
        // 旧版本持久化数据：没有 presetModel 标记
        models: preset.models.map((model) => ({ id: model.id, name: model.name, capabilities: { chat: true } }))
      }]
    })

    const provider = (merged as { providers: Array<{ id: string, models: Array<{ id: string, presetModel?: boolean }> }> })
      .providers.find((item) => item.id === 'silicon')!
    expect(provider.models.every((model) => model.presetModel === true)).toBe(true)
  })
})

describe('PLAT-70 models removed through the sync plan stay removed', () => {
  it('writes a tombstone when the sync plan removes a preset model', () => {
    const preset = createSystemProviderPresets().find((provider) => provider.id === 'silicon')!
    const target = preset.models[0]

    const afterSync = applyModelSyncPlan(
      {
        providers: [{
          id: 'silicon',
          name: 'Silicon',
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://example.test' }
          ],
          enabled: true,
          baseUrl: 'https://example.test',
          models: preset.models.map((model) => ({ ...model }))
        }]
      },
      'silicon',
      { toAdd: [], toUpdate: [], toRemove: [target.id] }
    )

    const provider = (afterSync as { providers: Array<{ id: string, models: Array<{ id: string }>, removedPresetModelIds?: string[] }> })
      .providers.find((item) => item.id === 'silicon')!
    expect(provider.models.map((model) => model.id)).not.toContain(target.id)
    expect(provider.removedPresetModelIds).toContain(target.id)

    const reloaded = normalizeProviderState(afterSync)
    const reloadedProvider = (reloaded as { providers: Array<{ id: string, models: Array<{ id: string }> }> })
      .providers.find((item) => item.id === 'silicon')!
    expect(reloadedProvider.models.map((model) => model.id)).not.toContain(target.id)
  })
})

describe('PLAT-71 editing a probed model keeps its probe evidence', () => {
  it('keeps probeStatus when the drawer saves capabilities and protocol', () => {
    const base = normalizeProviderState({
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ],
        enabled: true,
        baseUrl: 'https://api.deepseek.com',

        models: [{
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          capabilities: { chat: true, agent: true },
          messagesSupport: 'yes',
          probeStatus: 'passed',
          probeReason: 'provider_capability',
          protocolProbedAt: '2026-10-19T10:00:00.000Z'
        }]
      }]
    })

    const edited = addOrUpdateModel(base as never, 'deepseek', {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      capabilities: { chat: true, agent: true, tools: true },
      chatProtocol: 'messages'
    } as never)

    const provider = (edited as { providers: Array<{ id: string, models: Array<{ id: string, probeStatus?: string, messagesSupport?: string, chatProtocol?: string }> }> })
      .providers.find((item) => item.id === 'deepseek')!
    const model = provider.models.find((item) => item.id === 'deepseek-v4-pro')!
    expect(model.chatProtocol).toBe('messages')
    expect(model.probeStatus).toBe('passed')
    expect(model.messagesSupport).toBe('yes')
  })
})
