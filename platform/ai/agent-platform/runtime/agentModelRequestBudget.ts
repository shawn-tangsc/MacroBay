/**
 * The one contract for "how long may this gateway request take".
 *
 * Two layers know the answer: the caller (an agent runtime) knows how long it is willing to wait,
 * the local gateway only knows how long it may keep an upstream connection open. Previously the
 * gateway used a single 60-second constant as a hard cap for every request, so a caller waiting
 * within its own budget was cut off at 60 seconds and the cut was reported as an upstream failure.
 *
 * The budget now belongs to the caller: it travels in a request header and the gateway times the
 * request against it. The 60-second value stays only as the fallback for a request that declares
 * nothing — it is not a default and not a cap.
 *
 * This module is the single definition, imported by both sides: the gateway
 * (`platform/desktop/main/agentModelGateway`) reads the header, the Claude Code provider environment
 * declares it in `ANTHROPIC_CUSTOM_HEADERS`.
 */
export const AGENT_MODEL_REQUEST_TIMEOUT_HEADER = 'x-agent-model-request-timeout-ms'

/** Used only when a request declares no budget. Not a default, not a cap. */
export const AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS = 60_000

/**
 * The upper bound a caller may declare (15 minutes). It is a safety boundary, not a default: a
 * caller may pick its own budget, but no request may hold a local gateway connection indefinitely.
 */
export const AGENT_MODEL_REQUEST_TIMEOUT_MAX_MS = 15 * 60_000

/**
 * The lower bound a caller may declare (1 second). Anything below it is a unit mistake (seconds
 * written where milliseconds are expected), and honoring it would cut the request before any model
 * could answer, so it is rejected instead of clamped.
 */
export const AGENT_MODEL_REQUEST_TIMEOUT_MIN_MS = 1_000

/**
 * The default budget of one agent turn. A gateway request declares this figure because a single
 * request never outlives the turn that issued it; the turn watchdog is what ends a stuck turn.
 */
export const DEFAULT_AGENT_TURN_TIMEOUT_MS = 120_000

export type DeclaredAgentModelRequestTimeout =
  | { state: 'absent' }
  | { state: 'declared'; timeoutMs: number }
  | { state: 'invalid'; value: string }

/**
 * Reads the declared budget from a request header. `absent` means the caller declared nothing and
 * the gateway falls back; `invalid` means the caller declared something no request may use, which
 * the gateway answers with a 400 rather than silently substituting its own fallback.
 */
export function parseAgentModelRequestTimeoutHeader(
  value: string | string[] | undefined
): DeclaredAgentModelRequestTimeout {
  if (value === undefined) return { state: 'absent' }
  if (Array.isArray(value)) {
    if (value.length !== 1) return { state: 'invalid', value: value.join(', ') }
    const [first] = value
    return parseValue(first)
  }
  return parseValue(value)
}

function parseValue(value: unknown): DeclaredAgentModelRequestTimeout {
  if (typeof value !== 'string') return { state: 'invalid', value: '' }
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return { state: 'invalid', value: trimmed }
  const timeoutMs = Number(trimmed)
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < AGENT_MODEL_REQUEST_TIMEOUT_MIN_MS ||
    timeoutMs > AGENT_MODEL_REQUEST_TIMEOUT_MAX_MS
  ) {
    return { state: 'invalid', value: trimmed }
  }
  return { state: 'declared', timeoutMs }
}

/** The header value the Claude Code provider environment sends for the gateway route. */
export function formatAgentModelRequestTimeoutHeader(timeoutMs: number): string {
  return `${AGENT_MODEL_REQUEST_TIMEOUT_HEADER}: ${timeoutMs}`
}
