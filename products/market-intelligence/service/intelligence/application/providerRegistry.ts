import type { MarketFactId } from '../../../contracts/factSources'
import { cryptoEtfProvider } from './cryptoEtfProvider'
import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'
import { providerLinks } from './providerLinks'
import { provider, src } from './sourceDefinitionBuilders'
import { zeroXRouterCalendarSourceIds, zeroXRouterProvider } from './zeroXRouterProvider'

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
   * 这个源**能供哪些事实**（架构师 2026-11-13 裁定：放这里，不放 sourceCatalog）。
   * 解析器判据里有「这个源在不在采」，而那个事实与目标侧是同一份 `SourceView`
   * （`SourceDefinition & { enabled, jobRegistered }`）；放 catalog 就得跨两张表拼，
   * 拼出来的答案和调度器看的不是同一个对象。声明了不等于归你——还要开着、作业真注册着。
   */
  provides?: readonly MarketFactId[]
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
   *
   * **这是实测出来的，不是猜的**（2026-11-12）：对每个源的接口做「直连 vs 经本地代理」对照，
   * 直连拿到**可用的** 2xx/4xx 视为可达；直连 000（DNS/连接失败）或只回一张边缘拦截页的算需要代理。
   * 当天结论：
   * binance / okx / coingecko / coindesk / Polymarket / 以太坊基金会博客 / Coinbase·Kraken·Solana
   * 状态页需要代理；DeFiLlama、美联储、SEC、CFTC、BLS、BEA、财政部、FRED、GitHub、
   * Alternative.me、realmarketapi、Twelve Data 直连可达。
   * **0xRouter 例外（读者 2026-11-12 确认）**：直连虽然回了 403，但那是边缘拦截、不是可用响应，
   * 它的接口实际要经代理才通——按读者口径标 `requiresProxy`，不拿那一张 403 页当「可达」。
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
  /**
   * Which of the provider's sources the credential box belongs to.
   *
   * Derived by default from the first source collected by an adapter, because that used to be the
   * only kind that could hold a key. A source that must be testable while it is deliberately not
   * collectable (`collection: 'none'`) has no such source, so the provider states its anchor here
   * instead of the projection guessing — the guess returning nothing is what makes the key box
   * disappear entirely.
   */
  credentialSourceId?: string
  /**
   * Show the credential-state line on this provider's detail page (未配置 / 已保存待验证 /
   * 连接失败：原因 / 连接正常). A display fact about this provider, deliberately not a notice kind:
   * the notice slot was doing double duty, so a provider that only verified its key also got its
   * collection switch locked — which is wrong the moment the source really collects.
   */
  credentialStateLine?: true
  /** Public home page, opened in the system browser. */
  website?: string
  /** Signup / API-key guide. Replace with the operator's invite link. */
  signupUrl?: string
  /** True when signupUrl carries the operator's invite code. */
  invite?: boolean
  /**
   * 补充说明的**类别**（不是状态、不是句子）：由渲染层映射成两语文案。
   * 加一个同类源 = 在这里标一个值 + 同批加两条文案，不改组件。
   */
  notice?: ProviderNoticeKind
  sources: SourceDefinition[]
}

/** 源详情页头上方的说明横幅类别；新增一种要同时加两语文案（渲染层映射）。 */
export type ProviderNoticeKind =
  | 'private-data-source'
  /* The source is registered and testable but deliberately collects nothing in this build. */
  | 'verification-only'

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
      { groupId: 'spot-momentum', agentId: 'crypto', tier: 'required', sourceIds: ['binance-spot-market', 'coingecko-market', cryptoEtfSourcePolicy.sourceId, 'realmarketapi-market', 'twelve-data-market'] },
      { groupId: 'funding-rate', agentId: 'crypto', tier: 'required', sourceIds: ['binance-futures-positioning'] },
      {
        groupId: 'macro-calendar',
        agentId: 'crypto',
        tier: 'recommended',
        sourceIds: [
          'macro-calendar-fed',
          'macro-calendar-bea',
          'macro-calendar-bls',
          'macro-calendar-narwhal-economic-data',
          'macro-calendar-narwhal-financial-events',
          'macro-calendar-narwhal-central-bank-activities',
          ...zeroXRouterCalendarSourceIds,
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
