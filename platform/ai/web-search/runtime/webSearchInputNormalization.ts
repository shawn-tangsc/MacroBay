export function normalizeWebSearchKeywords(values: unknown, maxCount = 5): string[] {
  if (!Array.isArray(values)) return []
  return normalizeStringInputs(values, maxCount)
}

export function normalizeWebSearchUrls(values: unknown, maxCount = 10): string[] {
  if (!Array.isArray(values)) return []
  return normalizeStringInputs(values, maxCount)
}

function normalizeStringInputs(values: unknown[], maxCount: number): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
    if (normalized.length >= maxCount) break
  }

  return normalized
}
