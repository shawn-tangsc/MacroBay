import { describe, expect, it } from 'vitest'

import type { ProviderState } from './modelProviderTypes'
import { applyModelSyncPlan } from './providerModelSync'
import { createDefaultProviderState, normalizeProviderState } from './providerStore'
import { createSystemProviderPresets } from './providerPresets'

/**
 * PLAT-72：「清空模型」走既有 `applyModelSync`（`toRemove` = 全部 id），因此这里测的是
 * 一次清空后的**存储语义**：墓碑、默认模型、其它供应商隔离、重启不复活、重新同步能回来。
 */
function state(): ProviderState {
  return createDefaultProviderState()
}

function providerOf(next: ProviderState, id: string) {
  const provider = next.providers.find((item) => item.id === id)
  if (!provider) throw new Error(`missing provider ${id}`)
  return provider
}

/** 模拟一次重启：落 JSON（存储层等价物）再读回并跑一次预设合并。 */
function restart(next: ProviderState): ProviderState {
  return normalizeProviderState(JSON.parse(JSON.stringify({ providers: next.providers })))
}

function clearAll(next: ProviderState, providerId: string): ProviderState {
  return applyModelSyncPlan(next, providerId, {
    toAdd: [],
    toUpdate: [],
    toRemove: providerOf(next, providerId).models.map((model) => model.id)
  })
}

describe('PLAT-72 clear all provider models', () => {
  it('removes every model, clears the default model and tombstones preset ids', () => {
    const before = state()
    const presetIds = providerOf(before, 'silicon').models.map((model) => model.id)
    const after = clearAll(before, 'silicon')
    const silicon = providerOf(after, 'silicon')

    expect(silicon.models).toEqual([])
    expect(silicon.defaultChatModelId).toBeUndefined()
    expect([...(silicon.removedPresetModelIds ?? [])].sort()).toEqual([...presetIds].sort())
  })

  it('leaves every other provider untouched', () => {
    const before = state()
    const otherBefore = JSON.parse(JSON.stringify(providerOf(before, 'deepseek')))
    const after = clearAll(before, 'silicon')

    expect(JSON.parse(JSON.stringify(providerOf(after, 'deepseek')))).toEqual(otherBefore)
  })

  it('does not let the preset merge resurrect the models after a restart', () => {
    const after = clearAll(state(), 'silicon')
    const restarted = providerOf(restart(after), 'silicon')

    expect(restarted.models).toEqual([])
    expect(restarted.defaultChatModelId).toBeUndefined()
  })

  it('removes user/synced models without tombstones (they are not preset models)', () => {
    const withSynced = applyModelSyncPlan(state(), 'silicon', {
      toAdd: [{ id: 'synced-model', name: 'Synced', capabilities: { chat: true } }],
      toUpdate: [],
      toRemove: []
    })
    const after = clearAll(withSynced, 'silicon')
    const silicon = providerOf(after, 'silicon')

    expect(silicon.models).toEqual([])
    expect(silicon.removedPresetModelIds).not.toContain('synced-model')
  })

  it('lets an explicit re-sync bring tombstoned preset models back, and they survive a restart', () => {
    const cleared = clearAll(state(), 'silicon')
    const presetModels = createSystemProviderPresets().find((preset) => preset.id === 'silicon')!.models

    const resynced = applyModelSyncPlan(cleared, 'silicon', {
      toAdd: presetModels,
      toUpdate: [],
      toRemove: []
    })
    const silicon = providerOf(resynced, 'silicon')

    expect(silicon.models.map((model) => model.id).sort()).toEqual(presetModels.map((model) => model.id).sort())
    // 显式加回来 ⇒ 墓碑必须撤销，否则下次合并又会把它们删掉。
    expect(silicon.removedPresetModelIds ?? []).not.toContain(presetModels[0].id)
    expect(providerOf(restart(resynced), 'silicon').models).toHaveLength(presetModels.length)
  })
})
