import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

export type ModelGroup = {
  name: string
  models: ModelDefinition[]
}

function normalizeGroupName(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized || normalized.toLowerCase() === 'undefined') return undefined
  return normalized
}

function inferGroupFromModelId(modelId: string): string | undefined {
  const normalizedId = modelId.trim().replace(/^\/+/, '')
  const segments = normalizedId.split('/').filter(Boolean)
  if (segments.length < 2) return undefined
  if (segments[0] === 'maas' && segments[1]) return segments[1]
  if (segments[0] === 'accounts' && segments[2] === 'models' && segments[3]) return segments[3].split('-')[0]
  return segments[0]
}

export function resolveModelGroupName(model: ModelDefinition, ungroupedLabel: string): string {
  return normalizeGroupName(model.group) ?? inferGroupFromModelId(model.id) ?? ungroupedLabel
}

export function groupModels(models: ModelDefinition[], ungroupedLabel: string): ModelGroup[] {
  const groups = new Map<string, ModelDefinition[]>()

  for (const model of models) {
    const groupName = resolveModelGroupName(model, ungroupedLabel)
    const group = groups.get(groupName)
    if (group) group.push(model)
    else groups.set(groupName, [model])
  }

  return Array.from(groups, ([name, groupModels]) => ({
    name,
    models: groupModels
  }))
}
