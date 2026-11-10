export type AgentId = 'crypto' | 'stocks' | 'futures'
export type PanelId = 'dashboard' | 'economic-calendar'
/**
 * 一个源**供给哪些模块**。这是唯一的声明；`panels` 由它派生（见 `src()`），
 * 所以「这个源出现在哪一屏」只有一处事实，不会两处各写一份。
 *
 * `briefing` / `sentiment` 对应的是日报与舆情两条**消费线**，它们没有「面板」这一层，
 * 因此不映射到任何 `PanelId`——把其中一个映射成面板，会让源凭空出现在看板上。
 */
export type SourcePurpose = 'dashboard' | 'calendar' | 'briefing' | 'sentiment' | 'analysis'
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
  /**
   * 供给哪些模块。唯一声明；`panels` 是它的投影，见 `src()`。
   *
   * **定义上可选**：`src()` 总会填（真实数据没有 undefined），但全仓很多测试夹具在直接构造
   * `SourceDefinition`，把它设成必填会让那些文件变红——而它们不是这条的判据。
   * 判据是那条「39 个源的派生 `panels` 与改前逐项相等」的快照守卫。
   */
  purposes?: SourcePurpose[]
  /** 派生的显示位置，不单独声明：`dashboard → ['dashboard']`、`calendar → ['economic-calendar']`。 */
  panels: PanelId[]
  /**
   * 供维护/备用：今天没有任何读者可见产出。
   *
   * 它只解释「为什么 `purposes` 是空的」，**不表示不要采集**，也不许驱动任何面板、列表或开关状态。
   * 与 `purposes` 的关系是「至少一个 purpose，或本标记」——两者都没有的源，要么是漏填，要么该下线。
   */
  maintenanceOnly?: true
  /**
   * 给读者看的一句话摘要的**键**，句子在中英文案表里，键名约定
   * `settings.intelligenceSources.sourceSummary.<sourceId>`。
   *
   * 句子由产品出；没有句子就不接键，别自己造一句。
   */
  summaryKey?: string
  visibility: SourceVisibility
  collection: SourceCollection
  kind: SourceKind
  capabilities: SourceCapabilities
  readiness: SourceReadiness
  readinessNote?: string
  adapterRef?: string
  /**
   * The source's API host is edge-blocked from some networks (for example mainland China) and is
   * only reachable through a working local proxy. Declared once per source; a provider-level
   * need is derived with `sources.some(...)` rather than stored a second time.
   */
  requiresProxy?: boolean
  /**
   * The source cannot be fetched at all right now, by a recorded decision rather than by a failure.
   *
   * Different from `readiness: 'planned'` (never wired) and from a failed run (it may come back):
   * here the endpoint itself refuses every attempt, so automatic collection is **stopped** and the
   * settings page must say 「不可用」+ the reason instead of showing a green or a failing state.
   * `reasonCode` is the existing failure vocabulary, not a new one.
   */
  unavailable?: Readonly<{
    reasonCode: 'official-endpoint-returned-403'
    automaticSync: 'stopped'
    /** Last time this source actually wrote data; the reader is told the data is that old. */
    lastSuccessfulSyncAt?: string
    /** When the decision was taken (a date, not an instant: it is a decision, not a run). */
    decidedAt: string
  }>
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

/** `src()` 的输入：`purposes` 必填（注册表作者不许漏），其余字段可省略走默认。 */
/**
 * `src()` 的输入：`purposes` 必填，`panels` **不许传**（它由 `purposes` 派生，传进来只会被静默覆盖）。
 *
 * `panels` 从类型上 `Omit` 掉，所以「顺手写一个 panels」是**编译错误**，不是运行期被悄悄改写——
 * 面板归属只有一个声明处（`purposes`），这条让第二份声明连写都写不出来。
 */
type SourceInput = Omit<SourceDefinition, 'providerId' | 'purposes' | 'panels'> & { purposes: SourcePurpose[] }

/** `src()` 的输出：派生出 `panels`，`providerId` 由 `provider()` 补上。 */
type SourceSeed = Omit<SourceInput, 'providerId'> & Pick<SourceDefinition, 'panels'>

