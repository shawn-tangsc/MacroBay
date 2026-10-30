import type { ProductManifest } from '../../platform/product-manifest'
import { MARKET_ANALYSIS_IPC_METHODS } from './contracts/marketAnalysisIpcContracts'

import { intelligenceAgentCapabilities } from './service/intelligence/agent-capabilities/capabilityCatalog'
import { toManifestRegistrations } from './service/intelligence/agent-capabilities/toManifestRegistrations'

export const marketIntelligenceProductManifest = {
  id: 'market-intelligence',
  name: { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' },
  version: '0.3.0',
  description: 'Market intelligence collection, assessment, and workspace.',
  shellContributions: {
    menuPages: [
      {
        id: 'intelligence',
        title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
        icon: 'radar',
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
    // 示例模式的控制面：读状态与开关。数据面不登记新方法——示例数据按既有读取接口回放。
    { method: 'intelligence.demo.getState' },
    { method: 'intelligence.demo.setActive' },
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
    { method: 'intelligence.getNewsSentiment' },
    { method: 'intelligence.getNewsSentimentItem' },
    { method: 'intelligence.getNewsSentimentSettings' },
    { method: 'intelligence.saveNewsSentimentSettings' },
    { method: 'intelligence.rescoreNewsSentiment' },
    { method: 'intelligence.rebuildNewsSentiment' },
    { method: 'intelligence.translateNewsSentimentBody' },
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
    { method: 'intelligence.macro.policyPath.read' },
    { method: 'intelligence.syncRuns.list' },
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
    { method: 'intelligence.queryOpenInterestHistory' },
    { method: 'intelligence.queryCapitalConditionsSnapshot' },
    { method: 'intelligence.queryFearGreedSnapshot' },
    { method: 'intelligence.dailyBriefing.getToday' },
    { method: 'intelligence.dailyBriefing.list' },
    { method: 'intelligence.dailyBriefing.get' },
    { method: 'intelligence.dailyBriefing.regenerate' },
    { method: 'intelligence.dailyBriefing.getSettings' },
    { method: 'intelligence.dailyBriefing.saveSettings' },
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
    { id: 'get_policy_path', title: 'Fed 利率路径', description: '读取下次 FOMC 会议的区间、市场定价、SEP 中位路径与上次票型。', module: './tools/policy-path' },
    { id: 'explain_figure', title: '数字来源与算式', description: '读取某个数的来源、观测时刻与算式（不带参数则列出可查的族）。', module: './tools/provenance-explain' }
  ],
  skills: [
    { id: 'market-analysis-skill-v1', title: '市场影响分析', description: '使用可追溯证据生成条件式市场分析。', module: './agents/skills/market-analysis' },
    {
      id: 'daily-brief-editor-skill-v1',
      title: '每日简报 AI 编辑',
      description: '以交易分析师视角决定日报候选的展示与 why，缺失结论可带来源补查。',
      module: './agents/skills/daily-brief-editor'
    },
    {
      id: 'intelligence-ops-skill-v1',
      title: '情报运维',
      description: '先读后写、一次一改、凭据不经过模型。',
      module: './agents/skills/intelligence-ops'
    }
  ],
  agents: [
    {
      id: 'crypto-market-analyst',
      title: '数字货币市场解读员',
      description: '基于可追溯市场证据生成条件式分析。',
      seedModule: './agents/agents/cryptoMarketAnalyst',
      seedOnStartup: true,
      skillIds: ['market-analysis-skill-v1', 'intelligence-ops-skill-v1'],
      toolIds: ['get_market_analysis_context', 'get_macro_market_snapshot', 'get_macro_rates_snapshot', 'get_policy_path', 'explain_figure'],
      workflowIds: ['market-analysis-auto-run-v1']
    },
    {
      id: 'daily-brief-editor',
      title: '每日简报编辑',
      description: '以交易分析师视角决定日报候选可见性并生成编辑层。',
      seedModule: './agents/agents/dailyBriefEditor',
      seedOnStartup: true,
      skillIds: ['daily-brief-editor-skill-v1'],
      toolIds: [],
      workflowIds: []
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
    { id: 'market-intelligence.enrichNewsDocuments' },
    { id: 'market-intelligence.scoreNewsSentiment' },
    { id: 'market-intelligence.archiveCompaction' },
    { id: 'market-intelligence.parquetExport' },
    { id: 'market-intelligence.purge' },
    { id: 'market-intelligence.replayWindow' },
    { id: 'market-intelligence.reindex' },
    { id: 'market-intelligence.refreshMacroCalendar' },
    { id: 'market-intelligence.refreshBeaOfficialReleases' },
    { id: 'market-intelligence.dailyBriefing' }
  ],
  eventConsumers: [],
  migrations: [],
  productAgentTools: toManifestRegistrations(intelligenceAgentCapabilities)
} as const satisfies ProductManifest
import { marketCalendarPublicPolicy } from './contracts/macro/marketCalendarQueryContracts'
import { dashboardFeedStatusPublicPolicy } from './contracts/macro/dashboardFeedStatusContracts'
import { macroMarketSnapshotPublicPolicy } from './contracts/macro/macroMarketSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from './contracts/macro/macroRatesSnapshotContracts'
import { provenanceMethods } from './contracts/provenanceContracts'
