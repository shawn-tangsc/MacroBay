export function includesSearchText(value: string | null | undefined, search: string): boolean {
  return value?.toLowerCase().includes(search) ?? false
}

export function normalizeSearch(raw: string | undefined): string {
  return raw?.trim().toLowerCase() ?? ''
}


export function sortTextAsc(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '')
}

export function sortIsoAsc(a: string | null | undefined, b: string | null | undefined): number {
  return Date.parse(a ?? '') - Date.parse(b ?? '')
}
