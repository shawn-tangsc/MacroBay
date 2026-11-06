import type { StructuredModelInvocationErrorCode } from '@platform/ai/invocation/structuredModelInvocationTypes'

/**
 * Why a provider call failed, at the level a reader can act on.
 *
 * The coarse code `analysis-provider-error` covered four different faults: the gateway cutting a
 * call at its fallback budget, the provider answering with a rate limit, the connection never
 * being established, and the provider returning an error of its own. A timeline row, a run-log
 * line and (later) a notification that all say "it failed" tell the reader nothing they can do.
 *
 * What this module can see is deliberately narrow: the invocation's own error code and how long
 * the attempt took. Nothing below the invocation layer reaches it — the HTTP status that would
 * separate "no answer at all" from "an answer that was an error" is dropped by the platform
 * invocation contract today. The two duration rules below are therefore evidence, not certainty,
 * and each records what it assumes; when the platform starts carrying the status, only this table
 * changes.
 */
export const analysisFailureDetailPolicy = Object.freeze({
  version: 'marketAnalysisFailureDetail.v1',
  /**
   * The gateway's undeclared-budget fallback is 60 s (raised to the caller's declared budget once
   * that budget is propagated). The observed cut lands at 59–61 s; five seconds of margin keeps a
   * slow-but-honest attempt that failed at 50 s out of it.
   */
  upstreamAbortMinMs: 55_000,
  /**
   * Below this an attempt never got a usable answer: the connection, the DNS lookup or the TLS
   * handshake failed, or the upstream refused the request outright. It cannot tell those apart;
   * that is the limitation the module documents rather than hides.
   */
  connectFailureMaxMs: 5_000
})

export const analysisFailureDetailCodes = Object.freeze([
  'upstream-aborted',
  'http-429',
  'connect-failed',
  'gateway-timeout',
  'provider-other'
] as const)

export type AnalysisFailureDetailCode = (typeof analysisFailureDetailCodes)[number]

/** True when the detail code carries provider facts; used for the notification's reason sentence. */
export function isAnalysisFailureDetailCode(value: string): value is AnalysisFailureDetailCode {
  return (analysisFailureDetailCodes as readonly string[]).includes(value)
}

/**
 * Maps one failed invocation onto a detail code.
 *
 * `provider-other` is the floor, never `null`: a failure with no readable cause is still recorded
 * as "a provider error we could not classify", because a blank detail is what let every failure
 * look the same.
 */
export function classifyProviderFailureDetail(input: Readonly<{
  errorCode: StructuredModelInvocationErrorCode | string
  durationMs?: number | null
}>): AnalysisFailureDetailCode {
  if (input.errorCode === 'rate-limited') return 'http-429'
  // The invocation's own timer fired: the call was given a budget and used all of it.
  if (input.errorCode === 'timeout') return 'gateway-timeout'
  if (input.errorCode !== 'provider-error') return 'provider-other'
  const durationMs = input.durationMs
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return 'provider-other'
  if (durationMs >= analysisFailureDetailPolicy.upstreamAbortMinMs) return 'upstream-aborted'
  if (durationMs <= analysisFailureDetailPolicy.connectFailureMaxMs) return 'connect-failed'
  return 'provider-other'
}

/**
 * The detail to store for a failed run.
 *
 * Runs that already have a finer cause of their own keep it: an output rejection records the
 * validation rule, a not-ready provider records its own code. Only the provider line gets the
 * detail codes above — never a blank, and never the coarse code copied into the detail column.
 */
export function resolveAnalysisRunFailureDetail(input: Readonly<{
  failureCode: string
  providerFailure?: Readonly<{ errorCode: string; durationMs?: number | null }>
}>): string {
  if (input.failureCode !== 'analysis-provider-error' && input.failureCode !== 'analysis-timeout') return input.failureCode
  if (!input.providerFailure) return 'provider-other'
  return classifyProviderFailureDetail(input.providerFailure)
}
