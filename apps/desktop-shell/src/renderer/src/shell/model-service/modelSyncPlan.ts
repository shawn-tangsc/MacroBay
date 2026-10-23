import type { ModelSyncPlan, ModelSyncPreview } from '@platform/ai/providers/providerModelSync'

/**
 * PLAT-63 C：同步预览的三组选择（远端新增 / 本地缺失于远端 / 本地多余-预设已变更）。
 * 纯逻辑：抽屉只负责渲染与回调，这里负责「默认全选」和「选择 → 应用计划」的映射，
 * 保证只有用户勾选的 id 才会进 `toRemove`（取消勾选 ⇒ 模型保留）。
 */
export type ProviderModelSyncSelection = {
  addedIds: Set<string>
  missingIds: Set<string>
  staleIds: Set<string>
}

export type ModelSyncSelectionGroup = 'added' | 'missing' | 'stale'

const idsKeyByGroup = {
  added: 'addedIds',
  missing: 'missingIds',
  stale: 'staleIds'
} as const

/** 预览打开时的默认选择：三组全选（含「本地多余」，应用即清理，但用户可取消）。 */
export function createModelSyncSelection(preview: ModelSyncPreview): ProviderModelSyncSelection {
  return {
    addedIds: new Set(preview.added.map((model) => model.id)),
    missingIds: new Set(preview.missing.map((item) => item.model.id)),
    staleIds: new Set((preview.stale ?? []).map((model) => model.id))
  }
}

export function buildModelSyncPlan(
  preview: ModelSyncPreview,
  selection: ProviderModelSyncSelection
): ModelSyncPlan {
  return {
    toAdd: preview.added.filter((model) => selection.addedIds.has(model.id)),
    toUpdate: preview.updated,
    toRemove: [
      ...preview.missing
        .filter((item) => selection.missingIds.has(item.model.id))
        .map((item) => item.model.id),
      ...(preview.stale ?? []).filter((model) => selection.staleIds.has(model.id)).map((model) => model.id)
    ]
  }
}

export function toggleModelSyncSelection(
  selection: ProviderModelSyncSelection,
  group: ModelSyncSelectionGroup,
  modelId: string
): ProviderModelSyncSelection {
  const key = idsKeyByGroup[group]
  const ids = new Set(selection[key])
  if (ids.has(modelId)) ids.delete(modelId)
  else ids.add(modelId)
  return { ...selection, [key]: ids }
}

export function toggleAllModelSyncSelection(
  selection: ProviderModelSyncSelection,
  group: ModelSyncSelectionGroup,
  preview: ModelSyncPreview
): ProviderModelSyncSelection {
  const key = idsKeyByGroup[group]
  const visibleIds = groupIds(preview, group)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection[key].has(id))
  return { ...selection, [key]: allSelected ? new Set<string>() : new Set(visibleIds) }
}

export function groupIds(preview: ModelSyncPreview, group: ModelSyncSelectionGroup): string[] {
  if (group === 'added') return preview.added.map((model) => model.id)
  if (group === 'missing') return preview.missing.map((item) => item.model.id)
  return (preview.stale ?? []).map((model) => model.id)
}

export function countModelSyncSelection(selection: ProviderModelSyncSelection): number {
  return selection.addedIds.size + selection.missingIds.size + selection.staleIds.size
}

export function clearModelSyncSelection(): ProviderModelSyncSelection {
  return { addedIds: new Set(), missingIds: new Set(), staleIds: new Set() }
}
