import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS, type MarketIntelligenceQueryCaveat, type MarketIntelligenceQueryScope } from './queryContracts'

export type ResolvedQueryScope = {
  canonicalInstrumentId?: string
  venue?: string
  symbol?: string
  asset?: string
  sector?: string
  market?: string
  isMarketWide: boolean
  caveats: MarketIntelligenceQueryCaveat[]
}

export function normalizeQueryScope(scope?: MarketIntelligenceQueryScope): ResolvedQueryScope {
  if (!scope) {
    return { isMarketWide: true, caveats: [] }
  }

  const normalized: ResolvedQueryScope = {
    canonicalInstrumentId: scope.canonicalInstrumentId?.trim() || undefined,
    venue: scope.venue?.trim() || undefined,
    symbol: scope.symbol?.trim().toUpperCase() || undefined,
    asset: scope.asset?.trim().toUpperCase() || undefined,
    sector: scope.sector?.trim() || undefined,
    market: scope.market?.trim() || undefined,
    isMarketWide: false,
    caveats: []
  }

  const hasSpecificScope = Boolean(
    normalized.canonicalInstrumentId ||
      normalized.venue ||
      normalized.symbol ||
      normalized.asset ||
      normalized.sector ||
      normalized.market
  )
  normalized.isMarketWide = !hasSpecificScope
  return normalized
}

export function parseItemSymbols(item: IntelligenceItem): string[] {
  if (!item.symbolsJson?.trim()) return []
  try {
    const parsed = JSON.parse(item.symbolsJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string').map((value) => value.toUpperCase())
  } catch {
    return []
  }
}

export function parseItemAssets(item: IntelligenceItem): string[] {
  if (!item.entitiesJson?.trim()) return []
  try {
    const parsed = JSON.parse(item.entitiesJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string').map((value) => value.toUpperCase())
  } catch {
    return []
  }
}

export function itemMatchesScope(item: IntelligenceItem, scope: ResolvedQueryScope): { matched: boolean; caveats: string[] } {
  if (scope.isMarketWide) return { matched: true, caveats: [] }

  const symbols = parseItemSymbols(item)
  const assets = parseItemAssets(item)
  const caveats: MarketIntelligenceQueryCaveat[] = []

  if (scope.symbol && symbols.includes(scope.symbol)) {
    return { matched: true, caveats }
  }

  if (scope.canonicalInstrumentId && symbols.includes(scope.canonicalInstrumentId.toUpperCase())) {
    return { matched: true, caveats }
  }

  if (scope.asset) {
    const assetMatch =
      assets.includes(scope.asset) || symbols.some((symbol) => symbol.startsWith(scope.asset!))
    if (assetMatch) {
      caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.scopeResolvedByAssetFallback)
      return { matched: true, caveats }
    }
  }

  if (scope.sector && item.sourceCategory.includes(scope.sector)) {
    return { matched: true, caveats }
  }

  if (scope.market && (item.sourceCategory.includes('macro') || item.eventType.includes('macro'))) {
    return { matched: true, caveats }
  }

  if (scope.venue && item.sourceId.includes(scope.venue.toLowerCase())) {
    return { matched: true, caveats }
  }

  return { matched: false, caveats }
}

export function impactMatchesScope(
  impact: IntelligenceImpact,
  item: IntelligenceItem | undefined,
  scope: ResolvedQueryScope
): { matched: boolean; caveats: string[] } {
  if (scope.isMarketWide) return { matched: true, caveats: [] }

  const caveats: MarketIntelligenceQueryCaveat[] = []

  if (scope.symbol && impact.scopeType === 'symbol' && impact.scopeKey.toUpperCase() === scope.symbol) {
    return { matched: true, caveats }
  }

  if (scope.asset && impact.scopeType === 'symbol' && impact.scopeKey.toUpperCase().startsWith(scope.asset)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.scopeResolvedByAssetFallback)
    return { matched: true, caveats }
  }

  if (scope.sector && impact.scopeType === 'sector' && impact.scopeKey === scope.sector) {
    return { matched: true, caveats }
  }

  if (
    scope.market &&
    (impact.scopeType === 'market-wide' || impact.scopeType === 'crypto-market' || impact.scopeType === 'risk-assets')
  ) {
    return { matched: true, caveats }
  }

  if (item) {
    return itemMatchesScope(item, scope)
  }

  return { matched: false, caveats }
}

export function impactScopeIsMarketWide(impact: IntelligenceImpact): boolean {
  return (
    impact.scopeType === 'market-wide' ||
    impact.scopeType === 'crypto-market' ||
    impact.scopeType === 'risk-assets'
  )
}
