import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type ChainTvlEntry = {
  name?: string
  tvl?: number
}

export function parseDefillamaTvlPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as ChainTvlEntry[] | { chains?: ChainTvlEntry[]; previousTotal?: number }
  const chains = Array.isArray(body) ? body : (body.chains ?? [])
  const total = chains.reduce((sum, entry) => sum + (entry.tvl ?? 0), 0)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('defillama-tvl: missing TVL total')
  }

  const previous = Array.isArray(body) ? undefined : body.previousTotal
  const releaseTime = new Date().toISOString()
  return [
    {
      sourceId: config.sourceId,
      metricKey: 'CHAIN_TVL_TOTAL',
      metricName: 'Chain TVL Total',
      metricKind: 'defi-tvl',
      actual: total,
      previous,
      unit: 'usd',
      period: releaseTime.slice(0, 10),
      releaseTime,
      comparisonBasis: previous !== undefined ? 'actual-vs-previous' : 'level',
      surpriseDirection:
        previous === undefined ? 'unknown' : total > previous ? 'up' : total < previous ? 'down' : 'unknown',
      rawValueJson: JSON.stringify({ chainCount: chains.length })
    }
  ]
}
