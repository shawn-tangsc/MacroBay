import type { NewsSentimentSourceReadiness } from '../../../../service/intelligence/schema/newsSentiment'

/**
 * Why the card has no rows to show.
 *
 * Five situations used to read as one sentence ("暂无数据"), which told the reader nothing about what
 * to do: the four sources switched off, a collection that failed, sources that were switched on but
 * never ran, data that exists but is older than the window, and a genuinely quiet period. The first
 * four are "I do not know"; the last one is a fact.
 *
 * Cause before symptom: a switched-off source explains everything else, so it wins; then a failing
 * collection, then a source that never ran, and only then the age of what is stored.
 */
export type NewsSentimentEmptyKind =
  | 'sources-disabled'
  | 'collection-failed'
  | 'never-ran'
  | 'stale'
  | 'quiet'

export type NewsSentimentEmptyState = Readonly<{
  kind: NewsSentimentEmptyKind
  /** Only for `stale`: the newest judgment on record, so the sentence can name the time. */
  lastKnownItemAt?: string
}>

export function resolveNewsSentimentEmptyState(input: {
  state: 'available' | 'empty' | 'unavailable'
  itemCount: number
  windowStart: string
  readiness?: NewsSentimentSourceReadiness
  latestKnownItemAt?: string
}): NewsSentimentEmptyState | undefined {
  // Anything on screen means there is nothing to explain.
  if (input.state !== 'empty' || input.itemCount > 0) return undefined
  const readiness = input.readiness
  if (readiness && readiness.enabledCount === 0) return { kind: 'sources-disabled' }
  // One failing source among four still delivers news; only a total failure explains an empty card.
  if (readiness && readiness.enabledCount > 0 && readiness.failedCount >= readiness.enabledCount) {
    return { kind: 'collection-failed' }
  }
  if (readiness && readiness.enabledCount > 0 && readiness.neverRanCount >= readiness.enabledCount) {
    return { kind: 'never-ran' }
  }
  if (input.latestKnownItemAt && input.latestKnownItemAt < input.windowStart) {
    return { kind: 'stale', lastKnownItemAt: input.latestKnownItemAt }
  }
  return { kind: 'quiet' }
}
