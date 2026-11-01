import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

/**
 * The current target range from the series FRED already publishes.
 *
 * The statement-derived fact only exists once a decision has been parsed; between meetings the
 * published series is the one source that is always current, and it is what the block should fall
 * back to rather than showing an empty range.
 */
export const publishedTargetRangeSeries = {
  upper: 'DFEDTARU',
  lower: 'DFEDTARL',
  metricKeys: { upper: 'FED_TARGET_RANGE_UPPER', lower: 'FED_TARGET_RANGE_LOWER' }
} as const

export function readPublishedTargetRange(
  events: readonly MetricIntelligenceEvent[]
): Readonly<{ lowerPercent: number; upperPercent: number }> | undefined {
  const newest = (seriesId: string, metricKey: string) => events
    .filter((event) => event.sourceId === 'fred-rates-liquidity' && (event.metricKey === metricKey || event.metricKey === seriesId))
    .filter((event) => Number.isFinite(event.actual))
    .sort((left, right) => right.releaseTime.localeCompare(left.releaseTime))[0]
  const upper = newest(publishedTargetRangeSeries.upper, publishedTargetRangeSeries.metricKeys.upper)
  const lower = newest(publishedTargetRangeSeries.lower, publishedTargetRangeSeries.metricKeys.lower)
  if (!upper || !lower || lower.actual >= upper.actual) return undefined
  return { lowerPercent: lower.actual, upperPercent: upper.actual }
}
