import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import type { ModelSyncPreview } from '@platform/ai/providers/providerModelSync'

import {
  buildModelSyncPlan,
  createModelSyncSelection,
  toggleAllModelSyncSelection,
  toggleModelSyncSelection
} from './modelSyncPlan'

/**
 * PLAT-63 C：预览选择 → 应用计划（纯逻辑）。
 * 「本地多余（预设已变更）」默认勾选；取消勾选 ⇒ 不进 toRemove ⇒ 模型保留。
 */
function model(id: string): ModelDefinition {
  return { id, name: id, capabilities: { chat: true } }
}

const preview: ModelSyncPreview = {
  added: [model('remote-new')],
  updated: [model('remote-updated')],
  missing: [{ model: model('missing-preset'), removalReason: 'missing_from_provider' }],
  stale: [model('stale-preset'), model('stale-preset-2')]
}

describe('createModelSyncSelection', () => {
  it('selects every group by default, including the local surplus group', () => {
    const selection = createModelSyncSelection(preview)

    expect([...selection.addedIds]).toEqual(['remote-new'])
    expect([...selection.missingIds]).toEqual(['missing-preset'])
    expect([...selection.staleIds]).toEqual(['stale-preset', 'stale-preset-2'])
  })
})

describe('buildModelSyncPlan', () => {
  it('maps selected added/updated/missing/stale entries into the apply plan', () => {
    const plan = buildModelSyncPlan(preview, createModelSyncSelection(preview))

    expect(plan.toAdd.map((entry) => entry.id)).toEqual(['remote-new'])
    expect(plan.toUpdate.map((entry) => entry.id)).toEqual(['remote-updated'])
    expect(plan.toRemove.sort()).toEqual(['missing-preset', 'stale-preset', 'stale-preset-2'])
  })

  it('keeps a stale model when the user unchecks it', () => {
    const selection = toggleModelSyncSelection(createModelSyncSelection(preview), 'stale', 'stale-preset')
    const plan = buildModelSyncPlan(preview, selection)

    expect(plan.toRemove).not.toContain('stale-preset')
    expect(plan.toRemove).toContain('stale-preset-2')
  })

  it('drops every stale removal when the whole group is unchecked', () => {
    const selection = toggleAllModelSyncSelection(createModelSyncSelection(preview), 'stale', preview)
    const plan = buildModelSyncPlan(preview, selection)

    expect(selection.staleIds.size).toBe(0)
    expect(plan.toRemove).toEqual(['missing-preset'])
  })

  it('re-checks the whole group when it was fully unchecked', () => {
    const empty = toggleAllModelSyncSelection(createModelSyncSelection(preview), 'stale', preview)
    const restored = toggleAllModelSyncSelection(empty, 'stale', preview)

    expect([...restored.staleIds]).toEqual(['stale-preset', 'stale-preset-2'])
  })
})
