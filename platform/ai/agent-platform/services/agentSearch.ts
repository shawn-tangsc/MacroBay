export function includesSearchText(value: string | null | undefined, search: string): boolean {
  return value?.toLowerCase().includes(search) ?? false
}

export function normalizeSearch(raw: string | undefined): string {
  return raw?.trim().toLowerCase() ?? ''
}

export function buildSnippet(text: string, query: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const normalized = query.trim().toLowerCase()
  if (!normalized) return trimmed.slice(0, 160)

  const index = trimmed.toLowerCase().indexOf(normalized)
  if (index < 0) return trimmed.slice(0, 160)

  const start = Math.max(0, index - 48)
  const end = Math.min(trimmed.length, index + normalized.length + 88)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < trimmed.length ? '...' : ''
  return `${prefix}${trimmed.slice(start, end)}${suffix}`
}

export function sortTextAsc(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '')
}

export function sortIsoAsc(a: string | null | undefined, b: string | null | undefined): number {
  return Date.parse(a ?? '') - Date.parse(b ?? '')
}
