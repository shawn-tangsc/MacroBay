/**
 * 目录条目：**宏观官方源与日历聚合源**这一组（FRED / BLS / BEA / 财政部 / Narwhal / 0xRouter…）。
 */
import type { IntelligenceSourceCatalogEntry } from '../schema/intelligenceSource'
import { source } from './sourceCatalogEntryFactory'
import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'
import { BEA_MACRO_ADAPTER_CONFIG, BLS_MACRO_ADAPTER_CONFIG, FRED_MACRO_ADAPTER_CONFIG, TREASURY_MACRO_ADAPTER_CONFIG } from './macroSourceCatalogMetadata'
import { narwhalSourcePolicy } from './narwhalSourcePolicy'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

const catalogEntries: IntelligenceSourceCatalogEntry[] = [
  source({
    sourceId: 'bls-economic-series',
    displayName: 'BLS Economic Series',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'balanced',
    defaultScopePolicy: 'all',
    parserStrategy: 'bls-economic-series-v1',
    intelligenceLayer: 'macro',
    dataDomain: 'macro',
    reliabilityTier: 'official',
    eventFamily: 'metric-event',
    authMode: 'optional-api-key',
    readiness: 'fixture-ready',
    readinessNote: '指标解析与影响规则已就绪；BLS registration key 可选，未配置时按公开限额采集，可用 fixture 重放验证。',
    supportedImpactScopes: ['risk-assets', 'crypto-market', 'symbol'],
    adapterConfig: { ...BLS_MACRO_ADAPTER_CONFIG }
  }),
  source({
    sourceId: 'bea-economic-series',
    displayName: 'BEA Economic Series',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'balanced',
    defaultScopePolicy: 'all',
    parserStrategy: 'bea-economic-series-v1',
    intelligenceLayer: 'macro',
    dataDomain: 'macro',
    reliabilityTier: 'official',
    eventFamily: 'metric-event',
    authMode: 'api-key',
    readiness: 'planned',
    readinessNote: '需实现 beaEconomicSeriesParser（GDP/PCE）与 BEA API 凭证配置。',
    supportedImpactScopes: ['risk-assets', 'crypto-market'],
    adapterConfig: { ...BEA_MACRO_ADAPTER_CONFIG }
  }),
  source({
    sourceId: 'fred-rates-liquidity',
    displayName: 'FRED Rates & Liquidity',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'balanced',
    defaultScopePolicy: 'all',
    parserStrategy: 'fred-rates-liquidity-v1',
    intelligenceLayer: 'macro',
    dataDomain: 'macro',
    reliabilityTier: 'official',
    eventFamily: 'metric-event',
    authMode: 'api-key',
    // Configurable: the reader enables it here and pastes a key; the generic metric runtime collects
    // it on the macro cadence, and a missing key is a runtime validation issue rather than a
    // silently scheduled request.
    readiness: 'live',
    readinessNote: 'Official daily close (DGS2/DGS10/DFII10/T10YIE). Trading-day granularity only; needs an API key before the runtime collects it.',
    supportedImpactScopes: ['risk-assets', 'crypto-market'],
    adapterConfig: { ...FRED_MACRO_ADAPTER_CONFIG }
  }),
  source({
    sourceId: 'treasury-fiscal-data',
    displayName: 'Treasury Fiscal Data',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    category: 'macro',
    defaultCollectionPreset: 'balanced',
    defaultScopePolicy: 'all',
    parserStrategy: 'treasury-fiscal-data-v1',
    intelligenceLayer: 'macro',
    dataDomain: 'macro',
    reliabilityTier: 'official',
    eventFamily: 'metric-event',
    readiness: 'planned',
    readinessNote:
      '保持未启用：配置的 /v1/accounting/od/* 路径实测 404，数据集已迁至 /v1/accounting/dts/*；且原 account_type 过滤条件（Treasury General Account）在真实响应中匹配 0 行，取值字段 close_today_bal 实测为 "null"。需先修数据路径、过滤条件与取值字段，故不随本次点亮。',
    supportedImpactScopes: ['risk-assets', 'crypto-market'],
    adapterConfig: { ...TREASURY_MACRO_ADAPTER_CONFIG }
  }),
  source({
    sourceId: 'coingecko-market',
    displayName: 'CoinGecko Market',
    sourceGroup: 'mainstream-news',
    adapterType: 'rest-api-poller',
    category: 'mainstream-news',
    defaultScopePolicy: 'all',
    parserStrategy: 'coingecko-market-v1',
    intelligenceLayer: 'industry',
    dataDomain: 'crypto-market',
    reliabilityTier: 'aggregator',
    eventFamily: 'metric-event',
    // CoinGecko's public `/api/v3/global` answers without a key; the declared credential was never
    // what the endpoint needed, so the reader only switches the source on.
    authMode: 'none',
    readiness: 'live',
    readinessNote:
      'CoinGecko 公开全球市场指标（无需凭据，公共接口限流）。每 10 分钟采集总市值/24h 成交额/BTC 占比；聚合口径，缺失或非数值字段会被丢弃。',
    supportedImpactScopes: ['crypto-market', 'sector'],
    adapterConfig: { endpointUrl: 'https://api.coingecko.com/api/v3/global' }
  }),
  source({
    sourceId: cryptoEtfSourcePolicy.sourceId, displayName: 'CryptoETF ETF flows', sourceGroup: 'aggregate-data-provider',
    adapterType: 'rest-api-poller', category: 'mainstream-news', parserStrategy: 'cryptoetf-etf-funds-v1',
    intelligenceLayer: 'industry', dataDomain: 'crypto-market', reliabilityTier: 'aggregator', authMode: 'api-key',
    // Round 1: reachable and testable, deliberately collectable by nothing yet — both stated, neither implied.
    readiness: 'live', supportsRunNow: false, supportsSentiment: false, supportsReplay: false, collectionOwner: 'product',
    readinessNote: 'BTC/ETH 现货 ETF 每日净流入（T+1，逐基金可对账）；由产品自有刷新任务按 10 分钟采集，读数只取定稿交易日。',
    adapterConfig: { baseUrl: cryptoEtfSourcePolicy.apiBaseUrl }, requestGovernance: cryptoEtfSourcePolicy.requestGovernance
  }),
  /* Narwhal 三条：**已登记、可验证密钥、本版不采集**（与 CryptoETF 第一轮同一形状）。
     登记进目录的原因很具体：凭证保存走 `testCredentials -> requireDefinition -> getIntelligenceSourceDefinition`，
     只认目录里的源；没有这张条目，填了有效 key 点保存会抛「Unknown intelligence source」。
     `readiness: 'planned'` 让 `supportsRunNow` 恒为 false——没有采集器就不许出现「立即采集」。 */
  source({
    sourceId: narwhalSourcePolicy.sourceId, displayName: 'Narwhal economic data', sourceGroup: 'aggregate-data-provider',
    adapterType: 'rest-api-poller', category: 'macro', parserStrategy: 'narwhal-calendar-economic-data-v1',
    reliabilityTier: 'aggregator', authMode: 'api-key', readiness: 'live', defaultEnabled: true,
    /* 采集在跑（作业由日历线自己的调度器拥有），所以这里必须同笔开 `supportsRunNow`：
       跨表审计要求 `provider.runNow !== 'none'` ↔ `catalog.supportsRunNow === true`，否则
       `run-now-disagreement` 红。`readiness` 也不能留在 planned——它会把 `supportsRunNow` 强制成 false。 */
    supportsRunNow: true,
    supportsSentiment: false, supportsReplay: false, collectionOwner: 'product',
    adapterConfig: { baseUrl: narwhalSourcePolicy.baseUrl, calendarPath: narwhalSourcePolicy.calendarPath }
  }),
  source({
    sourceId: 'macro-calendar-narwhal-financial-events', displayName: 'Narwhal financial events', sourceGroup: 'aggregate-data-provider',
    adapterType: 'rest-api-poller', category: 'macro', parserStrategy: 'narwhal-calendar-financial-events-v1',
    reliabilityTier: 'aggregator', authMode: 'api-key', readiness: 'live', defaultEnabled: true,
    /* 采集在跑（作业由日历线自己的调度器拥有），所以这里必须同笔开 `supportsRunNow`：
       跨表审计要求 `provider.runNow !== 'none'` ↔ `catalog.supportsRunNow === true`，否则
       `run-now-disagreement` 红。`readiness` 也不能留在 planned——它会把 `supportsRunNow` 强制成 false。 */
    supportsRunNow: true,
    supportsSentiment: false, supportsReplay: false, collectionOwner: 'product',
    adapterConfig: { baseUrl: narwhalSourcePolicy.baseUrl, calendarPath: narwhalSourcePolicy.calendarPath }
  }),
  source({
    sourceId: 'macro-calendar-narwhal-central-bank-activities', displayName: 'Narwhal central bank activities', sourceGroup: 'aggregate-data-provider',
    adapterType: 'rest-api-poller', category: 'macro', parserStrategy: 'narwhal-calendar-central-bank-activities-v1',
    reliabilityTier: 'aggregator', authMode: 'api-key', readiness: 'live', defaultEnabled: true,
    /* 采集在跑（作业由日历线自己的调度器拥有），所以这里必须同笔开 `supportsRunNow`：
       跨表审计要求 `provider.runNow !== 'none'` ↔ `catalog.supportsRunNow === true`，否则
       `run-now-disagreement` 红。`readiness` 也不能留在 planned——它会把 `supportsRunNow` 强制成 false。 */
    supportsRunNow: true,
    supportsSentiment: false, supportsReplay: false, collectionOwner: 'product',
    adapterConfig: { baseUrl: narwhalSourcePolicy.baseUrl, calendarPath: narwhalSourcePolicy.calendarPath }
  }),
  source({
    sourceId: zeroXRouterSourcePolicy.sourceId,
    displayName: '0xRouter',
    sourceGroup: zeroXRouterSourcePolicy.sourceGroup,
    adapterType: 'rest-api-poller',
    category: 'mainstream-news',
    defaultScopePolicy: 'all',
    authMode: 'api-key',
    defaultCollectionPreset: 'balanced',
    supportsSentiment: false,
    supportsRunNow: false,
    supportsReplay: false,
    parserStrategy: '0xrouter-etf-flow-history-current-state-v1',
    readiness: 'live',
    // 0xRouter's own refresh services collect it, exactly like the macro-market job; the flag used to
    // be a source-id exemption and is now this declaration.
    collectionOwner: 'product',
    readinessNote: 'Only BTC/ETH ETF current-state refresh is authorized; generic collection and Run Now remain unavailable.',
    adapterConfig: { probeContract: zeroXRouterSourcePolicy.connectionProbe.contract },
    requestGovernance: zeroXRouterSourcePolicy.requestGovernance
  })
]

export const macroMarketCatalogEntries = Object.freeze(catalogEntries)
