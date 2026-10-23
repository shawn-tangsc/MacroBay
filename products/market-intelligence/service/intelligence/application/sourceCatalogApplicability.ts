import type {
  IntelligenceApplicabilityMode,
  IntelligenceFocusMarket,
  IntelligenceSourceApplicability,
  IntelligenceSourceCatalogEntry,
  IntelligenceSourceDefinition,
  IntelligenceSourceKind
} from '../schema/intelligenceSource'

type ApplicabilitySeed = IntelligenceSourceApplicability

const APPLICABILITY_BY_SOURCE_ID: Record<string, ApplicabilitySeed> = {
  'federal-reserve-rss': {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  'bea-economic-series': {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  'bls-economic-series': {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  'fred-rates-liquidity': {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  fred: {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  'treasury-fiscal-data': {
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro']
  },
  'sec-rss': {
    sourceKind: 'official-regulator',
    applicabilityMode: 'dynamic-detected',
    focusMarkets: ['digital-assets', 'us-equities'],
    dynamicClassification: true
  },
  'cftc-rss': {
    sourceKind: 'official-regulator',
    applicabilityMode: 'dynamic-detected',
    focusMarkets: ['digital-assets', 'china-futures', 'commodities'],
    dynamicClassification: true
  },
  'alternative-fear-greed': {
    sourceKind: 'metric-aggregator',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'coindesk-rss': {
    sourceKind: 'market-media',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  cryptopanic: {
    sourceKind: 'market-media',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  coinmarketcal: {
    sourceKind: 'market-media',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'coingecko-market': {
    sourceKind: 'data-aggregator',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'binance-announcements': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['binance']
  },
  'binance-api-updates': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['binance']
  },
  'binance-spot-market': {
    sourceKind: 'metric-aggregator',
    applicabilityMode: 'instrument',
    focusMarkets: ['digital-assets'],
    venueScopes: ['binance'],
    instrumentScopes: ['ETHUSDT', 'BTCUSDT']
  },
  'binance-futures-positioning': {
    sourceKind: 'metric-aggregator',
    applicabilityMode: 'instrument',
    focusMarkets: ['digital-assets'],
    venueScopes: ['binance'],
    instrumentScopes: ['ETHUSDT', 'BTCUSDT']
  },
  'binance-asset-page': {
    sourceKind: 'mixed-news-hub',
    applicabilityMode: 'instrument',
    focusMarkets: ['digital-assets'],
    venueScopes: ['binance']
  },
  'defillama-stablecoins': {
    sourceKind: 'data-aggregator',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'defillama-tvl': {
    sourceKind: 'data-aggregator',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  '0xrouter-aggregate-provider': {
    sourceKind: 'data-aggregator',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'okx-latest-announcements': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['okx']
  },
  'okx-api-announcements': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['okx']
  },
  'ethereum-foundation-blog': {
    sourceKind: 'project-official',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'github-releases': {
    sourceKind: 'project-official',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  },
  'kraken-system-status': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['kraken']
  },
  'coinbase-status': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['coinbase']
  },
  'kraken-status': {
    sourceKind: 'exchange-announcement',
    applicabilityMode: 'venue',
    focusMarkets: ['digital-assets'],
    venueScopes: ['kraken']
  },
  'solana-status': {
    sourceKind: 'project-official',
    applicabilityMode: 'market-domain',
    focusMarkets: ['digital-assets']
  }
}

const DEFAULT_APPLICABILITY: ApplicabilitySeed = {
  sourceKind: 'mixed-news-hub',
  applicabilityMode: 'market-domain',
  focusMarkets: ['digital-assets']
}

export function resolveSourceApplicability(
  sourceId: string,
  overrides?: Partial<IntelligenceSourceApplicability>
): IntelligenceSourceApplicability {
  const seed = APPLICABILITY_BY_SOURCE_ID[sourceId] ?? DEFAULT_APPLICABILITY
  return {
    ...seed,
    ...overrides,
    focusMarkets: overrides?.focusMarkets ?? seed.focusMarkets
  }
}

export function attachSourceApplicability(
  definition: IntelligenceSourceCatalogEntry
): IntelligenceSourceDefinition {
  const overrides: Partial<IntelligenceSourceApplicability> = {}
  if (definition.sourceKind) overrides.sourceKind = definition.sourceKind
  if (definition.applicabilityMode) overrides.applicabilityMode = definition.applicabilityMode
  if (definition.focusMarkets?.length) overrides.focusMarkets = definition.focusMarkets
  if (definition.venueScopes?.length) overrides.venueScopes = definition.venueScopes
  if (definition.instrumentScopes?.length) overrides.instrumentScopes = definition.instrumentScopes
  if (definition.dynamicClassification !== undefined) {
    overrides.dynamicClassification = definition.dynamicClassification
  }

  const applicability = resolveSourceApplicability(definition.sourceId, overrides)

  return {
    ...definition,
    ...applicability
  }
}

export function listCatalogApplicabilitySeeds(): Array<{
  sourceId: string
  applicability: IntelligenceSourceApplicability
}> {
  return Object.entries(APPLICABILITY_BY_SOURCE_ID).map(([sourceId, applicability]) => ({
    sourceId,
    applicability
  }))
}

export type { IntelligenceSourceKind, IntelligenceApplicabilityMode, IntelligenceFocusMarket }
