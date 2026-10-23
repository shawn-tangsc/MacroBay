import type { AgentText } from './agentText'

/** One-line, bounded rendering of an arbitrary runtime payload for the activity trace. */
export function summarizeRuntimeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return truncateRuntimeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return truncateRuntimeText(JSON.stringify(value))
  } catch {
    return '[Unserializable runtime value]'
  }
}

/** Pretty request payload for the row's input fold; null when the call carried nothing. */
export function stringifyToolRequest(input: unknown): string | null {
  if (input === null || input === undefined) return null
  try {
    const serialized = JSON.stringify(input, null, 2)
    if (!serialized || serialized === '{}') return null
    return serialized.length <= 4000 ? serialized : `${serialized.slice(0, 4000)}...`
  } catch {
    return null
  }
}

/** SDK control subtypes are slugs; only the ones the trace can explain get a human label. */
export function resolveRuntimeControlTitle(subtype: string, text: AgentText['runtimeActivity']): string {
  const labels = text.runtimeControlLabels
  return Object.prototype.hasOwnProperty.call(labels, subtype) ? labels[subtype]! : subtype
}

export function compactJoin(values: Array<string | null | undefined>, separator: string): string | null {
  return values.filter((value): value is string => Boolean(value)).join(separator) || null
}

function truncateRuntimeText(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 500) return normalized
  return `${normalized.slice(0, 500)}...`
}
