import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type BinanceTickerPayload = {
  symbol?: string
  priceChangePercent?: string
  lastPrice?: string
  quoteVolume?: string
  volume?: string
  closeTime?: number
}

export function parseBinanceSpotMarketPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const tickers = Array.isArray(payload) ? payload : [payload as BinanceTickerPayload]
  const drafts: MetricIntelligenceEventDraft[] = []

  for (const ticker of tickers) {
    const symbol = String(ticker.symbol ?? config.adapterConfig.symbol ?? '')
    if (!symbol) continue

    const actual = Number(ticker.priceChangePercent)
    if (!Number.isFinite(actual)) {
      throw new Error(`binance-spot-market: missing priceChangePercent for ${symbol}`)
    }

    const baseAsset = extractBaseAsset(symbol)
    const releaseTime = ticker.closeTime
      ? new Date(ticker.closeTime).toISOString()
      : new Date().toISOString()

    drafts.push({
      sourceId: config.sourceId,
      metricKey: `${symbol}_24H_TICKER`,
      metricName: `${baseAsset} 24h Price Change`,
      metricKind: 'spot-market',
      actual,
      previous: Number(ticker.lastPrice),
      unit: 'percent',
      period: releaseTime.slice(0, 13),
      releaseTime,
      comparisonBasis: 'period-change',
      surpriseDirection: actual > 0 ? 'up' : actual < 0 ? 'down' : 'inline',
      surpriseMagnitude: Math.abs(actual),
      rawValueJson: JSON.stringify({
        quoteVolume: ticker.quoteVolume,
        volume: ticker.volume,
        baseAsset
      })
    })
  }

  if (drafts.length === 0) {
    throw new Error('binance-spot-market: no ticker observations found')
  }

  return drafts
}

export function extractBaseAsset(symbol: string): string {
  const normalized = symbol.toUpperCase()
  for (const quote of ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH']) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return normalized.slice(0, -quote.length)
    }
  }
  return normalized
}
