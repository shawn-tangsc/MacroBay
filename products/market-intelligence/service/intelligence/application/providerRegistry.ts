export type AgentId = 'crypto' | 'stocks' | 'futures'
export type PanelId = 'dashboard' | 'economic-calendar'
export type SourceCategory = 'macro' | 'crypto' | 'aggregate' | 'system'
export type SourceVisibility = 'visible' | 'pending' | 'advanced' | 'hidden'
export type SourceCollection = 'adapter' | 'provider' | 'job' | 'none'
export type SourceTier = 'required' | 'recommended' | 'optional'
export type SourceKind = 'feed' | 'official-calendar' | 'market-calendar' | 'status'
export type SourceReadiness = 'live' | 'fixture-ready' | 'planned'

export type SourceCapabilities = {
  runNow: 'adapter' | 'provider' | 'job' | 'none'
  testConnection: boolean
  blsSync?: boolean
}

export type SourceDefinition = {
  sourceId: string
  providerId: string
  displayName: string
  agents: AgentId[]
  panels: PanelId[]
  visibility: SourceVisibility
  collection: SourceCollection
  kind: SourceKind
  capabilities: SourceCapabilities
  readiness: SourceReadiness
  readinessNote?: string
  adapterRef?: string
  /**
   * The source's API host is edge-blocked from some networks (for example mainland China) and is
   * only reachable through a working local proxy/VPN. Declared once per source; a provider-level
   * need is derived with `sources.some(...)` rather than stored a second time.
   */
  requiresProxy?: boolean
}

export type ProviderDefinition = {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: 'none' | 'api-key'
  /** Public home page, opened in the system browser. */
  website?: string
  /** Signup / API-key guide. Replace with the operator's invite link. */
  signupUrl?: string
  /** True when signupUrl carries the operator's invite code. */
  invite?: boolean
  sources: SourceDefinition[]
}

export type ActivationGroupDefinition = {
  groupId: string
  agentId: AgentId
  tier: SourceTier
  sourceIds: string[]
}

export type AgentDefinition = {
  agentId: AgentId
  displayName: string
  activation: 'available' | 'coming-soon'
  groups: ActivationGroupDefinition[]
}

export type PanelDefinition = {
  panelId: PanelId
  agentId: AgentId
  displayName: string
}

type SourceInput = Omit<SourceDefinition, 'providerId'>

function src(input: Partial<SourceInput> & Pick<SourceInput, 'sourceId' | 'displayName'>): SourceInput {
  return {
    agents: ['crypto'],
    panels: [],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: false },
    readiness: 'live',
    ...input
  }
}

function provider(input: {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: 'none' | 'api-key'
  sources: SourceInput[]
}): ProviderDefinition {
  return {
    ...input,
    sources: input.sources.map((source) => ({ ...source, providerId: input.providerId }))
  }
}

const dashboardAndCalendar: PanelId[] = ['dashboard', 'economic-calendar']

