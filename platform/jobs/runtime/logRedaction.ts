import type { JobLogEntry } from '../contracts/jobTypes'

const SECRET_KEY_PATTERN = /(api[_-]?key|api[_-]?secret|secret|signature|authorization|listen[_-]?key)/i
const INLINE_SECRET_PATTERN =
  /(apiKey|apiSecret|api_key|api_secret|signature|authorization)=([^\s,&]+)/gi
const REDACTED = '[REDACTED]'

export function redactJobLogEntry(
  entry: Omit<JobLogEntry, 'at'> & { at?: string },
  productRedact?: (value: unknown) => unknown
): JobLogEntry {
  const platformRedacted: JobLogEntry = {
    at: entry.at ?? new Date().toISOString(),
    level: entry.level,
    message: redactSecretsInString(entry.message),
    metadata: entry.metadata ? (redactSecretsInValue(entry.metadata) as Record<string, unknown>) : undefined
  }

  if (!productRedact) return platformRedacted
  const customized = productRedact(platformRedacted)
  if (!customized || typeof customized !== 'object') return platformRedacted
  return {
    ...platformRedacted,
    ...(customized as Partial<JobLogEntry>)
  }
}

export function redactSecretsInValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretsInString(value)
  if (Array.isArray(value)) return value.map(redactSecretsInValue)
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecretsInValue(nested)
  }
  return result
}

function redactSecretsInString(value: string): string {
  return value.replace(INLINE_SECRET_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
}
