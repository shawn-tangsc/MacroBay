/**
 * 目录条目：**公告、交易所、市场数据与状态页**这一组。
 *
 * 从 `sourceCatalog.ts` 拆出来的是**数据块**（一条条 entry 的定义），不是逻辑：
 * 目录本体只做「把两组合起来 + 附着适用范围」，加一个源＝往对应的那组加一条。
 */
import type { IntelligenceSourceCatalogEntry } from '../schema/intelligenceSource'
import { source } from './sourceCatalogEntryFactory'


const catalogEntries: IntelligenceSourceCatalogEntry[] = [
  source({
    sourceId: 'binance-announcements',
    displayName: 'Binance Announcements',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'binance-announcements-v1',
    intelligenceLayer: 'asset',
    dataDomain: 'asset-market',
    reliabilityTier: 'page-extract',
    eventFamily: 'mixed',
    supportedImpactScopes: ['symbol', 'exchange', 'watchlist', 'crypto-market'],
    adapterConfig: {
      pageUrl: 'https://www.binance.com/en/support/announcement',
      listQueryUrl: 'https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query',
      pageSize: 20,
      language: 'en',
      // 列表接口返回全部历史；只收最近 7 天，避免首次接入回填几年公告。
      maxAgeDays: 7
    }
  }),
  source({
    sourceId: 'binance-api-updates',
    displayName: 'Binance API Updates',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'active-position-priority',
    parserStrategy: 'binance-api-updates-v1',
    intelligenceLayer: 'asset',
    dataDomain: 'asset-market',
    reliabilityTier: 'page-extract',
    eventFamily: 'mixed',
    supportedImpactScopes: ['symbol', 'exchange', 'watchlist'],
    adapterConfig: {
      pageUrl: 'https://www.binance.com/en/support/announcement/api-updates',
      listQueryUrl: 'https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query',
      catalogId: 51,
      pageSize: 20,
      language: 'en'
    }
  }),
  source({
    sourceId: 'okx-latest-announcements',
    displayName: 'OKX Latest Announcements',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'okx-announcements-v1',
    // No credential anywhere on this path: the help centre's own JSON endpoint is public, and the
    // reader only has to switch the source on. It is polled on the `balanced` preset (30 minutes)
    // exactly like Binance's announcements.
    readiness: 'live',
    readinessNote:
      'OKX 帮助中心官方公告接口（api/v5/support/announcements，无需凭据）。默认取“全部类型的最近公告”，每 30 分钟采集一次；发布时间采用 OKX 自身发布的 pTime。',
    adapterConfig: {
      pageUrl: 'https://www.okx.com/help/section/announcements-latest-announcements',
      listQueryUrl: 'https://www.okx.com/api/v5/support/announcements',
      page: 1
    }
  }),
  source({
    sourceId: 'okx-api-announcements',
    displayName: 'OKX API Announcements',
    sourceGroup: 'exchange-announcement',
    adapterType: 'html-page-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'active-position-priority',
    parserStrategy: 'okx-announcements-v1',
    readiness: 'live',
    readinessNote:
      'OKX API 变更公告（annType=announcements-api，无需凭据）。每 30 分钟采集一次；接口返回的 URL/标题/pTime 直接落库，字段缺失或时间戳非法的条目会被丢弃。',
    adapterConfig: {
      pageUrl: 'https://www.okx.com/help/section/announcements-api',
      listQueryUrl: 'https://www.okx.com/api/v5/support/announcements',
      annType: 'announcements-api',
      page: 1
    }
  }),
  source({
    sourceId: 'coindesk-rss',
    displayName: 'CoinDesk RSS',
    sourceGroup: 'mainstream-news',
    adapterType: 'rss-poller',
    category: 'mainstream-news',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'rss-v1',
    adapterConfig: { feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/' }
  }),
  source({
    sourceId: 'ethereum-foundation-blog',
    displayName: 'Ethereum Foundation Blog',
    sourceGroup: 'official-source',
    adapterType: 'rss-poller',
    category: 'official-post',
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'rss-v1',
    adapterConfig: { feedUrl: 'https://blog.ethereum.org/feed.xml' }
  }),
  source({
    sourceId: 'sec-rss',
    displayName: 'SEC RSS',
    sourceGroup: 'macro-regulation',
    adapterType: 'rss-poller',
    category: 'regulation',
    defaultScopePolicy: 'all',
    parserStrategy: 'regulator-rss-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    dynamicClassification: true,
    supportedImpactScopes: ['crypto-market', 'symbol'],
    adapterConfig: { feedUrl: 'https://www.sec.gov/news/pressreleases.rss' }
  }),
  source({
    sourceId: 'cftc-rss',
    displayName: 'CFTC RSS',
    sourceGroup: 'macro-regulation',
    adapterType: 'rss-poller',
    category: 'regulation',
    defaultScopePolicy: 'all',
    parserStrategy: 'regulator-rss-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    dynamicClassification: true,
    supportedImpactScopes: ['crypto-market', 'symbol'],
    adapterConfig: { feedUrl: 'https://www.cftc.gov/PressRoom/PressReleases/index.xml' }
  }),
  source({
    sourceId: 'federal-reserve-rss',
    displayName: 'Federal Reserve RSS',
    sourceGroup: 'macro-regulation',
    adapterType: 'rss-poller',
    category: 'macro',
    defaultScopePolicy: 'all',
    parserStrategy: 'fed-rss-v1',
    intelligenceLayer: 'macro',
    dataDomain: 'macro',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    sourceKind: 'official-macro',
    applicabilityMode: 'global',
    focusMarkets: ['global-macro'],
    supportedImpactScopes: ['risk-assets', 'crypto-market', 'market-wide'],
    adapterConfig: { feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml' }
  }),
  source({
    sourceId: 'kraken-system-status',
    displayName: 'Kraken SystemStatus',
    sourceGroup: 'exchange-status',
    adapterType: 'rest-api-poller',
    category: 'exchange-status',
    defaultCollectionPreset: 'frequent',
    defaultScopePolicy: 'active-position-priority',
    parserStrategy: 'kraken-system-status-v1',
    intelligenceLayer: 'exchange',
    dataDomain: 'asset-market',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    adapterConfig: { endpointUrl: 'https://status.kraken.com/api/v2/components.json' }
  }),
  source({
    sourceId: 'policy-path-market',
    displayName: 'Fed Decision Markets',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    // `manual` keeps the generic adapter runtime from arming a poller: the product's own ten-minute
    // job owns this source's cadence, and the profile's enable flag is what that job reads.
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'all',
    supportsSentiment: false,
    authMode: 'none',
    supportsRunNow: false,
    parserStrategy: 'policy-path-market-v1',
    readiness: 'live',
    collectionOwner: 'product',
    readinessNote: '预测市场对下一次 FOMC 会议的隐含概率；由产品自己的采集作业每十分钟读一次，只存衍生读数。',
    adapterConfig: { endpointUrl: 'https://gamma-api.polymarket.com' }
  }),
  source({
    sourceId: 'twelve-data-market',
    displayName: 'Twelve Data (macro market)',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'frequent',
    defaultScopePolicy: 'all',
    supportsSentiment: false,
    authMode: 'api-key',
    supportsRunNow: false,
    parserStrategy: 'twelve-data-time-series-v1',
    // Visible in providerRegistry as well: the agreement is what the registry guard test holds.
    // 用户 2026-11-11：它在看板供数（合成美元 DXY 兜底 + 黄金未收盘覆盖），注册表按事实写「可见 / 就绪」。
    visibility: 'visible',
    readiness: 'live',
    // The macro-market collector is a product job (market-intelligence.collect-macro-market); the
    // profile's enable flag is what that job reads, and the generic runtime never schedules it.
    collectionOwner: 'product',
    readinessNote: '美元（由 ICE 篮子合成）、黄金、离岸人民币与稳定币溢价；由产品自己的采集作业按额度取数。',
    adapterConfig: { endpointUrl: 'https://api.twelvedata.com/time_series', symbols: ['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'USD/SEK', 'USD/CHF', 'XAU/USD', 'USD/CNH', 'USDT/USD'], interval: '15min' }
  }),
  source({
    sourceId: 'realmarketapi-market',
    displayName: 'RealMarketAPI (DXY)',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    // `manual` is the one preset the generic adapter runtime cannot turn into a schedule: the
    // product's own five-minute job owns this source's cadence and budget, and there is no
    // `realmarketapi-dxy-v1` adapter for a generic collector to call. A `frequent` preset here would
    // quietly arm a three-minute unadapted poller beside the job that already collects DXY.
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'all',
    supportsSentiment: false,
    authMode: 'api-key',
    supportsRunNow: false,
    parserStrategy: 'realmarketapi-dxy-v1',
    // `live` is what lets the reader store a key for this source at all.
    readiness: 'live',
    // Collection stays product-owned, exactly like the basket collector's: the product's own
    // `market-intelligence.collect-realmarketapi-dxy` job reads the profile's enable flag, there is no
    // generic `realmarketapi-dxy-v1` adapter, and the manual preset above keeps the generic runtime
    // from arming an unadapted poller beside the job that already collects DXY.
    collectionOwner: 'product',
    readinessNote: '真实 ICE 美元指数（DXY）；由产品自己的采集作业每 5 分钟取一次，未配置或数据失效时回退到 ICE 篮子合成值。',
    adapterConfig: {
      endpointUrl: 'https://api.realmarketapi.com/api/v1/price',
      symbolCode: 'DXY',
      timeFrames: ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'],
      latestTimeFrame: 'M5',
      backfillTimeFrame: 'M15',
      backfillLimit: 100,
      seriesId: 'dxy-real'
    }
  }),
  source({
    sourceId: 'github-releases',
    displayName: 'GitHub Releases',
    sourceGroup: 'official-source',
    adapterType: 'rest-api-poller',
    category: 'official-post',
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'all',
    supportsSentiment: false,
    // GitHub's public releases endpoint answers an anonymous request, so no key is *required*; a token
    // is optional and only raises the anonymous budget (60 requests/hour per IP) — which is why the
    // cadence stays `manual`: enabling the source does not arm a schedule, the reader presses 立即运行,
    // exactly like the Ethereum Foundation blog beside it.
    authMode: 'optional-api-key',
    parserStrategy: 'github-releases-v1',
    readiness: 'live',
    readinessNote:
      'GitHub 公开发布接口（无需凭据即可采集，匿名限流 60 次/小时；也可选填 token 提高额度）。手动采集，每次取最近 3 个 release；草稿与字段缺失/时间戳非法的条目会被丢弃。',
    adapterConfig: { endpointUrl: 'https://api.github.com/repos/ethereum/go-ethereum/releases', perPage: 3 }
  }),
  source({
    sourceId: 'fred',
    displayName: 'FRED (deprecated)',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'all',
    authMode: 'api-key',
    supportsRunNow: false,
    parserStrategy: 'fred-v1',
    readiness: 'planned',
    visibility: 'hidden',
    readinessNote: 'Deprecated. Use fred-rates-liquidity as the canonical FRED macro source.',
    adapterConfig: { endpointUrl: 'https://api.stlouisfed.org/fred/series/observations' }
  }),
  source({
    sourceId: 'cryptopanic',
    displayName: 'CryptoPanic',
    sourceGroup: 'mainstream-news',
    adapterType: 'rest-api-poller',
    category: 'mainstream-news',
    defaultScopePolicy: 'watchlist-priority',
    authMode: 'api-key',
    parserStrategy: 'cryptopanic-v1',
    readiness: 'planned',
    readinessNote: '需实现 CryptoPanic REST 解析与 API Key 采集。',
    adapterConfig: { endpointUrl: 'https://cryptopanic.com/api/v1/posts/' }
  }),
  source({
    sourceId: 'coinmarketcal',
    displayName: 'CoinMarketCal',
    sourceGroup: 'mainstream-news',
    adapterType: 'rest-api-poller',
    category: 'mainstream-news',
    defaultCollectionPreset: 'manual',
    defaultScopePolicy: 'watchlist-priority',
    authMode: 'api-key',
    parserStrategy: 'coinmarketcal-v1',
    readiness: 'planned',
    // Superseded by the calendar feed of the same provider; providerRegistry hides it too.
    visibility: 'hidden',
    readinessNote: '需实现 CoinMarketCal REST 解析与 API Key 采集。',
    adapterConfig: { endpointUrl: 'https://developers.coinmarketcal.com/v1/events' }
  }),
  source({
    sourceId: 'coinbase-status',
    displayName: 'Coinbase Status',
    sourceGroup: 'exchange-status',
    adapterType: 'statuspage-poller',
    category: 'exchange-status',
    defaultCollectionPreset: 'frequent',
    defaultScopePolicy: 'active-position-priority',
    parserStrategy: 'statuspage-v1',
    intelligenceLayer: 'exchange',
    dataDomain: 'asset-market',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    adapterConfig: {
      summaryUrl: 'https://status.coinbase.com/api/v2/summary.json',
      incidentsUrl: 'https://status.coinbase.com/api/v2/incidents.json'
    }
  }),
  source({
    sourceId: 'kraken-status',
    displayName: 'Kraken Status',
    sourceGroup: 'exchange-status',
    adapterType: 'statuspage-poller',
    category: 'exchange-status',
    defaultCollectionPreset: 'frequent',
    defaultScopePolicy: 'active-position-priority',
    parserStrategy: 'statuspage-v1',
    intelligenceLayer: 'exchange',
    dataDomain: 'asset-market',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    adapterConfig: {
      summaryUrl: 'https://status.kraken.com/api/v2/summary.json',
      incidentsUrl: 'https://status.kraken.com/api/v2/incidents.json'
    }
  }),
  source({
    sourceId: 'solana-status',
    displayName: 'Solana Status',
    sourceGroup: 'exchange-status',
    adapterType: 'statuspage-poller',
    category: 'exchange-status',
    defaultCollectionPreset: 'frequent',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'statuspage-v1',
    intelligenceLayer: 'infrastructure',
    dataDomain: 'project',
    reliabilityTier: 'official',
    eventFamily: 'text-event',
    adapterConfig: {
      summaryUrl: 'https://status.solana.com/api/v2/summary.json',
      incidentsUrl: 'https://status.solana.com/api/v2/incidents.json'
    }
  }),
  source({
    sourceId: 'alternative-fear-greed',
    displayName: 'Fear & Greed Index',
    sourceGroup: 'mainstream-news',
    adapterType: 'rest-api-poller',
    category: 'mainstream-news',
    defaultScopePolicy: 'all',
    parserStrategy: 'alternative-fear-greed-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'aggregator',
    eventFamily: 'metric-event',
    readiness: 'live',
    supportedImpactScopes: ['crypto-market'],
    adapterConfig: { endpointUrl: 'https://api.alternative.me/fng/?limit=1' }
  }),
  source({
    sourceId: 'defillama-stablecoins',
    displayName: 'DeFiLlama Stablecoins',
    sourceGroup: 'official-source',
    adapterType: 'rest-api-poller',
    category: 'official-post',
    defaultScopePolicy: 'all',
    parserStrategy: 'capital-conditions-stablecoins-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'aggregator',
    eventFamily: 'metric-event',
    readiness: 'live',
    supportedImpactScopes: [],
    supportsSentiment: false,
    supportsReplay: false,
    adapterConfig: { endpointUrl: 'https://stablecoins.llama.fi/stablecoins' }
  }),
  source({
    sourceId: 'defillama-tvl',
    displayName: 'DeFiLlama TVL',
    sourceGroup: 'official-source',
    adapterType: 'rest-api-poller',
    category: 'official-post',
    defaultScopePolicy: 'all',
    parserStrategy: 'defillama-tvl-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'aggregator',
    eventFamily: 'metric-event',
    readiness: 'live',
    supportedImpactScopes: ['crypto-market', 'sector'],
    adapterConfig: { endpointUrl: 'https://api.llama.fi/v2/chains' }
  }),
  source({
    sourceId: 'binance-spot-market',
    displayName: 'Binance Spot Market',
    sourceGroup: 'exchange-announcement',
    adapterType: 'rest-api-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'binance-spot-market-v1',
    intelligenceLayer: 'asset',
    dataDomain: 'asset-market',
    reliabilityTier: 'exchange-api',
    eventFamily: 'metric-event',
    readiness: 'live',
    readinessNote: '默认采集 ETHUSDT、BTCUSDT；可在来源配置中扩展 monitoredSymbols。',
    supportedImpactScopes: ['symbol', 'watchlist'],
    adapterConfig: {
      endpointUrl: 'https://api.binance.com/api/v3/ticker/24hr',
      symbolParam: 'symbol',
      symbols: ['ETHUSDT', 'BTCUSDT']
    }
  }),
  source({
    sourceId: 'binance-futures-positioning',
    displayName: 'Binance Futures Positioning',
    sourceGroup: 'exchange-announcement',
    adapterType: 'rest-api-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'binance-futures-positioning-v1',
    intelligenceLayer: 'asset',
    dataDomain: 'asset-market',
    reliabilityTier: 'exchange-api',
    eventFamily: 'metric-event',
    readiness: 'live',
    readinessNote: '默认采集 ETHUSDT、BTCUSDT 的资金费率与 15 分钟持仓名义额；可在来源配置中扩展 monitoredSymbols。',
    supportedImpactScopes: ['symbol', 'watchlist'],
    adapterConfig: {
      endpointUrl: 'https://fapi.binance.com/fapi/v1/fundingRate',
      symbolParam: 'symbol',
      symbols: ['ETHUSDT', 'BTCUSDT'],
      metricType: 'funding-rate',
      limit: 22
    }
  }),
  source({
    sourceId: 'deribit-options',
    displayName: 'Deribit Options',
    sourceGroup: 'exchange-announcement',
    adapterType: 'rest-api-poller',
    category: 'exchange-announcement',
    defaultScopePolicy: 'watchlist-priority',
    parserStrategy: 'deribit-options-v1',
    intelligenceLayer: 'asset',
    dataDomain: 'asset-market',
    reliabilityTier: 'exchange-api',
    eventFamily: 'metric-event',
    readiness: 'planned',
    readinessNote: '待接入：需要先解决代理（本机直连不通），再定到期与 delta 口径。',
    supportedImpactScopes: ['symbol', 'watchlist'],
    adapterConfig: { baseUrl: 'https://www.deribit.com/api/v2/public' }
  })
]

export const newsCryptoCatalogEntries = Object.freeze(catalogEntries)
