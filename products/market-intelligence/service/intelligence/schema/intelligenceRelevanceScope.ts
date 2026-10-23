export type IntelligenceWatchlistSymbolProjection = {
  symbol: string
  venue: string
  baseAsset?: string
  quoteAsset?: string
  interestLevel: 'low' | 'normal' | 'high'
  symbolStatus?: 'healthy' | 'degraded' | 'unresolved'
}

export type IntelligenceExposureSnapshot = {
  symbolExposures: Array<{
    asset: string
    sources: Array<{ venue: string; symbol?: string }>
  }>
  derivativePositions: Array<{ symbol: string; asset: string }>
  spotBalances: Array<{ asset?: string }>
}

export type IntelligenceWatchlistScope = {
  enabledItems: IntelligenceWatchlistSymbolProjection[]
  assets: string[]
  spotSymbols: string[]
  usdMFuturesSymbols: string[]
  updatedAt: string
}

export type MonitoringScope = {
  activeAssets: string[]
  activeFuturesSymbols: string[]
  activeSpotAssets: string[]
  watchlistItems: IntelligenceWatchlistSymbolProjection[]
  watchlistAssets: string[]
  watchlistSymbols: string[]
}

export const EMPTY_EXPOSURE_SNAPSHOT: IntelligenceExposureSnapshot = {
  symbolExposures: [],
  derivativePositions: [],
  spotBalances: []
}

export function createEmptyWatchlistScope(updatedAt = new Date().toISOString()): IntelligenceWatchlistScope {
  return {
    enabledItems: [],
    assets: [],
    spotSymbols: [],
    usdMFuturesSymbols: [],
    updatedAt
  }
}

export const EMPTY_MONITORING_SCOPE: MonitoringScope = {
  activeAssets: [],
  activeFuturesSymbols: [],
  activeSpotAssets: [],
  watchlistItems: [],
  watchlistAssets: [],
  watchlistSymbols: []
}

export function buildMonitoringScope(
  exposure: IntelligenceExposureSnapshot,
  watchlistScope: IntelligenceWatchlistScope
): MonitoringScope {
  const activeAssets = new Set<string>()
  const activeFuturesSymbols = new Set<string>()
  const activeSpotAssets = new Set<string>()

  for (const symbolExposure of exposure.symbolExposures) {
    activeAssets.add(symbolExposure.asset)
    for (const source of symbolExposure.sources) {
      if (source.venue === 'spot') {
        activeSpotAssets.add(symbolExposure.asset)
      }
      if (source.symbol) activeFuturesSymbols.add(source.symbol.toUpperCase())
      if (source.venue === 'usdM-futures' && source.symbol) {
        activeFuturesSymbols.add(source.symbol.toUpperCase())
      }
    }
  }

  for (const position of exposure.derivativePositions) {
    activeFuturesSymbols.add(position.symbol.toUpperCase())
    activeAssets.add(position.asset)
  }

  for (const balance of exposure.spotBalances) {
    if (balance.asset) {
      activeSpotAssets.add(balance.asset.toUpperCase())
      activeAssets.add(balance.asset.toUpperCase())
    }
  }

  return {
    activeAssets: sortSet(activeAssets),
    activeFuturesSymbols: sortSet(activeFuturesSymbols),
    activeSpotAssets: sortSet(activeSpotAssets),
    watchlistItems: watchlistScope.enabledItems,
    watchlistAssets: watchlistScope.assets,
    watchlistSymbols: [...new Set([...watchlistScope.spotSymbols, ...watchlistScope.usdMFuturesSymbols])]
  }
}

function sortSet(values: Set<string>): string[] {
  return [...values].filter(Boolean).sort()
}
