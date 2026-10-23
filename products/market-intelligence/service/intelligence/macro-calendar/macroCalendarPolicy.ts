export const macroCalendarStoragePolicy = {
  monthQueryMaxEvents: 200,
  monthQueryFixtureRows: 5_000
} as const

/** Owns the bounded, credential-safe transport behavior for fixed official descriptors. */
export const macroCalendarTransportPolicy = {
  requestTimeoutMs: 15_000,
  maxAttempts: 2,
  redirectMode: 'error' as RequestRedirect,
  responseAcceptedMaxBytes: 1_500_000,
  retryableHttpStatuses: [408, 429, 500, 502, 503, 504] as const
} as const

export const macroCalendarHealthHistoryPolicy = {
  providerHealthHistoryMaxEntriesPerProvider: 512,
  providerHealthCheckpointEventKeyLimit: 50,
  providerHealthSafeSummaryMaxChars: 240
} as const

export const macroCalendarProjectionPolicy = {
  invalidAsOfCaveat: 'invalid-visible-timestamp',
  consensusUnavailableCaveat: 'market-consensus-source-not-configured'
} as const

/**
 * What the official calendar can say about market consensus.
 *
 * It has no consensus source of its own, and this used to be a hardcoded `null` in
 * the contract and in three call sites. The missing state is named once here, and a
 * source that does provide consensus (the 0xRouter market calendar) supplies a real
 * value instead, so the expected difference becomes computable.
 */
export const macroCalendarConsensusFallback = Object.freeze({
  consensus: null,
  consensusState: 'unavailable',
  surprise: 'consensus-unavailable'
} as const)

export function isMacroCalendarVisibleAsOf(detectedAt: string, asOf: string): boolean {
  const detectedMs = Date.parse(detectedAt)
  const asOfMs = Date.parse(asOf)
  return Number.isFinite(detectedMs) && Number.isFinite(asOfMs) && detectedMs <= asOfMs
}
