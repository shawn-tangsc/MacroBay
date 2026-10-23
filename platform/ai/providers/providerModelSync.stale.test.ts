import { describe, expect, it } from 'vitest'

import type { ModelDefinition, ModelProvider, ProviderState } from './modelProviderTypes'
import {
  applyModelSyncPlan,
  buildModelSyncPreview,
  type ModelSyncPlan
} from './providerModelSync'

/**
 * PLAT-63 C：「本地多余（预设已变更）」组。
 * 只有 `presetStale === true` 的旧预设模型进这一组；同步来的模型永不入列；
 * 是否删除完全由用户在预览里勾选决定（`toRemove` 才真正删除）。
 */
function model(id: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id,
    name: id,
    capabilities: { chat: true },
    ...overrides
  }
}

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'acme',
    name: 'Acme',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }
    ],
    enabled: true,
    baseUrl: 'https://api.acme.test',
    apiKey: 'sk-fixture',
    models: [
      model('stale-preset', { presetModel: true, presetStale: true }),
      model('live-preset', { presetModel: true }),
      model('synced-model'),
      model('stale-synced-lookalike', { presetStale: true })
    ],
    ...overrides
  }
}

function remote(ids: string[]): ModelDefinition[] {
  return ids.map((id) => model(id))
}

describe('buildModelSyncPreview local surplus group', () => {
  it('lists presetStale models in the stale group and keeps them out of missing', () => {
    const preview = buildModelSyncPreview(provider(), remote(['live-preset', 'brand-new']))

    // 只有「预设模型 + presetStale」才入列：没有 presetModel 的模型永不进这一组。
    expect(preview.stale.map((item) => item.id)).toEqual(['stale-preset'])
    expect(preview.missing.map((item) => item.model.id)).toEqual([])
    expect(preview.added.map((item) => item.id)).toEqual(['brand-new'])
  })

  it('never lists a synced model (no presetModel) as local surplus', () => {
    const preview = buildModelSyncPreview(
      provider({ models: [model('synced-only'), model('stale-preset', { presetModel: true, presetStale: true })] }),
      remote(['synced-only'])
    )

    expect(preview.stale.map((item) => item.id)).not.toContain('synced-only')
    expect(preview.stale.map((item) => item.id)).toEqual(['stale-preset'])
  })

  it('keeps a preset model missing from the remote list in the missing group (not stale)', () => {
    const preview = buildModelSyncPreview(
      provider({ models: [model('gone-from-remote', { presetModel: true })] }),
      remote(['other'])
    )

    expect(preview.missing.map((item) => item.model.id)).toEqual(['gone-from-remote'])
    expect(preview.stale).toEqual([])
  })
})

describe('applying the stale selection decides whether the model is really deleted', () => {
  const state: ProviderState = { providers: [provider()] }

  function apply(plan: Partial<ModelSyncPlan>): string[] {
    const next = applyModelSyncPlan(state, 'acme', { toAdd: [], toUpdate: [], toRemove: [], ...plan })
    return next.providers.find((entry) => entry.id === 'acme')!.models.map((entry) => entry.id)
  }

  it('keeps the stale model when the user leaves it unchecked', () => {
    const ids = apply({})

    expect(ids).toContain('stale-preset')
    expect(ids).toContain('synced-model')
  })

  it('keeps the archive flag when a stale model is also updated by sync', () => {
    const stale = provider({ models: [model('stale-preset', { presetModel: true, presetStale: true })] })
    const declared = {
      ...model('stale-preset'),
      providerDeclared: true,
      capabilities: { chat: true, tools: true }
    }
    const preview = buildModelSyncPreview(stale, [declared])
    expect(preview.updated.map((entry) => entry.id)).toEqual(['stale-preset'])

    const next = applyModelSyncPlan({ providers: [stale] }, 'acme', {
      toAdd: [],
      toUpdate: preview.updated,
      toRemove: []
    })
    const kept = next.providers[0]!.models.find((entry) => entry.id === 'stale-preset')
    expect(kept?.presetStale).toBe(true)
    expect(kept?.presetModel).toBe(true)
  })

  it('deletes it only when the id is in toRemove', () => {
    const ids = apply({ toRemove: ['stale-preset'] })

    expect(ids).not.toContain('stale-preset')
    expect(ids).toContain('synced-model')
    expect(ids).toContain('live-preset')
  })
})
