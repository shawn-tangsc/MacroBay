import { describe, expect, it } from 'vitest'

import {
  buildMonitoringScope,
  createEmptyWatchlistScope,
  EMPTY_EXPOSURE_SNAPSHOT,
  type IntelligenceExposureSnapshot,
  type IntelligenceWatchlistScope
} from './schema/intelligenceRelevanceScope'
import { matchMarketEvent } from './application/symbolExposureMatcher'
import type { NormalizedMarketEvent } from './schema/marketEvent'

function futuresPortfolio(): IntelligenceExposureSnapshot {
  return {
    symbolExposures: [],
    spotBalances: [],
    derivativePositions: [
      {
        symbol: 'BTCUSDT',
        asset: 'BTC'
      }
    ]
  }
}

describe('symbol exposure matcher', () => {
  it('matches active futures symbols before watchlist-only asset matches', () => {
    const scope = buildMonitoringScope(futuresPortfolio(), createEmptyWatchlistScope())
    const event: NormalizedMarketEvent = {
      id: 'event-1',
      sourceId: 'binance-announcements',
      sourceType: 'exchange-announcement',
      title: 'BTC maintenance',
      publishedAt: '2026-07-05T09:00:00.000Z',
      detectedAt: '2026-07-05T09:01:00.000Z',
      category: 'exchange-announcement',
      symbols: ['BTCUSDT'],
      assets: ['BTC'],
      sourceTrust: 'high'
    }

    const match = matchMarketEvent(event, scope, {
      positionAndWatchlistOnly: true,
      criticalMarketEventFallback: true
    })

    expect(match.relevance).toBe('active-futures-position')
    expect(match.matchedSymbols).toContain('BTCUSDT')
  })

  it('matches watchlist-only symbols through base asset conservatively', () => {
    const watchlistScope: IntelligenceWatchlistScope = {
      ...createEmptyWatchlistScope(),
      enabledItems: [
        {
          symbol: 'ETHUSDT',
          venue: 'spot',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
          symbolStatus: 'degraded',
          interestLevel: 'high'
        }
      ],
      assets: ['ETH'],
      spotSymbols: ['ETHUSDT']
    }
    const scope = buildMonitoringScope(EMPTY_EXPOSURE_SNAPSHOT, watchlistScope)

    const match = matchMarketEvent(
      {
        id: 'event-2',
        sourceId: 'news',
        sourceType: 'news',
        title: 'ETH network update',
        publishedAt: '2026-07-05T09:00:00.000Z',
        detectedAt: '2026-07-05T09:01:00.000Z',
        category: 'news',
        symbols: [],
        assets: ['ETH'],
        sourceTrust: 'medium'
      },
      scope,
      { positionAndWatchlistOnly: true, criticalMarketEventFallback: true }
    )

    expect(match.relevance).toBe('watchlist')
    expect(match.matchedAssets).toContain('ETH')
    expect(match.dataQualityCaveat).toContain('degraded')
  })

  it('suppresses unrelated events when positionAndWatchlistOnly is enabled', () => {
    const scope = buildMonitoringScope(EMPTY_EXPOSURE_SNAPSHOT, createEmptyWatchlistScope())
    const match = matchMarketEvent(
      {
        id: 'event-3',
        sourceId: 'news',
        sourceType: 'news',
        title: 'SOL listing rumor',
        publishedAt: '2026-07-05T09:00:00.000Z',
        detectedAt: '2026-07-05T09:01:00.000Z',
        category: 'news',
        symbols: ['SOLUSDT'],
        assets: ['SOL'],
        sourceTrust: 'low'
      },
      scope,
      { positionAndWatchlistOnly: true, criticalMarketEventFallback: false }
    )

    expect(match.relevance).toBe('irrelevant')
  })
})
