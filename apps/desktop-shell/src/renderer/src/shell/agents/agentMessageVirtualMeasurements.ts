export function updateAgentMessageVirtualHeights(input: {
  currentHeights: Record<string, number>
  validIds: readonly string[]
  nextHeightsById: Record<string, number>
}): Record<string, number> {
  let changed = false
  const next = { ...input.currentHeights }
  const validIds = new Set(input.validIds)

  for (const key of Object.keys(next)) {
    if (validIds.has(key)) continue
    delete next[key]
    changed = true
  }

  for (const [id, height] of Object.entries(input.nextHeightsById)) {
    if (!validIds.has(id)) continue
    if (!Number.isFinite(height) || height <= 0) continue
    if (next[id] === height) continue
    next[id] = height
    changed = true
  }

  return changed ? next : input.currentHeights
}
