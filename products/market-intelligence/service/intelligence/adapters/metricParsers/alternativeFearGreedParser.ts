import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type FearGreedPayload = {
  name?: string
  data?: Array<{
    value?: string
    value_classification?: string
    timestamp?: string
  }>
}

/**
 * One draft per day the payload carries, newest first.
 *
 * The endpoint accepts `?limit=N` and answers N days; the old parser read only `data[0]`, so a
 * backfill could never fill a gap and a day the app was offline stayed missing forever. Every day
 * now becomes its own draft: `period` is the source's own UTC day (identity/dedupe), `releaseTime`
 * is kept as given.
 *
 * A day without a usable value or a parseable UNIX-seconds timestamp is **skipped**, never stamped
 * with `now()`: a missing timestamp is not "today". A payload with no usable day throws, which is
 * the one case where the adapter reports the source as unreadable rather than empty.
 */
export function parseAlternativeFearGreedPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as FearGreedPayload
  const drafts: MetricIntelligenceEventDraft[] = []

  for (const entry of body.data ?? []) {
    const actual = Number(entry?.value)
    const seconds = Number(entry?.timestamp)
    if (!Number.isFinite(actual) || !Number.isFinite(seconds) || seconds <= 0) continue

    const releaseTime = new Date(seconds * 1000).toISOString()
    if (!Number.isFinite(Date.parse(releaseTime))) continue

    drafts.push({
      sourceId: config.sourceId,
      metricKey: 'FEAR_GREED_INDEX',
      metricName: 'Crypto Fear & Greed Index',
      metricKind: 'fear-greed',
      actual,
      unit: 'index',
      period: releaseTime.slice(0, 10),
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: actual >= 75 ? 'above' : actual <= 25 ? 'below' : 'inline',
      rawValueJson: JSON.stringify({ classification: entry?.value_classification })
    })
  }

  if (drafts.length === 0) {
    throw new Error('alternative-fear-greed: missing numeric fear-greed value')
  }

  // Newest first: `parseRawRecord` treats `metricEvents[0]` as the day that represents this pull.
  return drafts.sort((left, right) => Date.parse(right.releaseTime) - Date.parse(left.releaseTime))
}