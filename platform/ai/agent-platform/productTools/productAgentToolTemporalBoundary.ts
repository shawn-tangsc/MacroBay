import type { ProductAgentToolErrorCode } from './productAgentToolErrors'

export type TemporalBoundaryValidationResult =
  | { ok: true; asOf: string }
  | { ok: false; errorCode: ProductAgentToolErrorCode; message: string }

const timezonePattern = /(?:Z|[+-]\d{2}:\d{2})$/

export function validateTemporalBoundary(
  input: unknown,
  options: { now?: () => Date } = {}
): TemporalBoundaryValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      errorCode: 'missing-temporal-boundary',
      message: 'Temporal-bounded product tool input must include asOf.'
    }
  }

  const asOf = (input as { asOf?: unknown }).asOf
  if (typeof asOf !== 'string' || asOf.trim().length === 0) {
    return {
      ok: false,
      errorCode: 'missing-temporal-boundary',
      message: 'Temporal-bounded product tool input must include asOf.'
    }
  }

  if (!timezonePattern.test(asOf.trim())) {
    return {
      ok: false,
      errorCode: 'invalid-temporal-boundary',
      message: 'asOf must be an ISO-8601 timestamp with explicit timezone.'
    }
  }

  const parsed = new Date(asOf)
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      errorCode: 'invalid-temporal-boundary',
      message: 'asOf must be a valid ISO-8601 timestamp.'
    }
  }

  const now = options.now?.() ?? new Date()
  if (parsed.getTime() > now.getTime()) {
    return {
      ok: false,
      errorCode: 'temporal-boundary-in-future',
      message: 'asOf must not be later than the current platform time.'
    }
  }

  return {
    ok: true,
    asOf: parsed.toISOString()
  }
}
