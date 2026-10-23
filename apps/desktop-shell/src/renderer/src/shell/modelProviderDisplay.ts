import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { groupModels, type ModelGroup } from './modelGrouping'

export function groupModelsForDisplay(
  models: readonly ModelDefinition[],
  ungroupedLabel: string,
  pinnedModelIds: readonly string[],
  providerId: string
): ModelGroup[] {
  return groupModels([...models], ungroupedLabel).map((group) => ({
    ...group,
    models: sortModelsForDisplay(group.models, pinnedModelIds, providerId)
  }))
}

function sortModelsForDisplay(
  models: readonly ModelDefinition[],
  pinnedModelIds: readonly string[],
  providerId: string
): ModelDefinition[] {
  const pinnedOrder = new Map(pinnedModelIds.map((modelId, index) => [modelId, index]))
  return [...models].sort((left, right) => {
    const leftPinnedIndex = pinnedOrder.get(`${providerId}:${left.id}`)
    const rightPinnedIndex = pinnedOrder.get(`${providerId}:${right.id}`)
    const leftPinned = leftPinnedIndex !== undefined
    const rightPinned = rightPinnedIndex !== undefined
    if (leftPinned && rightPinned) return leftPinnedIndex - rightPinnedIndex
    if (leftPinned) return -1
    if (rightPinned) return 1
    return 0
  })
}
