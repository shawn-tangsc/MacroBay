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
  /** 2026-11-18：窗口里有新闻，但一条判定都没有（规则没命中就不写判定）。说「安静」是假话。 */
  | 'unjudged'
  | 'stale'
  | 'quiet'

export type NewsSentimentEmptyState = Readonly<{
  kind: NewsSentimentEmptyKind
  /** Only for `stale`: the newest judgment on record, so the sentence can name the time. */
  lastKnownItemAt?: string
  /** Only for `unjudged`: why nothing could be judged, when we actually know. */
  cause?: 'model-off' | 'model-unavailable'
}>

export function resolveNewsSentimentEmptyState(input: {
  state: 'available' | 'empty' | 'unavailable'
  itemCount: number
  windowStart: string
  readiness?: NewsSentimentSourceReadiness
  latestKnownItemAt?: string
  /** 窗口内有新闻、但一条判定都没有的条数（来自查询；0/缺省表示没有这种情形）。 */
  unjudgedInWindow?: number
  unjudgedCause?: 'model-off' | 'model-unavailable'
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
  // 「有新闻、但都还没判」排在「旧」之前：它说的是**这个窗口里有东西**，只是没判出来；
  // 说成「旧的已经过窗口」会把读者引到「往前翻」——翻也翻不到判定。
  if ((input.unjudgedInWindow ?? 0) > 0) {
    return { kind: 'unjudged', ...(input.unjudgedCause ? { cause: input.unjudgedCause } : {}) }
  }
  if (input.latestKnownItemAt && input.latestKnownItemAt < input.windowStart) {
    return { kind: 'stale', lastKnownItemAt: input.latestKnownItemAt }
  }
  return { kind: 'quiet' }
}
