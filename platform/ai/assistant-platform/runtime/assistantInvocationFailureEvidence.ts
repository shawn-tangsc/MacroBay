export const ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1 = {
  owner: 'assistant-platform-runtime',
  sourceOfTruth: 'provider adapter response status and error body',
  changeAuthority: 'platform-ai-owner',
  failure: 'retain public code and omit unavailable structured evidence',
  testBoundary: 'provider-non-2xx-to-programmatic-invocation',
  maximumTextBytes: 8 * 1024,
  maximumRetainedEntries: 64
} as const

export type AssistantInvocationFailureEvidence = {
  phase: 'request' | 'response'
  summary: string
  providerId?: string
  modelId?: string
  httpStatus?: number
  body?: string
  truncated?: boolean
}

export class AssistantInvocationFailureError extends Error {
  readonly evidence: AssistantInvocationFailureEvidence

  constructor(code: string, evidence: AssistantInvocationFailureEvidence) {
    super(code)
    this.name = 'AssistantInvocationFailureError'
    this.evidence = normalizeAssistantInvocationFailureEvidence(evidence)
  }
}

export function normalizeAssistantInvocationFailureEvidence(
  evidence: AssistantInvocationFailureEvidence
): AssistantInvocationFailureEvidence {
  const body = boundedSafeText(evidence.body)
  const summary = boundedSafeText(evidence.summary)
  return {
    phase: evidence.phase,
    summary: summary.value || 'Assistant provider request failed',
    ...(evidence.providerId ? { providerId: evidence.providerId } : {}),
    ...(evidence.modelId ? { modelId: evidence.modelId } : {}),
    ...(evidence.httpStatus ? { httpStatus: evidence.httpStatus } : {}),
    ...(body.value ? { body: body.value } : {}),
    ...(evidence.truncated || summary.truncated || body.truncated ? { truncated: true } : {})
  }
}

function boundedSafeText(value: string | undefined): { value: string; truncated: boolean } {
  if (!value?.trim()) return { value: '', truncated: false }
  const sanitized = value
    .replace(/\b(authorization|api[-_ ]?key|token|secret|password|cookie)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, (_match, key: string) => `${key}: [redacted]`)
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, (url: string) => url.replace(/[?#][\s\S]*$/, ''))
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/g, '[redacted]')
    .trim()
  const bytes = new TextEncoder().encode(sanitized)
  if (bytes.length <= ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1.maximumTextBytes) return { value: sanitized, truncated: false }
  return {
    value: utf8Prefix(sanitized, ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1.maximumTextBytes),
    truncated: true
  }
}

function utf8Prefix(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder()
  let usedBytes = 0
  let prefix = ''
  for (const character of value) {
    const characterBytes = encoder.encode(character).length
    if (usedBytes + characterBytes > maximumBytes) break
    prefix += character
    usedBytes += characterBytes
  }
  return prefix.trimEnd()
}

export function assistantInvocationFailureEvidence(error: unknown): AssistantInvocationFailureEvidence | undefined {
  return error instanceof AssistantInvocationFailureError ? error.evidence : undefined
}