function src(input: Partial<Omit<SourceInput, 'purposes'>> & Pick<SourceInput, 'sourceId' | 'displayName' | 'purposes'>): SourceSeed {
  return {
    agents: ['crypto'],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: false },
    readiness: 'live',
    ...input,
    // 派生，不接收调用方的 panels：声明只看 `purposes` 一处。
    panels: input.purposes.flatMap((purpose) => purpose === 'dashboard' ? ['dashboard' as const] : purpose === 'calendar' ? ['economic-calendar' as const] : [])
  }
}

function provider(input: {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: 'none' | 'api-key'
  sources: SourceSeed[]
}): ProviderDefinition {
  return {
    ...input,
    sources: input.sources.map((source) => ({ ...source, providerId: input.providerId }))
  }
}

/** 同时供给看板与经济日历的源：两个 purpose 一起声明。 */
const dashboardAndCalendar: SourcePurpose[] = ['dashboard', 'calendar']

const providerDefinitions: readonly ProviderDefinition[] = [
  provider({
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-fed', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-fed', displayName: 'Fed official schedule', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true } }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'federal-reserve-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.federal-reserve-rss', displayName: 'Fed RSS', adapterRef: 'federal-reserve-rss' })
    ]
  }),
  provider({
    providerId: 'bea',
    displayName: 'Bureau of Economic Analysis (BEA)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-bea', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-bea', displayName: 'BEA official releases', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true } }),
      src({ purposes: [], sourceId: 'bea-economic-series', summaryKey: 'settings.intelligenceSources.sourceSummary.bea-economic-series', displayName: 'BEA economic series', visibility: 'pending', collection: 'none', readiness: 'planned', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'bea-economic-series' })
    ]
  }),
  provider({
    providerId: 'bls',
    displayName: 'Bureau of Labor Statistics (BLS)',
    category: 'macro',
    credential: 'none',
    sources: [
      // 官方站点在当前网络被 CDN 边缘拒绝（403，直连与代理都一样），自动同步 2026-11-08 停止。
      // 判定与取证在 `macro-calendar/bls-schedule-catch-up/blsOfficialCalendarAvailability.ts`，
      // 这里只是把它投影到设置页/源健康：显示「不可用」，不是「同步失败」也不是「没有数据」。
      src({
        sourceId: 'macro-calendar-bls', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-bls',
        displayName: 'BLS official schedule',
        purposes: ['dashboard', 'calendar', 'briefing'],
        collection: 'provider',
        kind: 'official-calendar',
        capabilities: { runNow: 'provider', testConnection: true, blsSync: true },
        unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped',
          lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z', decidedAt: '2026-11-08' }
      }),
      src({ purposes: [], sourceId: 'bls-economic-series', summaryKey: 'settings.intelligenceSources.sourceSummary.bls-economic-series', displayName: 'BLS economic series', visibility: 'pending', collection: 'none', readiness: 'fixture-ready', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'bls-economic-series' })
    ]
  }),
  provider({
    providerId: 'policy-path',
    displayName: 'Polymarket',
    category: 'macro',
    credential: 'none',
    // The odds are collected by the product's own ten-minute job; the generic adapter must not arm a
    // second poller, and there is nothing for the reader to test.
    sources: [src({
      sourceId: 'policy-path-market', summaryKey: 'settings.intelligenceSources.sourceSummary.policy-path-market',
      displayName: 'FOMC decision market',
      purposes: ['dashboard', 'briefing'],
      collection: 'none',
      capabilities: { runNow: 'none', testConnection: true },
      adapterRef: 'policy-path-market'
    })]
  }),
  provider({
    providerId: 'fred',
    displayName: 'Federal Reserve Economic Data (FRED)',
    category: 'macro',
    credential: 'api-key',
    sources: [
      src({ sourceId: 'fred-rates-liquidity', summaryKey: 'settings.intelligenceSources.sourceSummary.fred-rates-liquidity', displayName: 'FRED rates & liquidity', purposes: ['dashboard', 'briefing'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'fred-rates-liquidity' }),
      src({ purposes: [], sourceId: 'fred', summaryKey: 'settings.intelligenceSources.sourceSummary.fred', displayName: 'FRED (deprecated)', visibility: 'hidden', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'fred' })
    ]
  }),
  provider({
    providerId: 'treasury',
    displayName: 'U.S. Treasury',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ purposes: [], sourceId: 'treasury-fiscal-data', summaryKey: 'settings.intelligenceSources.sourceSummary.treasury-fiscal-data', displayName: 'Treasury fiscal data', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'treasury-fiscal-data' })
    ]
  }),
  provider({
    providerId: 'sec',
    displayName: 'SEC',
    category: 'macro',
    credential: 'none',
    sources: [src({ sourceId: 'sec-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.sec-rss', displayName: 'SEC press releases', visibility: 'advanced', purposes: ['dashboard', 'briefing', 'sentiment'], adapterRef: 'sec-rss' })]
  }),
  provider({
    providerId: 'cftc',
    displayName: 'CFTC',
    category: 'macro',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'cftc-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.cftc-rss', displayName: 'CFTC press releases', visibility: 'advanced', adapterRef: 'cftc-rss' })]
  }),
  provider({
    providerId: 'binance',
    displayName: 'Binance',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'binance-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-announcements', displayName: 'Binance announcements', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, adapterRef: 'binance-announcements' }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'binance-api-updates', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-api-updates', displayName: 'Binance API updates', requiresProxy: true, adapterRef: 'binance-api-updates' }),
      src({ purposes: ['analysis'], sourceId: 'binance-spot-market', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-spot-market', displayName: 'Binance spot market', requiresProxy: true, adapterRef: 'binance-spot-market' }),
      src({ sourceId: 'binance-futures-positioning', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-futures-positioning', displayName: 'Binance futures positioning', purposes: ['dashboard', 'briefing'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-futures-positioning' }),
      src({ purposes: [], sourceId: 'binance-asset-page', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-asset-page', displayName: 'Binance asset page', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'binance-asset-page' })
    ]
  }),
  provider({
    providerId: 'okx',
    displayName: 'OKX',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'okx-latest-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.okx-latest-announcements', displayName: 'OKX latest announcements', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, adapterRef: 'okx-latest-announcements' }),
      src({ purposes: ['analysis'], sourceId: 'okx-api-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.okx-api-announcements', displayName: 'OKX API announcements', requiresProxy: true, adapterRef: 'okx-api-announcements' })
    ]
  }),
  provider({
    providerId: 'coingecko',
    displayName: 'CoinGecko',
    category: 'crypto',
    credential: 'none',
    sources: [src({ purposes: ['analysis'], sourceId: 'coingecko-market', summaryKey: 'settings.intelligenceSources.sourceSummary.coingecko-market', displayName: 'CoinGecko market', adapterRef: 'coingecko-market' })]
  }),
  provider({
    providerId: 'defillama',
    displayName: 'DeFiLlama',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'defillama-stablecoins', summaryKey: 'settings.intelligenceSources.sourceSummary.defillama-stablecoins', displayName: 'DeFiLlama stablecoins', purposes: ['dashboard', 'briefing'], requiresProxy: true, adapterRef: 'defillama-stablecoins' }),
      src({ purposes: ['analysis'], sourceId: 'defillama-tvl', summaryKey: 'settings.intelligenceSources.sourceSummary.defillama-tvl', displayName: 'DeFiLlama TVL', requiresProxy: true, adapterRef: 'defillama-tvl' })
    ]
  }),
  provider({
    providerId: 'alternative-me',
    displayName: 'Alternative.me',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'alternative-fear-greed', summaryKey: 'settings.intelligenceSources.sourceSummary.alternative-fear-greed', displayName: 'Fear & Greed Index', purposes: ['dashboard', 'briefing'], adapterRef: 'alternative-fear-greed' })]
  }),
  provider({
    providerId: 'coindesk',
    displayName: 'CoinDesk',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'coindesk-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.coindesk-rss', displayName: 'CoinDesk RSS', visibility: 'advanced', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, adapterRef: 'coindesk-rss' })]
  }),
  provider({
    providerId: 'ethereum-foundation',
    displayName: 'Ethereum Foundation',
    category: 'crypto',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'ethereum-foundation-blog', summaryKey: 'settings.intelligenceSources.sourceSummary.ethereum-foundation-blog', displayName: 'Ethereum Foundation blog', visibility: 'advanced', adapterRef: 'ethereum-foundation-blog' })]
  }),
  provider({
    providerId: 'cryptopanic',
    displayName: 'CryptoPanic',
    category: 'crypto',
    credential: 'api-key',
    sources: [src({ purposes: [], sourceId: 'cryptopanic', summaryKey: 'settings.intelligenceSources.sourceSummary.cryptopanic', displayName: 'CryptoPanic news', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'cryptopanic' })]
  }),
  provider({
    providerId: 'coinmarketcal',
    displayName: 'CoinMarketCal',
    category: 'crypto',
    credential: 'api-key',
    sources: [
      src({ purposes: [], sourceId: 'coinmarketcal', summaryKey: 'settings.intelligenceSources.sourceSummary.coinmarketcal', displayName: 'CoinMarketCal news (superseded)', visibility: 'hidden', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'coinmarketcal' }),
      src({ purposes: [], sourceId: 'macro-calendar-coinmarketcal', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-coinmarketcal', displayName: 'CoinMarketCal events', visibility: 'pending', readiness: 'planned', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, kind: 'market-calendar' })
    ]
  }),
  provider({
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    sources: [
      src({ sourceId: '0xrouter-aggregate-provider', summaryKey: 'settings.intelligenceSources.sourceSummary.0xrouter-aggregate-provider', displayName: '0xRouter aggregate market', purposes: ['dashboard', 'briefing'], capabilities: { runNow: 'none', testConnection: true }, adapterRef: '0xrouter-aggregate-provider', requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-economic-data', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-economic-data', displayName: '0xRouter economic data', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-financial-events', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-financial-events', displayName: '0xRouter financial events', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true }),
      src({ sourceId: 'macro-calendar-0xrouter-central-bank-activities', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-0xrouter-central-bank-activities', displayName: '0xRouter central bank activities', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'job', kind: 'market-calendar', capabilities: { runNow: 'job', testConnection: true }, requiresProxy: true })
    ]
  }),
  provider({
    providerId: 'realmarketapi',
    displayName: 'RealMarketAPI',
    category: 'aggregate',
    credential: 'api-key',
    sources: [src({ sourceId: 'realmarketapi-market', summaryKey: 'settings.intelligenceSources.sourceSummary.realmarketapi-market', displayName: 'RealMarketAPI DXY', purposes: ['dashboard', 'briefing'], capabilities: { runNow: 'none', testConnection: true }, adapterRef: 'realmarketapi-market' })]
  }),
  provider({
    providerId: 'twelve-data',
    displayName: 'Twelve Data',
    category: 'aggregate',
    credential: 'api-key',
    sources: [src({ sourceId: 'twelve-data-market', summaryKey: 'settings.intelligenceSources.sourceSummary.twelve-data-market', displayName: 'Twelve Data macro market', purposes: ['dashboard'], visibility: 'visible', readiness: 'live', collection: 'none', capabilities: { runNow: 'none', testConnection: false }, adapterRef: 'twelve-data-market' })]
  }),
  provider({
    providerId: 'coinbase',
    displayName: 'Coinbase',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'coinbase-status', summaryKey: 'settings.intelligenceSources.sourceSummary.coinbase-status', displayName: 'Coinbase status', visibility: 'advanced', kind: 'status', adapterRef: 'coinbase-status' })]
  }),
  provider({
    providerId: 'kraken',
    displayName: 'Kraken',
    category: 'system',
    credential: 'none',
    sources: [
      src({ purposes: [], maintenanceOnly: true, sourceId: 'kraken-status', summaryKey: 'settings.intelligenceSources.sourceSummary.kraken-status', displayName: 'Kraken status', visibility: 'advanced', kind: 'status', adapterRef: 'kraken-status' }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'kraken-system-status', summaryKey: 'settings.intelligenceSources.sourceSummary.kraken-system-status', displayName: 'Kraken system status', visibility: 'advanced', kind: 'status', adapterRef: 'kraken-system-status' })
    ]
  }),
  provider({
    providerId: 'solana',
    displayName: 'Solana',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'solana-status', summaryKey: 'settings.intelligenceSources.sourceSummary.solana-status', displayName: 'Solana status', visibility: 'advanced', kind: 'status', adapterRef: 'solana-status' })]
  }),
  provider({
    providerId: 'github',
    displayName: 'GitHub',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'github-releases', summaryKey: 'settings.intelligenceSources.sourceSummary.github-releases', displayName: 'GitHub releases', visibility: 'advanced', adapterRef: 'github-releases' })]
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
      { groupId: 'spot-momentum', agentId: 'crypto', tier: 'required', sourceIds: ['binance-spot-market', 'coingecko-market', '0xrouter-aggregate-provider', 'realmarketapi-market', 'twelve-data-market', 'binance-asset-page'] },
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
          'treasury-fiscal-data',
          'policy-path-market'
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
  'policy-path': { website: 'https://polymarket.com/zh?tag=fed' },
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
