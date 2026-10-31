/**
 * The one place model/service failure text is made safe to show.
 *
 * A failure detail can be a stack trace or an error that echoes a credential. It is never rendered
 * raw: cut at the first stack frame, redact key-shaped fragments, then trim to a readable length.
 * Both the failure panel and the generation timeline call this, so two surfaces cannot disagree
 * about what is safe to display.
 */
export const FAILURE_DETAIL_LIMIT = 160

export function readableFailureDetail(
  detail: string | undefined,
  labels: Readonly<Record<string, string>>
): string | undefined {
  if (!detail) return undefined
  const mapped = Object.hasOwn(labels, detail) ? labels[detail] : undefined
  if (mapped) return mapped
  const stackAt = detail.search(/\n\s*at\s/)
  const withoutStack = stackAt >= 0 ? detail.slice(0, stackAt) : detail
  const cleaned = withoutStack
    .replace(/\r?\n/g, ' ')
    .replace(/(?:sk|pk|api|key)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.length > FAILURE_DETAIL_LIMIT ? `${cleaned.slice(0, FAILURE_DETAIL_LIMIT)}…` : cleaned
}
