import { NEWS_SENTIMENT_SOURCE_IDS, type NewsSentimentSourceReadiness } from '../schema/newsSentiment'

/**
 * One row per source as the public coverage projection already spells it.
 *
 * `productionState` is the answer to "what is this source doing" — fresh, stale, pending, failed,
 * disabled, and a few not applicable here — and it is computed in exactly one place. This file only
 * counts, so the card and the drawer cannot disagree about which of the three "nothing to show"
 * causes the reader is looking at.
 */
export type NewsSentimentCoverageRow = Readonly<{
  sourceId: string
  productionState: string
  latestSuccessAt?: string
}>

export function summarizeNewsSentimentReadiness(
  coverage: readonly NewsSentimentCoverageRow[]
): NewsSentimentSourceReadiness {
  const byId = new Map(coverage.map((row) => [row.sourceId, row]))
  const rows = NEWS_SENTIMENT_SOURCE_IDS.map((sourceId) => byId.get(sourceId)).filter(
    (row): row is NewsSentimentCoverageRow => row !== undefined
  )
  const enabled = rows.filter((row) => row.productionState !== 'disabled')
  const failed = enabled.filter((row) => row.productionState === 'failed')
  const neverRan = enabled.filter(
    (row) => row.productionState === 'pending' && !row.latestSuccessAt
  )
  const lastSuccessAt = enabled
    .map((row) => row.latestSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  return {
    total: NEWS_SENTIMENT_SOURCE_IDS.length,
    enabledCount: enabled.length,
    failedCount: failed.length,
    neverRanCount: neverRan.length,
    failedSourceIds: failed.map((row) => row.sourceId),
    neverRanSourceIds: neverRan.map((row) => row.sourceId),
    ...(lastSuccessAt ? { lastSuccessAt } : {})
  }
}
