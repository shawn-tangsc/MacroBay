import type { ProductManifest } from '../../platform/product-manifest'
import { MARKET_ANALYSIS_IPC_METHODS } from './contracts/marketAnalysisIpcContracts'

const marketIntelligenceQueryScopeSchema = {
  type: 'object',
  properties: {
    canonicalInstrumentId: { type: 'string' },
    venue: { type: 'string' },
    symbol: { type: 'string' },
    asset: { type: 'string' },
    sector: { type: 'string' },
    market: { type: 'string' }
  }
} as const

const marketIntelligenceQueryFiltersSchema = {
  type: 'object',
  properties: {
    layers: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['macro', 'industry', 'asset', 'exchange', 'project', 'infrastructure']
      }
    },
    sourceIds: { type: 'array', items: { type: 'string' } },
    directions: {
      type: 'array',
      items: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'mixed'] }
    },
    minConfidence: { type: 'number' },
    horizon: { type: 'string', enum: ['15m', '1h', '4h', '24h'] }
  }
} as const

const marketIntelligenceTimeBoundInputSchema = {
  type: 'object',
  required: ['asOf'],
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    lookbackWindowMs: { type: 'number' },
    maxItems: { type: 'number' },
    scope: marketIntelligenceQueryScopeSchema,
    filters: marketIntelligenceQueryFiltersSchema
  }
} as const

const marketIntelligenceQueryOutputSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'queryId',
    'queryType',
    'asOf',
    'servedAt',
    'resultHash',
    'scope',
    'timeWindow',
    'confidence',
    'caveats',
    'sourceCoverage',
    'evidenceRefs',
    'data'
  ],
  properties: {
    schemaVersion: { type: 'number' },
    queryId: { type: 'string' },
    queryType: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    servedAt: { type: 'string', format: 'date-time' },
    resultHash: { type: 'string' },
    scope: marketIntelligenceQueryScopeSchema,
    timeWindow: {
      type: 'object',
      required: ['to'],
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        lookbackWindowMs: { type: 'number' }
      }
    },
    confidence: { type: 'number' },
    caveats: { type: 'array', items: { type: 'string' } },
    sourceCoverage: { type: 'array', items: { type: 'object' } },
    evidenceRefs: { type: 'array', items: { type: 'object' } },
    data: { type: 'object' }
  }
} as const

const marketIntelligenceEvidenceInputSchema = {
  type: 'object',
  required: ['asOf'],
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    evidenceRefId: { type: 'string' },
    itemId: { type: 'string' },
    impactId: { type: 'string' },
    clusterId: { type: 'string' },
    maxExcerptChars: { type: 'number' }
  }
} as const

const marketAnalysisContextInputSchema = {
  type: 'object',
  required: ['eventGroupId', 'asOf'],
  properties: {
    eventGroupId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    domains: {
      type: 'array',
      items: { type: 'string', enum: ['macro', 'capital', 'sentiment', 'funding', 'cross-asset'] }
    },
    maxFacts: { type: 'integer', minimum: 1 }
  }
} as const

/**
 * The two macro snapshot tools take no arguments: they answer with what the product's store holds
 * *now*, which is what the panel's 市场状态 block renders. They therefore declare no temporal
 * boundary — there is no historical read to bound — and neither may start an analysis on its own
 * (`autoTriggerAllowed` stays false for both sources in the admission matrix).
 */
const macroSnapshotEmptyInputSchema = { type: 'object', properties: {} } as const

const macroMarketSnapshotOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    asOf: { type: 'string', format: 'date-time' },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seriesId', 'level', 'atMs', 'returns'],
        properties: {
          seriesId: { type: 'string' },
          level: { type: 'number' },
          atMs: { type: 'integer' },
          returns: { type: 'object' },
          synthetic: { type: 'boolean' },
          live: { type: 'object' }
        }
      }
    },
    caveats: { type: 'array', items: { type: 'string' } }
  }
} as const

