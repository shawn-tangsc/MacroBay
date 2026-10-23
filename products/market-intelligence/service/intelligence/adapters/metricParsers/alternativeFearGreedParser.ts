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

export function parseAlternativeFearGreedPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as FearGreedPayload
  const latest = body.data?.[0]
  const actual = Number(latest?.value)
  if (!Number.isFinite(actual)) {
    throw new Error('alternative-fear-greed: missing numeric fear-greed value')
  }

  const releaseTime = latest?.timestamp
    ? new Date(Number(latest.timestamp) * 1000).toISOString()
    : new Date().toISOString()
  const period = releaseTime.slice(0, 10)

  return [
    {
      sourceId: config.sourceId,
      metricKey: 'FEAR_GREED_INDEX',
      metricName: 'Crypto Fear & Greed Index',
      metricKind: 'fear-greed',
      actual,
      unit: 'index',
      period,
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: actual >= 75 ? 'above' : actual <= 25 ? 'below' : 'inline',
      rawValueJson: JSON.stringify({ classification: latest?.value_classification })
    }
  ]
}
