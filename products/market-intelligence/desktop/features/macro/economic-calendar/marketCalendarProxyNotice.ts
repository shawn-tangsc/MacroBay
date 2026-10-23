import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'

/**
 * The one verdict the calendar transport emits when a source did not answer.
 *
 * Status, mime, size, envelope and timeout refusals all collapse into `response-unavailable` before
 * they reach the page, so it is the calendar's only network-layer signal. Storage and parse
 * refusals keep their own names and must not be read as "the network is down".
 */
export const marketCalendarNetworkFailureCode = 'response-unavailable' as const

/**
 * True only when *every* feed failed the same way at its most recent attempt.
 *
 * One endpoint failing on its own is that endpoint's problem — a large month payload, a bad
 * envelope, a provider hiccup — and pointing the reader at the proxy would be a guess. All three
 * feeds share one host and one proxy, so when all of them answer nothing, the path is what broke.
 *
 * Nothing here is stored: the notice exists only while the latest attempts say so, and the next
 * successful refresh replaces them, which clears it.
 */
export function shouldShowMarketCalendarProxyNotice(sources: readonly MarketCalendarSource[]): boolean {
  return sources.length > 0 && sources.every((source) => source.latestAttempt?.state === 'failed'
    && source.latestAttempt.failureCode === marketCalendarNetworkFailureCode)
}