const provenanceExplainInputSchema = {
  type: 'object',
  properties: { family: { type: 'string' } }
} as const

/** 两种状态：给了族名 → 该族的口径与现值；没给 → 索引（有哪些族可查）。 */
const provenanceExplainOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    family: { type: 'string' },
    nameKey: { type: 'string' },
    formula: { type: 'object' },
    values: { type: 'object' },
    index: { type: 'string' },
    families: { type: 'array', items: { type: 'string' } },
    notOnThisSide: { type: 'array', items: { type: 'string' } }
  }
} as const

const macroRatesSnapshotOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'empty', 'unavailable'] },
    asOf: { type: 'string', format: 'date-time' },
    readings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seriesId', 'metricKey', 'actual', 'period'],
        properties: {
          seriesId: { type: 'string' },
          metricKey: { type: 'string' },
          actual: { type: 'number' },
          previous: { type: 'number' },
          period: { type: 'string' }
        }
      }
    },
    caveats: { type: 'array', items: { type: 'string' } }
  }
} as const

const marketAnalysisContextOutputSchema = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['available', 'unavailable'] },
    schemaVersion: { type: 'integer' },
    profileId: { type: 'string' },
    eventGroupId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    dataCutoff: { type: 'string', format: 'date-time' },
    snapshotId: { type: ['string', 'null'] },
    snapshotHash: { type: ['string', 'null'] },
    facts: { type: 'array', items: { type: 'object' } },
    missingDomains: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'array', items: { type: 'string' } },
    evidenceRefs: { type: 'array', items: { type: 'object' } },
    sourceHealth: { type: 'array', items: { type: 'object' } },
    domainAccess: { type: 'array', items: { type: 'object' } },
    errorCode: { type: 'string' }
  }
} as const

const marketIntelligenceAgentToolDefaults = {
  timeoutMs: 10_000,
  maxOutputBytes: 64_000
} as const

