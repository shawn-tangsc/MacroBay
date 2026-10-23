/**
 * Converts the stored environment representation into the `KEY=value` text used
 * by the agent editor. Stored configurations may hold either a string map or a
 * legacy array of `{ key, value }` rows.
 */
export function environmentToText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((row) => {
        if (typeof row !== 'object' || row === null) {
          return ''
        }
        const key = readString((row as { key?: unknown }).key)
        return key ? `${key}=${readString((row as { value?: unknown }).value)}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => `${key}=${readString(value)}`)
      .join('\n')
  }

  return ''
}

/**
 * Parses editor text into a string map. A line without `=` becomes a key with
 * an empty value; empty keys are dropped.
 */
export function environmentFromText(text: string): Record<string, string> {
  const entries: Array<[string, string]> = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const separator = line.indexOf('=')
    const key = separator === -1 ? line : line.slice(0, separator).trim()
    if (!key) {
      continue
    }

    entries.push([key, separator === -1 ? '' : line.slice(separator + 1)])
  }

  return Object.fromEntries(entries)
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

export function readArray(value: readonly string[] | undefined): string[] {
  return [...(value ?? [])]
}
