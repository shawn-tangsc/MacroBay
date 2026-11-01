import type { NewsSentimentSourceReadiness } from '../../../../service/intelligence/schema/newsSentiment'

/** 154 §9 的「3 个采集周期」；周期本身来自源注册表，不在这里写死。 */
export const NEWS_SENTIMENT_REFRESH_CYCLES = 3

/**
 * The age at which what the reader is looking at counts as old.
 *
 * Three collection cycles of the slowest enabled source: a feed served by a 30-minute poller cannot be
 * called old after five minutes, and a feed served by a 15-minute one is not fine at two hours. The
 * interval comes from the same resolver the scheduler uses (`readSourceReadiness`), so changing a
 * source's cadence moves this threshold with it — there is no 90-minute constant anywhere.
 */
export function newsSentimentOutOfDateAfterMs(
  readiness: NewsSentimentSourceReadiness | undefined
): number | undefined {
  const interval = readiness?.maxCollectionIntervalMs
  return typeof interval === 'number' && interval > 0 ? interval * NEWS_SENTIMENT_REFRESH_CYCLES : undefined
}

/**
 * One decision, one field: both the age badge and the `stale` state read `latestKnownItemAt`.
 *
 * They answer different questions with different edges — `stale` compares the newest judgment against
 * the window's start ("this period is empty, but there is older news"), this compares its age against
 * the collection cadence ("the rows you see are old") — but they must never disagree about *when* the
 * newest judgment was, or the card would print two different times for one fact.
 */
export function isNewsSentimentOutOfDate(input: {
  asOf: string
  latestKnownItemAt?: string
  readiness?: NewsSentimentSourceReadiness
}): boolean {
  const after = newsSentimentOutOfDateAfterMs(input.readiness)
  if (!after || !input.latestKnownItemAt) return false
  const ageMs = Date.parse(input.asOf) - Date.parse(input.latestKnownItemAt)
  return Number.isFinite(ageMs) && ageMs > after
}
