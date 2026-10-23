import type { MetricIntelligenceEventDraft, MetricSurpriseDirection } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

export const COINGECKO_GLOBAL_METRIC_VERSION = 'coingecko-global-v1'

/** A publish time outside this window is a broken field: the whole observation is refused. */
const EARLIEST_ADMITTED_EPOCH_MS = Date.UTC(2009, 0, 1)
const LATEST_ADMITTED_EPOCH_MS = Date.UTC(2100, 0, 1)

type CoingeckoGlobalPayload = {
  data?: {
    updated_at?: unknown
    total_market_cap?: { usd?: unknown }
    market_cap_change_percentage_24h_usd?: unknown
    market_cap_percentage?: { btc?: unknown }
  }
}

/**
 * Reads CoinGecko's public `/api/v3/global` snapshot. This is an aggregator reading of a *level*: the
 * provider publishes no previous value for the cap or the dominance, so nothing is derived to invent
 * one. Metrics whose own field is missing are dropped; a payload where none survive, or whose own
 * `updated_at` cannot be dated, throws so a changed response shape reaches source health.
 */
export function parseCoingeckoGlobalPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as CoingeckoGlobalPayload
  const data = body?.data
  if (!data || typeof data !== 'object') {
    throw new Error('coingecko-market: response carried no data object')
  }
  const releaseTime = normalizeCoingeckoUpdatedAt(data.updated_at)
  if (!releaseTime) {
    throw new Error('coingecko-market: missing or invalid updated_at')
  }
  const period = releaseTime.slice(0, 10)

  const drafts: MetricIntelligenceEventDraft[] = []
  const totalMarketCap = readNumeric(data.total_market_cap?.usd)
  if (totalMarketCap !== undefined) {
    drafts.push({
      sourceId: config.sourceId,
      metricKey: 'CRYPTO_TOTAL_MARKET_CAP',
      metricName: 'Crypto Total Market Cap',
      metricKind: 'market-cap',
      actual: totalMarketCap,
      unit: 'usd',
      period,
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: 'unknown',
      rawValueJson: JSON.stringify({ field: 'total_market_cap.usd', aggregator: true })
    })
  }

  const change24h = readNumeric(data.market_cap_change_percentage_24h_usd)
  if (change24h !== undefined) {
    drafts.push({
      sourceId: config.sourceId,
      metricKey: 'CRYPTO_MARKET_CAP_CHANGE_24H',
      metricName: 'Crypto Market Cap Change (24h)',
      metricKind: 'market-cap',
      actual: change24h,
      unit: 'percent',
      period,
      releaseTime,
      // The provider states the 24h change itself; no previous level is derived from it.
      comparisonBasis: 'level',
      surpriseDirection: directionOf(change24h),
      rawValueJson: JSON.stringify({ field: 'market_cap_change_percentage_24h_usd', aggregator: true })
    })
  }

  const btcDominance = readNumeric(data.market_cap_percentage?.btc)
  if (btcDominance !== undefined) {
    drafts.push({
      sourceId: config.sourceId,
      metricKey: 'CRYPTO_BTC_DOMINANCE',
      metricName: 'BTC Dominance',
      metricKind: 'market-cap',
      actual: btcDominance,
      unit: 'percent',
      period,
      releaseTime,
      comparisonBasis: 'level',
      surpriseDirection: 'unknown',
      rawValueJson: JSON.stringify({ field: 'market_cap_percentage.btc', aggregator: true })
    })
  }

  if (!drafts.length) {
    throw new Error('coingecko-market: no usable metric fields in payload')
  }
  return drafts
}

/** CoinGecko's `updated_at` is epoch seconds. */
export function normalizeCoingeckoUpdatedAt(value: unknown): string | undefined {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  const epochMs = numeric < 1e11 ? Math.round(numeric * 1000) : Math.round(numeric)
  if (epochMs < EARLIEST_ADMITTED_EPOCH_MS || epochMs > LATEST_ADMITTED_EPOCH_MS) return undefined
  const releaseTime = new Date(epochMs)
  return Number.isNaN(releaseTime.getTime()) ? undefined : releaseTime.toISOString()
}

function readNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return undefined
}

function directionOf(value: number): MetricSurpriseDirection {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'inline'
}
