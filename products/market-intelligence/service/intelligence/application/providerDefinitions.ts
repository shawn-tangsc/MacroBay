import { cryptoEtfProvider } from './cryptoEtfProvider'
import type { ProviderDefinition } from './providerRegistryTypes'
import { provider, src } from './sourceDefinitionBuilders'
import { zeroXRouterCalendarSourceIds, zeroXRouterProvider } from './zeroXRouterProvider'

/**
 * **来源定义表**：每个提供方、每个源的一行声明。纯数据，不含逻辑。
 *
 * 两条规则不在这里，在 `sourceDefinitionBuilders.ts`：`panels` 由 `purposes` 派生，
 * `providerId` 由 `provider()` 填。表里只写「这个源是什么」，不写「它怎么出现」。
 */

export const providerDefinitions: readonly ProviderDefinition[] = [
  provider({
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    sources: [
      src({ sourceId: 'macro-calendar-fed', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-fed', displayName: 'Fed official schedule', purposes: ['dashboard', 'calendar', 'briefing'], collection: 'provider', kind: 'official-calendar', capabilities: { runNow: 'provider', testConnection: true } }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'federal-reserve-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.federal-reserve-rss', displayName: 'Fed RSS', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'federal-reserve-rss' })
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
      // 实测（2026-11-12）：`gamma-api.polymarket.com` / `clob.polymarket.com` 直连 000、经代理 200。
      requiresProxy: true,
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
    sources: [src({ sourceId: 'sec-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.sec-rss', displayName: 'SEC press releases', visibility: 'advanced', purposes: ['dashboard', 'briefing', 'sentiment'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'sec-rss' })]
  }),
  provider({
    providerId: 'cftc',
    displayName: 'CFTC',
    category: 'macro',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'cftc-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.cftc-rss', displayName: 'CFTC press releases', visibility: 'advanced', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'cftc-rss' })]
  }),
  provider({
    providerId: 'binance',
    displayName: 'Binance',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'binance-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-announcements', displayName: 'Binance announcements', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-announcements' }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'binance-api-updates', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-api-updates', displayName: 'Binance API updates', requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-api-updates' }),
      src({ purposes: ['analysis'], sourceId: 'binance-spot-market', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-spot-market', displayName: 'Binance spot market', requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-spot-market' }),
      src({ sourceId: 'binance-futures-positioning', summaryKey: 'settings.intelligenceSources.sourceSummary.binance-futures-positioning', displayName: 'Binance futures positioning', purposes: ['dashboard', 'briefing'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'binance-futures-positioning' })
    ]
  }),
  provider({
    providerId: 'okx',
    displayName: 'OKX',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'okx-latest-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.okx-latest-announcements', displayName: 'OKX latest announcements', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'okx-latest-announcements' }),
      src({ purposes: ['analysis'], sourceId: 'okx-api-announcements', summaryKey: 'settings.intelligenceSources.sourceSummary.okx-api-announcements', displayName: 'OKX API announcements', requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'okx-api-announcements' })
    ]
  }),
  provider({
    providerId: 'coingecko',
    displayName: 'CoinGecko',
    category: 'crypto',
    credential: 'none',
    sources: [src({ purposes: ['analysis'], sourceId: 'coingecko-market', summaryKey: 'settings.intelligenceSources.sourceSummary.coingecko-market', displayName: 'CoinGecko market', requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'coingecko-market' })]
  }),
  provider({
    providerId: 'defillama',
    displayName: 'DeFiLlama',
    category: 'crypto',
    credential: 'none',
    sources: [
      src({ sourceId: 'defillama-stablecoins', summaryKey: 'settings.intelligenceSources.sourceSummary.defillama-stablecoins', displayName: 'DeFiLlama stablecoins', purposes: ['dashboard', 'briefing'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'defillama-stablecoins' }),
      src({ purposes: ['analysis'], sourceId: 'defillama-tvl', summaryKey: 'settings.intelligenceSources.sourceSummary.defillama-tvl', displayName: 'DeFiLlama TVL', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'defillama-tvl' })
    ]
  }),
  cryptoEtfProvider,
  provider({
    providerId: 'alternative-me',
    displayName: 'Alternative.me',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'alternative-fear-greed', summaryKey: 'settings.intelligenceSources.sourceSummary.alternative-fear-greed', displayName: 'Fear & Greed Index', purposes: ['dashboard', 'briefing'], capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'alternative-fear-greed' })]
  }),
  provider({
    providerId: 'deribit',
    displayName: 'Deribit',
    category: 'crypto',
    credential: 'none',
    website: 'https://www.deribit.com',
    sources: [src({
      sourceId: 'deribit-options',
      summaryKey: 'settings.intelligenceSources.sourceSummary.deribit-options',
      displayName: 'Deribit options',
      // 待接入期不给用途：`panels` 由 `purposes` 派生，声明 dashboard 会让它出现在面板源清单里，
      // 而它既不在任何 agent 分组、也打不开开关（`providerRegistry.test.ts` 的 panel⊆agent 判据）。
      // 接入那笔改成 `['dashboard']` 并按需加 agent 分组（见 178 文档 §3.9 / §8 第 17 项）。
      purposes: [],
      visibility: 'pending',
      readiness: 'planned',
      collection: 'none',
      requiresProxy: true,
      capabilities: { runNow: 'none', testConnection: false },
      adapterRef: 'deribit-options'
    })]
  }),
  provider({
    providerId: 'coindesk',
    displayName: 'CoinDesk',
    category: 'crypto',
    credential: 'none',
    sources: [src({ sourceId: 'coindesk-rss', summaryKey: 'settings.intelligenceSources.sourceSummary.coindesk-rss', displayName: 'CoinDesk RSS', visibility: 'advanced', purposes: ['dashboard', 'briefing', 'sentiment'], requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'coindesk-rss' })]
  }),
  provider({
    providerId: 'ethereum-foundation',
    displayName: 'Ethereum Foundation',
    category: 'crypto',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'ethereum-foundation-blog', summaryKey: 'settings.intelligenceSources.sourceSummary.ethereum-foundation-blog', displayName: 'Ethereum Foundation blog', visibility: 'advanced', requiresProxy: true, capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'ethereum-foundation-blog' })]
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
  zeroXRouterProvider,
  provider({
    providerId: 'narwhal',
    displayName: 'Narwhal',
    category: 'aggregate',
    credential: 'api-key',
    /* 加源规范：官网按钮只按数据画，没有地址就不出现（用户 2026-11-13 点出 Narwhal 缺这颗）。
       注册页地址没有实测到，所以只填官网；填一个猜的注册页比少一颗按钮更糟。 */
    website: 'https://narwhalapi.com',
    /* **已解锁**（2026-11-13，读者报「我没打开它却在采」）：三条 feed 由产品作业采集、`readiness: 'live'`，
       所以必须**可见**——读者看得见、关得掉，关掉采集就停；看不见却已经在采是最糟的形状。
       默认给开（目录里逐源声明 `defaultEnabled`），否则解锁那一瞬间反而会停采。
       **仍不进** `AUTOMATIC_CALENDAR_FEED_IDS`：采集由日历线自己的作业拥有，通用自动刷新名单里加一条
       Narwhal 就会去刷一个不对应的调度器。
       密钥挂在第一条 feed 上：三条派生不出「哪条能测」，猜不到 key 框就整个不见了。 */
    /* **不需要代理**：2026-11-13 实测（上海电信出口 114.86.125.53、无代理），直连
       `api.narwhalapi.com`（Cloudflare 104.21.74.143 / 172.67.203.142）带 key 打日历接口
       1.83s 拿到 200 与真实 releases，不带 key 401。**这是实测，不是推断**——所以三条源都不写
       `requiresProxy`，设置页也就不该出现那枚 VPN 标签。别凭印象加回去。
       （顺带：读者配不配代理是另一件事，和源本身能不能直连不是一个判断。） */
    credentialSourceId: 'macro-calendar-narwhal-economic-data',
    sources: [
      src({ purposes: ['dashboard', 'calendar', 'briefing'], sourceId: 'macro-calendar-narwhal-economic-data', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-narwhal-economic-data', displayName: 'Narwhal economic data', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: true } }),
      src({ purposes: ['dashboard', 'calendar', 'briefing'], sourceId: 'macro-calendar-narwhal-financial-events', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-narwhal-financial-events', displayName: 'Narwhal financial events', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: true } }),
      src({ purposes: ['dashboard', 'calendar', 'briefing'], sourceId: 'macro-calendar-narwhal-central-bank-activities', summaryKey: 'settings.intelligenceSources.sourceSummary.macro-calendar-narwhal-central-bank-activities', displayName: 'Narwhal central bank activities', collection: 'job', kind: 'market-calendar', readiness: 'live', capabilities: { runNow: 'job', testConnection: true } })
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
    sources: [src({ sourceId: 'twelve-data-market', summaryKey: 'settings.intelligenceSources.sourceSummary.twelve-data-market', displayName: 'Twelve Data macro market', purposes: ['dashboard'], visibility: 'visible', readiness: 'live', collection: 'none', capabilities: { runNow: 'none', testConnection: true }, adapterRef: 'twelve-data-market' })]
  }),
  provider({
    providerId: 'coinbase',
    displayName: 'Coinbase',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'coinbase-status', summaryKey: 'settings.intelligenceSources.sourceSummary.coinbase-status', displayName: 'Coinbase status', visibility: 'advanced', requiresProxy: true, kind: 'status', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'coinbase-status' })]
  }),
  provider({
    providerId: 'kraken',
    displayName: 'Kraken',
    category: 'system',
    credential: 'none',
    sources: [
      src({ purposes: [], maintenanceOnly: true, sourceId: 'kraken-status', summaryKey: 'settings.intelligenceSources.sourceSummary.kraken-status', displayName: 'Kraken status', visibility: 'advanced', requiresProxy: true, kind: 'status', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'kraken-status' }),
      src({ purposes: [], maintenanceOnly: true, sourceId: 'kraken-system-status', summaryKey: 'settings.intelligenceSources.sourceSummary.kraken-system-status', displayName: 'Kraken system status', visibility: 'advanced', requiresProxy: true, kind: 'status', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'kraken-system-status' })
    ]
  }),
  provider({
    providerId: 'solana',
    displayName: 'Solana',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'solana-status', summaryKey: 'settings.intelligenceSources.sourceSummary.solana-status', displayName: 'Solana status', visibility: 'advanced', requiresProxy: true, kind: 'status', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'solana-status' })]
  }),
  provider({
    providerId: 'github',
    displayName: 'GitHub',
    category: 'system',
    credential: 'none',
    sources: [src({ purposes: [], maintenanceOnly: true, sourceId: 'github-releases', summaryKey: 'settings.intelligenceSources.sourceSummary.github-releases', displayName: 'GitHub releases', visibility: 'advanced', capabilities: { runNow: 'adapter', testConnection: true }, adapterRef: 'github-releases' })]
  })
]
