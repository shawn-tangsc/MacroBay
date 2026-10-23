import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'
import { extractBaseAsset } from './binanceSpotMarketParser'

type FundingRateEntry = {
  symbol?: string
  fundingRate?: string
  fundingTime?: number
}

type OpenInterestEntry = {
  symbol?: string
  openInterest?: string
  time?: number
}

export function parseBinanceFundingRatePayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const entries = Array.isArray(payload) ? payload : [payload as FundingRateEntry]
  const drafts: MetricIntelligenceEventDraft[] = []

  for (const entry of entries) {
    const symbol = String(entry?.symbol ?? config.adapterConfig.symbol ?? '')
    const actual = Number(entry?.fundingRate)
    if (!symbol || !Number.isFinite(actual)) continue

    const releaseTime = entry?.fundingTime
      ? new Date(entry.fundingTime).toISOString()
      : new Date().toISOString()

    drafts.push({
      sourceId: config.sourceId,
      metricKey: `${symbol}_FUNDING_RATE`,
      metricName: `${extractBaseAsset(symbol)} Funding Rate`,
      metricKind: 'funding-rate',
      actual: actual * 100,
      unit: 'percent',
      period: releaseTime.slice(0, 13),
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: actual > 0.0005 ? 'above' : actual < -0.0002 ? 'below' : 'inline',
      surpriseMagnitude: Math.abs(actual * 100),
      rawValueJson: JSON.stringify({ symbol })
    })
  }

  if (drafts.length === 0) {
    throw new Error('binance-futures-positioning: missing funding rate')
  }

  return drafts
}

export function parseBinanceOpenInterestPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const entry = payload as OpenInterestEntry
  const symbol = String(entry.symbol ?? config.adapterConfig.symbol ?? '')
  const actual = Number(entry.openInterest)
  if (!symbol || !Number.isFinite(actual)) {
    throw new Error('binance-futures-positioning: missing open interest')
  }

  const releaseTime = entry.time ? new Date(entry.time).toISOString() : new Date().toISOString()

  return [
    {
      sourceId: config.sourceId,
      metricKey: `${symbol}_OPEN_INTEREST`,
      metricName: `${extractBaseAsset(symbol)} Open Interest`,
      metricKind: 'open-interest',
      actual,
      unit: 'contracts',
      period: releaseTime.slice(0, 13),
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: 'unknown',
      rawValueJson: JSON.stringify({ symbol })
    }
  ]
}