export const marketIntelligenceProductManifest = {
  id: 'market-intelligence',
  name: { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' },
  version: '0.1.0',
  description: 'Market intelligence collection, assessment, and workspace.',
  shellContributions: {
    menuPages: [
      {
        id: 'intelligence',
        title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
        icon: 'message-square-text',
        order: 10,
        module: './desktop/pages/intelligence'
      }
    ],
    settingsSections: [
      {
        id: 'intelligence-sources',
        title: { 'zh-CN': '情报源', 'en-US': 'Intelligence Sources' },
        icon: 'database',
        order: 10,
        module: './desktop/settings/intelligence-sources'
      }
    ]
  },
  routes: [],
  navigation: [],
  settingsSections: [],
  serviceRoutes: [
    ...Object.values(MARKET_ANALYSIS_IPC_METHODS).map(method => ({ method })),
    { method: 'intelligence.crossAsset.acquire' },
    { method: 'intelligence.crossAsset.renew' },
    { method: 'intelligence.crossAsset.release' },
    { method: 'intelligence.crossAsset.refresh' },
    { method: 'intelligence.crossAsset.getSourceConfiguration' },
    { method: 'intelligence.crossAsset.testInterface' },
    { method: 'intelligence.crossAsset.cancelInterfaceTest' },
    { method: 'intelligence.crossAsset.query' },
    { method: marketCalendarPublicPolicy.methods.refresh },
    { method: marketCalendarPublicPolicy.methods.query },
    { method: macroMarketSnapshotPublicPolicy.method },
    { method: dashboardFeedStatusPublicPolicy.method },
    { method: macroRatesSnapshotPublicPolicy.method },
    // 口径查询（设计 144）：只读，agent 侧按需问"这个数从哪来"。
    { method: provenanceMethods.explainFigure },
    { method: 'intelligence.getDetail' },
    { method: 'intelligence.getEvidenceExcerpt' },
    { method: 'intelligence.getMonitoringScope' },
    { method: 'intelligence.getOperationsHealth' },
    { method: 'intelligence.getSentimentAggregates' },
    { method: 'intelligence.getSourceHealth' },
    { method: 'intelligence.getTimeline' },
    { method: 'intelligence.getWorkspaceState' },
    { method: 'intelligence.getWorkspaceTimeline' },
    { method: 'intelligence.ingestEvent' },
    { method: 'intelligence.macro.economicCalendar.getEventDetail' },
    { method: 'intelligence.macro.economicCalendar.getProviderHealth' },
    { method: 'intelligence.macro.economicCalendar.getProviderPageState' },
    { method: 'intelligence.macro.economicCalendar.getProviderSchedule' },
    { method: 'intelligence.macro.economicCalendar.importManualBlsIcs' },
    { method: 'intelligence.macro.economicCalendar.previewManualBlsIcs' },
    { method: 'intelligence.macro.economicCalendar.queryMonth' },
    // The reader's own release time: every registered product method must be in this sealed
    // baseline, in the order main registers it.
    { method: 'intelligence.macro.economicCalendar.setReleaseTime' },
    { method: 'intelligence.macro.economicCalendar.clearReleaseTime' },
    { method: 'intelligence.macro.economicCalendar.refreshBlsEmploymentRelease' },
    { method: 'intelligence.macro.economicCalendar.refreshFedFomcDecision' },
    { method: 'intelligence.macro.economicCalendar.syncBlsEmploymentSchedule' },
    { method: 'intelligence.macro.economicCalendar.runProviderNow' },
    { method: 'intelligence.macro.economicCalendar.saveProviderProfile' },
    { method: 'intelligence.macro.economicCalendar.testProviderConnection' },
    { method: 'intelligence.dashboardSourceConnection.test' },
    { method: 'intelligence.queryImpactTimeline' },
    { method: 'intelligence.queryFundingRateHistory' },
    { method: 'intelligence.queryCapitalConditionsSnapshot' },
    { method: 'intelligence.queryFearGreedSnapshot' },
    { method: 'intelligence.queryRelatedEvents' },
    { method: 'intelligence.querySentimentSeries' },
    { method: 'intelligence.querySentimentSnapshot' },
    { method: 'intelligence.retryItemAssessment' },
    { method: 'intelligenceSources.getFocusSettings' },
    { method: 'intelligenceSources.getHealth' },
    { method: 'intelligenceSources.getPageState' },
    { method: 'intelligenceSources.revealCredential' },
    { method: 'intelligenceSources.setCalendarEnabled' },
    { method: 'intelligenceSources.getSettingsView' },
    { method: 'intelligenceSources.getAgentView' },
    { method: 'intelligenceSources.getPanelView' },
    { method: 'intelligenceSources.listDefinitions' },
    { method: 'intelligenceSources.listProfiles' },
    { method: 'intelligenceSources.replayWindow' },
    { method: 'intelligenceSources.runNow' },
    { method: 'intelligenceSources.saveFocusSettings' },
    { method: 'intelligenceSources.saveProfile' },
    { method: 'intelligenceSources.setEnabled' },
    { method: 'intelligenceSources.testConnection' },
    { method: 'intelligenceSources.testCredentials' },
    { method: 'intelligenceTranslation.getModuleStatus' },
    { method: 'intelligenceTranslation.getSettings' },
    { method: 'intelligenceTranslation.getStatus' },
    { method: 'intelligenceTranslation.queueMissing' },
    { method: 'intelligenceTranslation.retryFailed' },
    { method: 'intelligenceTranslation.saveSettings' }
  ],
  tools: [
    { id: 'get_market_analysis_context', title: '市场分析上下文', description: '读取带时间边界的市场分析事实。', module: './tools/market-analysis-context' },
    { id: 'get_macro_market_snapshot', title: '美元与黄金快照', description: '读取美元指数与黄金的最新水平及窗口变化。', module: './tools/macro-market-snapshot' },
    { id: 'get_macro_rates_snapshot', title: '美债日频利率', description: '读取 FRED 的 10Y/实际利率/2Y/盈亏平衡通胀日频读数。', module: './tools/macro-rates-snapshot' },
    { id: 'explain_figure', title: '数字来源与算式', description: '读取某个数的来源、观测时刻与算式（不带参数则列出可查的族）。', module: './tools/provenance-explain' }
  ],
  skills: [
    { id: 'market-analysis-skill-v1', title: '市场影响分析', description: '使用可追溯证据生成条件式市场分析。', module: './agents/skills/market-analysis' }
  ],
  agents: [
    {
      id: 'crypto-market-analyst',
      title: '数字货币市场解读员',
      description: '基于可追溯市场证据生成条件式分析。',
      seedModule: './agents/agents/cryptoMarketAnalyst',
      seedOnStartup: true,
      skillIds: ['market-analysis-skill-v1'],
      toolIds: ['get_market_analysis_context', 'get_macro_market_snapshot', 'get_macro_rates_snapshot'],
      workflowIds: ['market-analysis-auto-run-v1']
    }
  ],
  workflows: [
    {
      id: 'market-analysis-auto-run-v1',
      title: '市场分析自动运行',
      description: '在隔离分析运行中冻结上下文并写入时间轴。',
      module: './agents/workflows/market-analysis-auto-run-v1',
      agentIds: ['crypto-market-analyst']
    }
  ],
  policies: [],
  evaluations: [],
  jobHandlers: [
    { id: 'market-intelligence.collectSource' },
    { id: 'market-intelligence.normalizeRawRecords' },
    { id: 'market-intelligence.translateItems' },
    { id: 'market-intelligence.assessChangedItems' },
    { id: 'market-intelligence.refreshSentimentAggregates' },
    { id: 'market-intelligence.reevaluateClusters' },
    { id: 'market-intelligence.reevaluateSentimentScopes' },
    { id: 'market-intelligence.archiveCompaction' },
    { id: 'market-intelligence.parquetExport' },
    { id: 'market-intelligence.purge' },
    { id: 'market-intelligence.replayWindow' },
    { id: 'market-intelligence.reindex' },
    { id: 'market-intelligence.refreshMacroCalendar' },
    { id: 'market-intelligence.refreshBeaOfficialReleases' }
  ],
  eventConsumers: [],
  migrations: [],
  productAgentTools: [
    {
      toolName: 'get_market_analysis_context',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-market-analysis-context',
      inputSchema: marketAnalysisContextInputSchema,
      outputSchema: marketAnalysisContextOutputSchema,
      schemaVersion: 1,
      description: '读取带时间边界的市场分析五域事实上下文。',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      timeoutMs: 5_000,
      maxOutputBytes: 256 * 1024
    },
    {
      toolName: 'get_macro_market_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-macro-market-snapshot',
      inputSchema: macroSnapshotEmptyInputSchema,
      outputSchema: macroMarketSnapshotOutputSchema,
      schemaVersion: 1,
      description: '读取市场状态块的美元与黄金快照：美元指数最新水平与 15m/1h/4h/24h 窗口变化，以及黄金最新价。限制：美元正线来自 RealMarketAPI 的 ICE 美元指数（dxy-real，5 分钟，与面板同一份存储）；只有该源没有数据点、或本产品用 ICE 篮子合成的 dxy-synthetic 确实比它更新时才回退到合成值（reading 带 synthetic 标记，结果带 synthetic-dollar-index caveat），合成值不得当作官方 ICE 指数引用；真实那条停在收盘（例如周末 FX 休市）时仍显示它，不换仪器；黄金的 live 价是未收盘的实时 tick（约 90 秒新鲜度），不是已收盘 bar，也不参与任何窗口计算；窗口缺失表示该序列无法回答该窗口，不代表 0。数据是「现在」的读数，没有历史 asOf 参数。只读，不触发分析。',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'on-sensitive',
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    },
    {
      toolName: 'explain_figure',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.explain-figure',
      inputSchema: provenanceExplainInputSchema,
      outputSchema: provenanceExplainOutputSchema,
      schemaVersion: 1,
      description: '回答「这个数从哪来、怎么算的」：给出该族的来源路线、观测时刻规则、算式，以及**这次回答现读**的阈值与现值，让模型能原原本本复述前因后果。不带 family 调用返回可查族的索引。限制：算式与数字在回答时向 owner 现读，不是这份说明里的快照，所以复述时必须引用返回里的数值；有一族（日频行的 bp 取整）在渲染侧，不在本进程，问到它要明说不在这一侧、不要替它编来源。只读，不触发分析，不要时间边界。',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'on-sensitive',
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    },
    {
      toolName: 'get_macro_rates_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-macro-rates-snapshot',
      inputSchema: macroSnapshotEmptyInputSchema,
      outputSchema: macroRatesSnapshotOutputSchema,
      schemaVersion: 1,
      description: '读取 FRED 的四条日频利率序列：10Y 名义收益率(DGS10)、10Y 实际利率(DFII10)、2Y 收益率(DGS2)、10Y 盈亏平衡通胀(T10YIE)，每条带观察日 period(YYYY-MM-DD)与可用时的上一交易日 previous。限制：这是官方**日频收盘**，每个交易日一个观测，可能滞后数个交易日，周末与美国休市日没有新值；它不能解释盘中波动，结果带 official-daily-close caveat；previous 缺失表示没有上一交易日读数，不是 0；没有读数的序列直接缺席（该行显示未接入），不会以 0 或上一日值填充。数据是「现在」的读数，没有历史 asOf 参数。只读，不触发分析。',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'on-sensitive',
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    },
    {
      toolName: 'query_sentiment_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-snapshot',
      inputSchema: marketIntelligenceTimeBoundInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Query sentiment snapshot visible at a historical asOf timestamp.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      ...marketIntelligenceAgentToolDefaults
    },
    {
      toolName: 'query_sentiment_series',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-series',
      inputSchema: marketIntelligenceTimeBoundInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Query sentiment series visible at a historical asOf timestamp.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      ...marketIntelligenceAgentToolDefaults
    },
    {
      toolName: 'query_related_events',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-related-events',
      inputSchema: marketIntelligenceTimeBoundInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Query related market intelligence events at asOf.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      ...marketIntelligenceAgentToolDefaults
    },
    {
      toolName: 'query_impact_timeline',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-impact-timeline',
      inputSchema: marketIntelligenceTimeBoundInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Query impact timeline visible at asOf.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      ...marketIntelligenceAgentToolDefaults
    },
    {
      toolName: 'get_source_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      inputSchema: marketIntelligenceTimeBoundInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Get intelligence source health summary visible at asOf.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'never',
      ...marketIntelligenceAgentToolDefaults
    },
    {
      toolName: 'get_evidence_excerpt',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-evidence-excerpt',
      inputSchema: marketIntelligenceEvidenceInputSchema,
      outputSchema: marketIntelligenceQueryOutputSchema,
      schemaVersion: 1,
      description: 'Get a renderer-safe evidence excerpt for one intelligence item at asOf.',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive',
      ...marketIntelligenceAgentToolDefaults
    }
  ]
} as const satisfies ProductManifest
import { marketCalendarPublicPolicy } from './contracts/macro/marketCalendarQueryContracts'
import { dashboardFeedStatusPublicPolicy } from './contracts/macro/dashboardFeedStatusContracts'
import { macroMarketSnapshotPublicPolicy } from './contracts/macro/macroMarketSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from './contracts/macro/macroRatesSnapshotContracts'
import { provenanceMethods } from './contracts/provenanceContracts'
