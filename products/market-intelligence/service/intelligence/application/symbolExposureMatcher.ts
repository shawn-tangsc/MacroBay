import type { EventMatch, EventRelevanceKind, NormalizedMarketEvent } from '../schema/marketEvent'
import type { IntelligenceWatchlistSymbolProjection, MonitoringScope } from '../schema/intelligenceRelevanceScope'

export type EventMatchPolicy = {
  positionAndWatchlistOnly: boolean
  criticalMarketEventFallback: boolean
}

export function matchMarketEvent(event: NormalizedMarketEvent, scope: MonitoringScope, policy: EventMatchPolicy): EventMatch {
  if (event.marketWideCritical && policy.criticalMarketEventFallback) {
    return {
      eventId: event.id,
      relevance: 'market-wide-critical',
      matchedSymbols: [],
      matchedAssets: [],
      matchReasons: ['market-wide-critical-event']
    }
  }

  const futuresMatches = matchSymbols(event, scope.activeFuturesSymbols)
  const spotMatches = matchAssets(event, scope.activeSpotAssets)
  const watchlistMatch = matchWatchlist(event, scope.watchlistItems)

  const hasFutures = futuresMatches.symbols.length > 0
  const hasSpot = spotMatches.assets.length > 0
  const hasWatchlist = watchlistMatch.symbols.length > 0 || watchlistMatch.assets.length > 0

  if (hasFutures && hasWatchlist) {
    return buildMatch(event, 'position-and-watchlist', {
      symbols: unique([...futuresMatches.symbols, ...watchlistMatch.symbols]),
      assets: unique([...spotMatches.assets, ...watchlistMatch.assets]),
      reasons: [...futuresMatches.reasons, ...watchlistMatch.reasons, 'active-position-and-watchlist'],
      watchlistInterestLevel: watchlistMatch.interestLevel,
      matchedWatchlistVenues: watchlistMatch.venues,
      dataQualityCaveat: watchlistMatch.dataQualityCaveat
    })
  }

  if (hasFutures) {
    return buildMatch(event, 'active-futures-position', {
      symbols: futuresMatches.symbols,
      assets: futuresMatches.assets,
      reasons: futuresMatches.reasons
    })
  }

  if (hasSpot && hasWatchlist) {
    return buildMatch(event, 'position-and-watchlist', {
      symbols: watchlistMatch.symbols,
      assets: unique([...spotMatches.assets, ...watchlistMatch.assets]),
      reasons: [...spotMatches.reasons, ...watchlistMatch.reasons, 'active-spot-and-watchlist'],
      watchlistInterestLevel: watchlistMatch.interestLevel,
      matchedWatchlistVenues: watchlistMatch.venues,
      dataQualityCaveat: watchlistMatch.dataQualityCaveat
    })
  }

  if (hasSpot) {
    return buildMatch(event, 'active-spot-exposure', {
      symbols: spotMatches.symbols,
      assets: spotMatches.assets,
      reasons: spotMatches.reasons
    })
  }

  if (hasWatchlist) {
    return buildMatch(event, 'watchlist', {
      symbols: watchlistMatch.symbols,
      assets: watchlistMatch.assets,
      reasons: watchlistMatch.reasons,
      watchlistInterestLevel: watchlistMatch.interestLevel,
      matchedWatchlistVenues: watchlistMatch.venues,
      dataQualityCaveat: watchlistMatch.dataQualityCaveat
    })
  }

  const sectorMatch = matchRelatedSector(event, scope)
  if (sectorMatch) {
    return buildMatch(event, 'related-sector', sectorMatch)
  }

  return buildMatch(event, 'irrelevant', {
    symbols: [],
    assets: [],
    reasons: policy.positionAndWatchlistOnly ? ['outside-position-and-watchlist-scope'] : ['no-symbol-match']
  })
}

