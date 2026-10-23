export const PINNED_MODEL_IDS_STORAGE_KEY = 'pinned:models'

export function parsePinnedModelIds(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

export function serializePinnedModelIds(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)])
}

export function togglePinnedModelId(current: readonly string[], modelId: string): string[] {
  return current.includes(modelId) ? current.filter((item) => item !== modelId) : [...current, modelId]
}