const providerDefinitions: readonly ProviderDefinition[] = [
  provider({
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-fed', displayName: 'Fed official schedule', panels: dashboardAndCalendar, collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true } }),
      src({ sourceId: 'federal-reserve-rss', displayName: 'Fed RSS', adapterRef: 'federal-reserve-rss' })
    ]
  }),
  provider({
    providerId: 'bea',
    displayName: 'Bureau of Economic Analysis (BEA)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-bea', displayName: 'BEA official releases', panels: dashboardAndCalendar, collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true } }),
      src({ sourceId: 'bea-economic-series', displayName: 'BEA economic series', visibility: 'pending', collection: 'none', readiness: 'planned', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'bea-economic-series' })
    ]
  }),
  provider({
    providerId: 'bls',
    displayName: 'Bureau of Labor Statistics (BLS)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-bls', displayName: 'BLS official schedule', panels: dashboardAndCalendar, collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true, blsSync: true } }),
      src({ sourceId: 'bls-economic-series', displayName: 'BLS economic series', visibility: 'pending', collection: 'none', readiness: 'fixture-ready', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'bls-economic-series' })
    ]
  }),
  provider({
    providerId: 'fred',
    displayName: 'Federal Reserve Economic Data (FRED)',
    category: 'macro',
    credential: 'api-key',
    sources: [
      src({ sourceId: 'fred-rates-liquidity', displayName: 'FRED rates & liquidity', panels: ['dashboard'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'fred-rates-liquidity' }),
      src({ sourceId: 'fred', displayName: 'FRED (deprecated)', visibility: 'hidden', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'fred' })
    ]
  }),
  provider({
    providerId: 'treasury',
    displayName: 'U.S. Treasury',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'treasury-fiscal-data', displayName: 'Treasury fiscal data', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'treasury-fiscal-data' })
    ]
  }),
  provider({
    providerId: 'sec',
    displayName: 'SEC',
    category: 'macro',
    credential: 'none',
    sources: [src({ sourceId: 'sec-rss', displayName: 'SEC press releases', visibility: 'advanced', panels: ['dashboard'], adapterRef: 'sec-rss' })]
  }),
  provider({
    providerId: 'cftc',
    displayName: 'CFTC',
    category: 'macro',
    credential: 'none',
    sources: [src({ sourceId: 'cftc-rss', displayName: 'CFTC press releases', visibility: 'advanced', adapterRef: 'cftc-rss' })]
  }),
  provider({
    providerId: 'binance',
    displayName: 'Binance',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'binance-announcements', displayName: 'Binance announcements', panels: ['dashboard'], requiresProxy: true, adapterRef: 'binance-announcements' }),
      src({ sourceId: 'binance-api-updates', displayName: 'Binance API updates', requiresProxy: true, adapterRef: 'binance-api-updates' }),
      src({ sourceId: 'binance-spot-market', displayName: 'Binance spot market', requiresProxy: true, adapterRef: 'binance-spot-market' }),
      src({ sourceId: 'binance-futures-positioning', displayName: 'Binance futures positioning', panels: ['dashboard'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-futures-positioning' }),
      src({ sourceId: 'binance-asset-page', displayName: 'Binance asset page', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'binance-asset-page' })
    ]
  }),
  provider({
    providerId: 'okx',
    displayName: 'OKX',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'okx-latest-announcements', displayName: 'OKX latest announcements', panels: ['dashboard'], requiresProxy: true, adapterRef: 'okx-latest-announcements' }),
      src({ sourceId: 'okx-api-announcements', displayName: 'OKX API announcements', requiresProxy: true, adapterRef: 'okx-api-announcements' })
    ]
  }),
  provider({
    providerId: 'coingecko',
    displayName: 'CoinGecko',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'coingecko-market', displayName: 'CoinGecko market', adapterRef: 'coingecko-market' })]
  }),
  provider({
    providerId: 'defillama',
    displayName: 'DeFiLlama',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'defillama-stablecoins', displayName: 'DeFiLlama stablecoins', panels: ['dashboard'], requiresProxy: true, adapterRef: 'defillama-stablecoins' }),
      src({ sourceId: 'defillama-tvl', displayName: 'DeFiLlama TVL', requiresProxy: true, adapterRef: 'defillama-tvl' })
    ]
  }),
  provider({
    providerId: 'alternative-me',
    displayName: 'Alternative.me',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'alternative-fear-greed', displayName: 'Fear & Greed Index', panels: ['dashboard'], adapterRef: 'alternative-fear-greed' })]
  }),
  provider({
    providerId: 'coindesk',
    displayName: 'CoinDesk',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'coindesk-rss', displayName: 'CoinDesk RSS', visibility: 'advanced', panels: ['dashboard'], requiresProxy: true, adapterRef: 'coindesk-rss' })]
  }),
  provider({
    providerId: 'ethereum-foundation',
    displayName: 'Ethereum Foundation',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'ethereum-foundation-blog', displayName: 'Ethereum Foundation blog', visibility: 'advanced', adapterRef: 'ethereum-foundation-blog' })]
  }),
  provider({
    providerId: 'cryptopanic',
    displayName: 'CryptoPanic',
    category: 'crypto',
    credential: 'api-key',
    sources: [src({ sourceId: 'cryptopanic', displayName: 'CryptoPanic news', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'cryptopanic' })]
  }),
  provider({
    providerId: 'coinmarketcal',
    displayName: 'CoinMarketCal',
    category: 'crypto',
    credential: 'api-key',
    sources: [
      src({ sourceId: 'coinmarketcal', displayName: 'CoinMarketCal news (superseded)', visibility: 'hidden', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'coinmarketcal' }),
      src({ sourceId: 'macro-calendar-coinmarketcal', displayName: 'CoinMarketCal events', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, kind: 'market-calendar' })
    ]
  }),
  provider({
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    sources: [
      src({ sourceId: '0xrouter-aggregate-provider', displayName: '0xRouter aggregate market', panels: ['dashboard'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: '0xrouter-aggregate-provider', requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-economic-data', displayName: '0xRouter economic data', panels: dashboardAndCalendar, collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-financial-events', displayName: '0xRouter financial events', panels: dashboardAndCalendar, collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-central-bank-activities', displayName: '0xRouter central bank activities', panels: dashboardAndCalendar, collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true })
    ]
  }),
  provider({
    providerId: 'realmarketapi',
    displayName: 'RealMarketAPI',
    category: 'aggregate',
    credential: 'api-key',
    sources: [src({ sourceId: 'realmarketapi-market', displayName: 'RealMarketAPI DXY', panels: ['dashboard'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'realmarketapi-market' })]
  }),
  provider({
    providerId: 'twelve-data',
    displayName: 'Twelve Data',
    category: 'aggregate',
    credential: 'api-key',
    sources: [src({ sourceId: 'twelve-data-market', displayName: 'Twelve Data macro market', panels: ['dashboard'], visibility: 'hidden', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'twelve-data-market' })]
  }),
  provider({
    providerId: 'coinbase',
    displayName: 'Coinbase',
    category: 'system',
    credential: 'none',
    sources: [src({ sourceId: 'coinbase-status', displayName: 'Coinbase status', visibility: 'advanced', kind: 'status', adapterRef: 'coinbase-status' })]
  }),
  provider({
    providerId: 'kraken',
    displayName: 'Kraken',
    category: 'system',
    credential: 'none',
    sources: [
      src({ sourceId: 'kraken-status', displayName: 'Kraken status', visibility: 'advanced', kind: 'status', adapterRef: 'kraken-status' }),
      src({ sourceId: 'kraken-system-status', displayName: 'Kraken system status', visibility: 'advanced', kind: 'status', adapterRef: 'kraken-system-status' })
    ]
  }),
  provider({
    providerId: 'solana',
    displayName: 'Solana',
    category: 'system',
    credential: 'none',
    sources: [src({ sourceId: 'solana-status', displayName: 'Solana status', visibility: 'advanced', kind: 'status', adapterRef: 'solana-status' })]
  }),
  provider({
    providerId: 'github',
    displayName: 'GitHub',
    category: 'system',
    credential: 'none',
    sources: [src({ sourceId: 'github-releases', displayName: 'GitHub releases', visibility: 'advanced', adapterRef: 'github-releases' })]
  })
]

export const panelRegistry: readonly PanelDefinition[] = [
  { panelId: 'dashboard', agentId: 'crypto', displayName: 'Crypto dashboard' },
  { panelId: 'economic-calendar', agentId: 'crypto', displayName: 'Economic calendar' }
]

export const agentRegistry: readonly AgentDefinition[] = [
  {
    agentId: 'crypto',
    displayName: 'Crypto Market Analyst',
    activation: 'available',
    groups: [
      { groupId: 'fear-greed', agentId: 'crypto', tier: 'required', sourceIds: ['alternative-fear-greed'] },
      { groupId: 'spot-momentum', agentId: 'crypto', tier: 'required', sourceIds: ['binance-spot-market', 'coingecko-market', '0xrouter-aggregate-provider', 'realmarketapi-market', 'binance-asset-page'] },
      { groupId: 'funding-rate', agentId: 'crypto', tier: 'required', sourceIds: ['binance-futures-positioning'] },
      {
        groupId: 'macro-calendar',
        agentId: 'crypto',
        tier: 'recommended',
        sourceIds: [
          'macro-calendar-fed',
          'macro-calendar-bea',
          'macro-calendar-bls',
          'macro-calendar-0xrouter-economic-data',
          'macro-calendar-0xrouter-financial-events',
          'macro-calendar-0xrouter-central-bank-activities',
          'macro-calendar-coinmarketcal',
          'federal-reserve-rss',
          'fred-rates-liquidity',
          'treasury-fiscal-data'
        ]
      },
      { groupId: 'stablecoin-defi', agentId: 'crypto', tier: 'recommended', sourceIds: ['defillama-stablecoins', 'defillama-tvl'] },
      {
        groupId: 'regulation-exchange',
        agentId: 'crypto',
        tier: 'recommended',
        sourceIds: [
          'sec-rss',
          'cftc-rss',
          'binance-announcements',
          'binance-api-updates',
          'okx-latest-announcements',
          'okx-api-announcements',
          'coinbase-status',
          'kraken-status',
          'kraken-system-status',
          'solana-status'
        ]
      },
      { groupId: 'industry-news', agentId: 'crypto', tier: 'optional', sourceIds: ['coindesk-rss', 'ethereum-foundation-blog', 'cryptopanic', 'github-releases'] }
    ]
  },
  { agentId: 'stocks', displayName: 'Equities Market Analyst', activation: 'coming-soon', groups: [] },
  { agentId: 'futures', displayName: 'Futures Market Analyst', activation: 'coming-soon', groups: [] }
]

/**
 * Provider links. `signupUrl` is the operator's invite/signup entry and is
 * opened in the system browser; keep it in sync with the provider registry.
 */
const providerLinks: Readonly<Record<string, Pick<ProviderDefinition, 'website' | 'signupUrl' | 'invite'>>> = {
  fed: { website: 'https://www.federalreserve.gov/' },
  bea: { website: 'https://www.bea.gov/' },
  bls: { website: 'https://www.bls.gov/' },
  fred: { website: 'https://fred.stlouisfed.org/', signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html' },
  treasury: { website: 'https://home.treasury.gov/' },
  sec: { website: 'https://www.sec.gov/' },
  cftc: { website: 'https://www.cftc.gov/' },
  binance: { website: 'https://www.binance.com/' },
  okx: { website: 'https://www.okx.com/' },
  coingecko: { website: 'https://www.coingecko.com/' },
  defillama: { website: 'https://defillama.com/' },
  alternative: { website: 'https://alternative.me/crypto/fear-and-greed-index/' },
  coindesk: { website: 'https://www.coindesk.com/' },
  ethereum: { website: 'https://ethereum.org/' },
  coinmarketcal: { website: 'https://coinmarketcal.com/', signupUrl: 'https://coinmarketcal.com/en/api' },
  cryptopanic: { website: 'https://cryptopanic.com/', signupUrl: 'https://cryptopanic.com/developers/api/' },
  '0xrouter': { website: 'https://0xrouter.app/', signupUrl: 'https://0xrouter.app/index.html?invite=tangscsh', invite: true },
  realmarketapi: { website: 'https://realmarketapi.com/', signupUrl: 'https://realmarketapi.com/?via=Macrobay', invite: true },
  twelvedata: { website: 'https://twelvedata.com/', signupUrl: 'https://twelvedata.com/pricing' },
  coinbase: { website: 'https://www.coinbase.com/' },
  kraken: { website: 'https://www.kraken.com/' },
  solana: { website: 'https://solana.com/' },
  github: { website: 'https://github.com/' }
}

export const providerRegistry: readonly ProviderDefinition[] = providerDefinitions.map((provider) => ({
  ...provider,
  ...providerLinks[provider.providerId]
}))

export function allSources(): SourceDefinition[] {
  return providerRegistry.flatMap((provider) => provider.sources)
}

export function getSource(sourceId: string): SourceDefinition | undefined {
  return allSources().find((source) => source.sourceId === sourceId)
}

export function getProvider(providerId: string): ProviderDefinition | undefined {
  return providerRegistry.find((provider) => provider.providerId === providerId)
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  return agentRegistry.find((agent) => agent.agentId === agentId)
}

export function getPanel(panelId: string): PanelDefinition | undefined {
  return panelRegistry.find((panel) => panel.panelId === panelId)
}