function matchWatchlist(
  event: NormalizedMarketEvent,
  items: IntelligenceWatchlistSymbolProjection[]
): {
  symbols: string[]
  assets: string[]
  reasons: string[]
  venues: string[]
  interestLevel?: 'low' | 'normal' | 'high'
  dataQualityCaveat?: string
} {
  const symbols: string[] = []
  const assets: string[] = []
  const reasons: string[] = []
  const venues: string[] = []
  let interestLevel: 'low' | 'normal' | 'high' | undefined
  let dataQualityCaveat: string | undefined

  for (const item of items) {
    const symbolHit = event.symbols.includes(item.symbol) || event.assets.includes(item.symbol)
    const assetHit = item.baseAsset ? event.assets.includes(item.baseAsset) || event.symbols.includes(item.baseAsset) : false
    const quoteHit =
      item.quoteAsset && event.quoteAssets?.includes(item.quoteAsset)
        ? true
        : item.quoteAsset
          ? event.assets.includes(item.quoteAsset)
          : false

    if (symbolHit) {
      symbols.push(item.symbol)
      reasons.push(`watchlist-symbol:${item.symbol}`)
    } else if (assetHit) {
      if (item.baseAsset) assets.push(item.baseAsset)
      reasons.push(`watchlist-base-asset:${item.baseAsset ?? item.symbol}`)
    } else if (quoteHit) {
      symbols.push(item.symbol)
      reasons.push(`watchlist-quote-asset:${item.quoteAsset}`)
    }

    if (symbolHit || assetHit || quoteHit) {
      venues.push(item.venue)
      interestLevel = maxInterest(interestLevel, item.interestLevel)
      if (item.symbolStatus === 'degraded') {
        dataQualityCaveat = 'Watchlist symbol metadata is degraded.'
      }
    }
  }

  return { symbols: unique(symbols), assets: unique(assets), reasons, venues: unique(venues), interestLevel, dataQualityCaveat }
}

function matchSymbols(event: NormalizedMarketEvent, symbols: string[]) {
  const matched = symbols.filter((symbol) => event.symbols.includes(symbol))
  const assets = event.assets.filter((asset) => symbols.some((symbol) => symbol.startsWith(asset)))
  return {
    symbols: unique(matched),
    assets: unique(assets),
    reasons: matched.map((symbol) => `active-futures-symbol:${symbol}`)
  }
}

function matchAssets(event: NormalizedMarketEvent, assets: string[]) {
  const matchedAssets = assets.filter((asset) => event.assets.includes(asset) || event.symbols.includes(asset))
  const matchedSymbols = event.symbols.filter((symbol) => assets.some((asset) => symbol.startsWith(asset)))
  return {
    symbols: unique(matchedSymbols),
    assets: unique(matchedAssets),
    reasons: matchedAssets.map((asset) => `active-spot-asset:${asset}`)
  }
}

function matchRelatedSector(event: NormalizedMarketEvent, scope: MonitoringScope) {
  if (event.category !== 'macro') return null
  if (scope.activeAssets.length === 0 && scope.watchlistAssets.length === 0) return null
  return {
    symbols: [] as string[],
    assets: [] as string[],
    reasons: ['related-sector-macro']
  }
}

function buildMatch(
  event: NormalizedMarketEvent,
  relevance: EventRelevanceKind,
  input: {
    symbols: string[]
    assets: string[]
    reasons: string[]
    watchlistInterestLevel?: 'low' | 'normal' | 'high'
    matchedWatchlistVenues?: string[]
    dataQualityCaveat?: string
  }
): EventMatch {
  return {
    eventId: event.id,
    relevance,
    matchedSymbols: input.symbols,
    matchedAssets: input.assets,
    matchReasons: input.reasons,
    watchlistInterestLevel: input.watchlistInterestLevel,
    matchedWatchlistVenues: input.matchedWatchlistVenues,
    dataQualityCaveat: input.dataQualityCaveat
  }
}

function maxInterest(
  current: 'low' | 'normal' | 'high' | undefined,
  next: 'low' | 'normal' | 'high'
): 'low' | 'normal' | 'high' {
  const rank = { low: 1, normal: 2, high: 3 } as const
  if (!current) return next
  return rank[next] > rank[current] ? next : current
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function isTimelineRelevant(match: EventMatch, filter: 'active-exposure' | 'watchlist' | 'both' | 'all'): boolean {
  if (filter === 'all') return match.relevance !== 'irrelevant'
  if (match.relevance === 'irrelevant' || match.relevance === 'related-sector') return false

  if (filter === 'both') {
    return match.relevance === 'position-and-watchlist' || match.relevance === 'active-futures-position' || match.relevance === 'active-spot-exposure' || match.relevance === 'watchlist' || match.relevance === 'market-wide-critical'
  }

  if (filter === 'active-exposure') {
    return (
      match.relevance === 'active-futures-position' ||
      match.relevance === 'active-spot-exposure' ||
      match.relevance === 'position-and-watchlist' ||
      match.relevance === 'market-wide-critical'
    )
  }

  return match.relevance === 'watchlist' || match.relevance === 'position-and-watchlist' || match.relevance === 'market-wide-critical'
}
