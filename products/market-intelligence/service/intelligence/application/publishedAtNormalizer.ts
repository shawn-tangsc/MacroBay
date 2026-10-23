export function stripCdata(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i)
  return match?.[1]?.trim() ?? trimmed
}

export function stripHtmlFragments(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizePublishedAt(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined

  const cleaned = stripHtmlFragments(stripCdata(raw.trim()))
  if (!cleaned) return undefined

  const parsedMs = Date.parse(cleaned)
  if (!Number.isFinite(parsedMs)) return undefined

  return new Date(parsedMs).toISOString()
}

export function normalizePublishedAtFields(raw?: string): {
  publishedAtRaw?: string
  publishedAt?: string
} {
  if (!raw?.trim()) return {}
  const publishedAt = normalizePublishedAt(raw)
  return {
    publishedAtRaw: raw.trim(),
    publishedAt
  }
}
