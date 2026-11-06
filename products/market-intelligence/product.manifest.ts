import type { ProductManifest } from '../../platform/product-manifest'
import type { NotificationEventDeclaration } from '../../platform/notifications/contracts/notificationEventCatalog'
import { MARKET_ANALYSIS_IPC_METHODS } from './contracts/marketAnalysisIpcContracts'
import { INTELLIGENCE_EVENT_TOPICS } from './contracts/intelligenceEvents'
import { GROUP_MARKET_ANALYSIS_CHANGE_JOB } from './service/intelligence/jobs/marketAnalysisJobIds'
import {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '../../platform/notifications/contracts/platformNotificationEvents'

import { marketIntelligenceNotificationCopy } from './desktop/shared/i18n/text/notifications'
import { moduleSignalPolicy } from './contracts/moduleSignal'
import { intelligenceAgentCapabilities } from './service/intelligence/agent-capabilities/capabilityCatalog'
import { toManifestRegistrations } from './service/intelligence/agent-capabilities/toManifestRegistrations'


/**
 * 声明一条通知事件：**键由 id 机械生成**（平台同一处 `notification.event.<id>.*`）。
 *
 * 不手写键的理由：事件改名时手写的键不会有人同步，目录解析出来就落空——
 * 同一个概念两个名字，接线时才发现。
 */
function notificationEvent(
  id: string,
  input: Omit<NotificationEventDeclaration, 'id' | 'titleKey' | 'reasonKey' | 'bodyKey' | 'bodyKeyByVariant'> & {
    /** 这条事件有正文句（`…body`）。 */
    body?: boolean
    /** 同一事件两种正文时给变体名，键为 `…body.<variant>`。 */
    bodyVariants?: readonly string[]
  }
): NotificationEventDeclaration {
  const { body, bodyVariants, ...rest } = input
  return {
    id,
    titleKey: notificationEventTitleKey(id),
    reasonKey: notificationEventReasonKey(id),
    ...(body ? { bodyKey: notificationEventBodyKey(id) } : {}),
    ...(bodyVariants
      ? { bodyKeyByVariant: Object.fromEntries(bodyVariants.map((variant) => [variant, notificationEventBodyKey(id, variant)])) }
      : {}),
    ...rest
  }
}

export const marketIntelligenceProductManifest = {
  id: 'market-intelligence',
  name: { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' },
  version: '0.3.1',
  description: 'Market intelligence collection, assessment, and workspace.',
  shellContributions: {
    menuPages: [
      {
        id: 'intelligence',
        title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
        icon: 'radar',
        order: 10,
        home: true,
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
      },
      {
        // 设置 → 情报 → 运行日志：这个模块做过什么。从情报源页的标签搬出来，配置与记录各占一页。
        id: 'intelligence-run-log',
        title: { 'zh-CN': '运行日志', 'en-US': 'Run log' },
        icon: 'scroll-text',
        order: 11,
        module: './desktop/settings/run-log'
      },
      {
        // 设置 → 情报 → 通知：只放「这三条推不推手机」，本机两档在通用通知页（界面规范 §9d）。
        id: 'intelligence-notification',
        title: { 'zh-CN': '通知', 'en-US': 'Notifications' },
        icon: 'message-square-text',
        order: 12,
        module: './desktop/settings/intelligence-notification'
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
    { method: marketCalendarPublicPolicy.methods.getCollectionFreshness },
    { method: marketCalendarPublicPolicy.methods.refreshNow },
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
    { method: 'intelligence.syncRuns.aggregates' },
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
    { method: 'intelligence.queryMarketDivergence' },
    { method: 'intelligence.queryModuleSignals' },
    { method: 'intelligence.queryCapitalConditionsSnapshot' },
    { method: 'intelligence.queryFearGreedSnapshot' },
    { method: 'intelligence.dailyBriefing.getToday' },
    { method: 'intelligence.dailyBriefing.list' },
    { method: 'intelligence.dailyBriefing.get' },
    { method: 'intelligence.dailyBriefing.listAttempts' },
    { method: 'intelligence.dailyBriefing.regenerate' },
    { method: 'intelligence.dailyBriefing.publishToPhone' },
    { method: 'intelligence.dailyBriefing.getProgress' },
    { method: 'intelligence.dailyBriefing.getSettings' },
    { method: 'intelligence.dailyBriefing.saveSettings' },
    { method: 'intelligence.dailyBriefing.getStorageState' },
    { method: 'intelligence.dailyBriefing.retryUpgrade' },
    { method: 'intelligence.dailyBriefing.deletePeriod' },
    // 期配置自己的四个方法：读、加、改、删。启动自检按这张清单比注册结果，缺一条就拒绝启动——
    // 这次漏登记的症状是"应用起不来"，而只有用户会撞到，所以顺序也排在一起便于下次核对。
    { method: 'intelligence.dailyBriefing.listPeriods' },
    { method: 'intelligence.dailyBriefing.createPeriod' },
    { method: 'intelligence.dailyBriefing.updatePeriod' },
    { method: 'intelligence.dailyBriefing.removePeriod' },
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
  /**
   * 本产品**发布**的话题（`MI-11-R22` A1）：定时任务从这里选订阅目标。
   * 五个 topic 都有真实生产者（`intelligenceEventPublisher`），与 `INTELLIGENCE_EVENT_TOPICS` 同源。
   */
  eventTopics: [
    'market-intelligence.item.created',
    'market-intelligence.cluster.updated',
    'market-intelligence.impact.created',
    'market-intelligence.sentiment.updated',
    'market-intelligence.source.health.changed'
  ],
  /**
   * 本产品**消费**的话题（`MI-11-R22` A1）。运行时从这里读，不再手写第二份数组——
   * 声明与实现因此不可能漂移。话题本身必须出现在本 manifest 的 `eventTopics` 里（生成期守卫）。
   */
  eventConsumers: [
    {
      id: 'market-intelligence.market-analysis-trigger',
      topics: [
        INTELLIGENCE_EVENT_TOPICS.itemCreated,
        INTELLIGENCE_EVENT_TOPICS.impactCreated,
        INTELLIGENCE_EVENT_TOPICS.sentimentUpdated
      ],
      handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB
    }
  ],
  /**
   * 通知事件声明（契约 §3）。**只声明「这条事件存不存在、能不能发、怎么去重」**，
   * 不声明怎么触发（触发点在运行时，节奏由产品另定）；批准档位在平台批准表里，这里只写申请。
   *
   * 文案只填键、不填句子（句子归营销）：`notification.event.<完整事件 id>.<title|body|reason>`，四个键都由平台生成函数产出，这里不手拼。
   * 去重粒度的出处是情报通知目录 §四之一（`intelligence-notification-catalog.md`），
   * 键形状的出处是契约 §7 / §7.1；这里两处都只引用，不重写清单。
   *
   * **N8 不声明**（2026-11-04 撤回，编号不复用）：判定账本结算不产生通知。留着就是「生产一个没有
   * 批准的事件」，运行时只会以 `unknown-event-type` 拒收。完成类（日报已完成）是读者翻案恢复的，
   * 见下：只进中心、读者在情报页勾了才推手机、桌面不弹。
   */
  notificationEvents: [
    notificationEvent('market-intelligence.briefing.failed', {
      category: 'failure',
      bodyVariants: ['not-generated', 'editorial-missing'],
      requiresUserAction: true,
      requestedDisruptionLevels: ['desktop'],
      dedupeKeyTemplate: 'brief-failed:{date}:{period}',
      dedupeUnit: 'condition',
      conditionWindowMs: 86_400_000,
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.signal.triggered', {
      category: 'reminder',
      // 正文按「规则 × 档位」四个变体；标题是 `{asset} {headline}`，资产名开头。
      bodyVariants: ['etfOutflow', 'etfOutflowAggravated', 'oiDrop', 'oiDropAggravated'],
      requiresUserAction: false,
      // 信息类只走应用内与手机：桌面按「失败 / 需修正 / 系统状态」三类收口，不再申请桌面档。
      requestedDisruptionLevels: ['channel'],
      dedupeKeyBuilder: 'moduleSignal',
      // 键里不带时间（契约 v2.43 §7.4）；窗口数只有一处来源：规则自己的冷却。
      dedupeUnit: 'condition',
      conditionWindowMs: moduleSignalPolicy.intradayCooldownMs,
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.macro.event-landed', {
      category: 'reminder',
      body: true,
      requiresUserAction: false,
      // 同上：信息类不申请桌面档。
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'calendar:{eventId}:{releaseAt}',
      dedupeUnit: 'occurrence',
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.source.consecutive-failed', {
      category: 'needs-action',
      body: true,
      requiresUserAction: true,
      requestedDisruptionLevels: ['desktop'],
      dedupeKeyBuilder: 'sourceIssue',
      dedupeUnit: 'condition',
      conditionWindowMs: 86_400_000,
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.source.stale', {
      category: 'needs-action',
      body: true,
      requiresUserAction: true,
      requestedDisruptionLevels: ['desktop'],
      dedupeKeyBuilder: 'sourceIssue',
      dedupeUnit: 'condition',
      conditionWindowMs: 86_400_000,
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.briefing.ready', {
      category: 'completed',
      body: true,
      requiresUserAction: false,
      requestedDisruptionLevels: [],
      // 一条版次一条提醒：键带日期、期号与语言，同一天两期（或同刻两种语言）各推一条。
      // 仍**不许**混入版本号、生成时刻或内容哈希——否则同一天重新生成会被当成新事件重推。
      dedupeKeyTemplate: 'briefing-ready:{date}:{periodId}:{locale}',
      dedupeUnit: 'occurrence',
      requestedBypassQuietHours: false
    }),
    notificationEvent('market-intelligence.timezone.invalid', {
      category: 'needs-action',
      body: true,
      requiresUserAction: true,
      requestedDisruptionLevels: [],
      dedupeKeyTemplate: 'timezone-invalid:{date}',
      dedupeUnit: 'occurrence',
      requestedBypassQuietHours: false
    })
  ],
  /**
   * 让渡给本产品的 producerId（契约 §14）：日报 job 的终态失败由本产品发
   * `market-intelligence.briefing.failed`，来源采集 job 的失败由本产品发
   * `source.consecutive-failed` / `source.stale`，平台不再为它们发任务失败事件。
   * 键是稳定的 job handler id，不是带期号的 definitionId；两个 handler 各管一类，
   * 采集是所有来源共用同一个 handler。
   */
  notificationProducerClaims: ['market-intelligence.dailyBriefing', 'market-intelligence.collectSource'],
  /** 7 条事件的句子（含「日报已完成」）；平台的装配从这里收表，不 import 本文件（契约 §3.3）。 */
  notificationCopy: marketIntelligenceNotificationCopy,
  migrations: [],
  productAgentTools: toManifestRegistrations(intelligenceAgentCapabilities)
} as const satisfies ProductManifest
import { marketCalendarPublicPolicy } from './contracts/macro/marketCalendarQueryContracts'
import { dashboardFeedStatusPublicPolicy } from './contracts/macro/dashboardFeedStatusContracts'
import { macroMarketSnapshotPublicPolicy } from './contracts/macro/macroMarketSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from './contracts/macro/macroRatesSnapshotContracts'
import { provenanceMethods } from './contracts/provenanceContracts'
