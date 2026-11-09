import type { CapabilityId } from './capabilityCatalog'

export type ExclusionReason =
  | 'destructive'
  | 'returns-plaintext-credential'
  | 'raw-payload'
  | 'cross-product-write'
  | 'internal-view'
  | 'user-private-data'

export type CoverageDecision =
  | Readonly<{ state: 'exposed'; capabilityId: CapabilityId }>
  | Readonly<{ state: 'excluded'; reason: ExclusionReason }>

const exposed = (capabilityId: CapabilityId): CoverageDecision => ({ state: 'exposed', capabilityId })
const excluded = (reason: ExclusionReason): CoverageDecision => ({ state: 'excluded', reason })

/**
 * Every method in `marketIntelligenceProductManifest.serviceRoutes` gets an explicit decision
 * (design 152 §2.2). A new IPC route without an entry fails the coverage test: adding an endpoint
 * must be a deliberate choice about whether the agent may see it, never an accident.
 *
 * `internal-view` means the route exists to compose a product panel rather than to answer a question;
 * the capability surface answers questions through the public-query/provenance adapters instead.
 */
export const intelligenceCapabilityCoverage: Readonly<Record<string, CoverageDecision>> = {
  // Analysis runs and predictions: the analysis agent owns this conversation state itself.
  'marketAnalysis.listTimeline': excluded('internal-view'),
  'marketAnalysis.getTimelineEntry': excluded('internal-view'),
  'marketAnalysis.getAnalysisRun': excluded('user-private-data'),
  'marketAnalysis.getSummary': excluded('internal-view'),
  'marketAnalysis.listPredictions': excluded('internal-view'),
  'marketAnalysis.startFollowUp': excluded('destructive'),
  'marketAnalysis.getWorkspaceBinding': excluded('internal-view'),
  'marketAnalysis.requestInitialAnalysis': excluded('destructive'),
  'marketAnalysis.getLatestAttempt': excluded('internal-view'),
  'marketAnalysis.calendarEventContext': excluded('internal-view'),
  'marketAnalysis.getSettings': excluded('user-private-data'),
  'marketAnalysis.saveSettings': excluded('destructive'),

  // Cross-asset lease control is the write surface; the configuration view stays internal.
  'intelligence.crossAsset.acquire': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.renew': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.release': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.refresh': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.getSourceConfiguration': excluded('internal-view'),
  'intelligence.crossAsset.testInterface': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.cancelInterfaceTest': exposed('configure_cross_asset_interface'),
  'intelligence.crossAsset.query': exposed('get_cross_asset_snapshot'),

  'intelligence.macro.marketCalendar.refreshManual': excluded('destructive'),
  'intelligence.macro.marketCalendar.queryMonth': exposed('query_macro_calendar'),
  // The freshness read is what the briefing consumes; an agent asking "how old is the
  // calendar" is the same read, so it rides the existing calendar query capability.
  'intelligence.macro.marketCalendar.getCollectionFreshness': exposed('query_macro_calendar'),
  // Spends provider requests on the reader's behalf; the briefing asks for it, an agent does not.
  'intelligence.macro.marketCalendar.refreshNow': excluded('destructive'),
  'intelligence.macro.marketSnapshot.query': exposed('get_macro_market_snapshot'),
  'intelligence.macro.dashboardFeedStatus.query': exposed('get_dashboard_feed_status'),
  'intelligence.macro.ratesSnapshot.query': exposed('get_macro_rates_snapshot'),
  'intelligence.provenance.explainFigure': exposed('explain_figure'),

  // 示例模式的控制面：只服务面板开关，agent 没有理由去切读者的示例会话。
  'intelligence.demo.getState': excluded('internal-view'),
  'intelligence.demo.setActive': excluded('internal-view'),

  'intelligence.getDetail': excluded('raw-payload'),
  'intelligence.getEvidenceExcerpt': exposed('get_evidence_excerpt'),
  'intelligence.getMonitoringScope': excluded('user-private-data'),
  'intelligence.getOperationsHealth': exposed('get_operations_health'),
  'intelligence.getSentimentAggregates': excluded('internal-view'),
  // The news sentiment panel is composed by the workbench, not answered as an agent question.
  'intelligence.getNewsSentiment': exposed('query_news_sentiment'),
  'intelligence.getNewsSentimentItem': exposed('get_news_sentiment_item'),
  'intelligence.getNewsSentimentSettings': excluded('internal-view'),
  'intelligence.saveNewsSentimentSettings': excluded('internal-view'),
  'intelligence.rescoreNewsSentiment': excluded('internal-view'),
  'intelligence.rebuildNewsSentiment': excluded('internal-view'),
  'intelligence.translateNewsSentimentBody': excluded('internal-view'),
  'intelligence.getSourceHealth': exposed('get_source_health'),
  'intelligence.getTimeline': exposed('get_intelligence_timeline'),
  // 读者点按钮发通知：读的是他的结论、发的是他的通道，不对代理人开放。
  // 下面那条是同一件事的另一半：**点击前**读「有没有可用通道」（0 条不摆按钮、多条点了才拒绝），
  // 只回答配置事实、不带通道名。一条读一条发，都不对代理人开放。
  'intelligence.sendAnalysisConclusion': excluded('internal-view'),
  'intelligence.getAnalysisConclusionSendChannel': excluded('internal-view'),
  // 同类：设置页那三枚「发一条…」读产品数据、发读者通道，是读者动作，不对代理人开放。
  'intelligence.sendTestNotification': excluded('internal-view'),
  'intelligence.getWorkspaceState': excluded('internal-view'),
  'intelligence.getWorkspaceTimeline': exposed('get_intelligence_timeline'),
  'intelligence.ingestEvent': excluded('destructive'),

  'intelligence.macro.economicCalendar.getEventDetail': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderHealth': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderPageState': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderSchedule': excluded('internal-view'),
  'intelligence.macro.economicCalendar.importManualBlsIcs': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.previewManualBlsIcs': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.queryMonth': exposed('query_macro_calendar'),
  // The policy row is a dashboard read; the Agent reaches the same facts through the calendar tool.
  'intelligence.macro.policyPath.read': exposed('get_policy_path'),
  // Declared by 2d16872 without its coverage row; the panel reads it, no agent tool exists yet.
  'intelligence.queryOpenInterestHistory': excluded('internal-view'),
  // The divergence card's own read: the reader sees it on the dashboard; the Agent gets the same
  // judgement as an analysis fact instead of calling the view.
  'intelligence.queryMarketDivergence': excluded('internal-view'),
  // The chips the dashboard draws, with each signal's analysis state; the analysis reads its own
  // facts, not this panel view.
  'intelligence.queryModuleSignalRead': excluded('internal-view'),
  'intelligence.getNewsPushOutletState': excluded('internal-view'),
  'intelligence.setNewsPushOutletEnabled': excluded('internal-view'),
  // 舆情推送的强度门槛：同一条设置页上的读数，agent 没有理由替读者改。
  'intelligence.getNewsPushThreshold': excluded('internal-view'),
  'intelligence.saveNewsPushThreshold': excluded('internal-view'),
  // 日历提醒的读写只服务这一屏的设置表单：agent 没有理由替读者改「提前多久」。
  'intelligence.getCalendarReminderSettings': excluded('internal-view'),
  'intelligence.setCalendarReminderSettings': excluded('internal-view'),
  'intelligence.syncRuns.list': excluded('internal-view'),
  // The same panel's per-day counts: a reader-facing view with no agent tool behind it.
  'intelligence.syncRuns.aggregates': excluded('internal-view'),
  'intelligence.macro.economicCalendar.setReleaseTime': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.clearReleaseTime': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.refreshBlsEmploymentRelease': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.refreshFedFomcDecision': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.syncBlsEmploymentSchedule': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.runProviderNow': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.saveProviderProfile': exposed('operate_macro_calendar'),
  'intelligence.macro.economicCalendar.testProviderConnection': exposed('operate_macro_calendar'),

  'intelligence.dashboardSourceConnection.test': excluded('raw-payload'),

  'intelligence.queryImpactTimeline': exposed('query_impact_timeline'),
  'intelligence.queryFundingRateHistory': excluded('internal-view'),
  'intelligence.queryCapitalConditionsSnapshot': excluded('internal-view'),
  'intelligence.queryFearGreedSnapshot': excluded('internal-view'),
  'intelligence.dailyBriefing.getToday': excluded('internal-view'),
  'intelligence.dailyBriefing.list': excluded('internal-view'),
  'intelligence.dailyBriefing.get': excluded('internal-view'),
  'intelligence.dailyBriefing.listAttempts': excluded('internal-view'),
  'intelligence.dailyBriefing.regenerate': excluded('internal-view'),
  'intelligence.dailyBriefing.getProgress': excluded('internal-view'),
  'intelligence.dailyBriefing.getSettings': excluded('user-private-data'),
  'intelligence.dailyBriefing.saveSettings': excluded('user-private-data'),
  'intelligence.dailyBriefing.getStorageState': excluded('internal-view'),
  'intelligence.dailyBriefing.retryUpgrade': excluded('internal-view'),
  'intelligence.dailyBriefing.deletePeriod': excluded('user-private-data'),
  // 期配置的四个写入口与"发到手机"：改的是读者自己的排期、发的是读者自己的渠道，
  // 都属于用户私有数据，不交给智能体。补齐原先漏登记的五条（路由早已在 manifest 里注册）。
  'intelligence.dailyBriefing.listPeriods': excluded('user-private-data'),
  'intelligence.dailyBriefing.createPeriod': excluded('user-private-data'),
  'intelligence.dailyBriefing.updatePeriod': excluded('user-private-data'),
  'intelligence.dailyBriefing.removePeriod': excluded('user-private-data'),
  'intelligence.dailyBriefing.publishToPhone': excluded('user-private-data'),
  'intelligence.queryRelatedEvents': exposed('query_related_events'),
  'intelligence.querySentimentSeries': exposed('query_sentiment_series'),
  'intelligence.querySentimentSnapshot': exposed('query_sentiment_snapshot'),
  'intelligence.retryItemAssessment': exposed('operate_intelligence_source'),

  'intelligenceSources.getFocusSettings': exposed('list_intelligence_sources'),
  'intelligenceSources.getHealth': exposed('get_source_detail'),
  'intelligenceSources.getPageState': excluded('internal-view'),
  'intelligenceSources.revealCredential': excluded('returns-plaintext-credential'),
  'intelligenceSources.setCalendarEnabled': excluded('destructive'),
  'intelligenceSources.getSettingsView': excluded('internal-view'),
  'intelligenceSources.getAgentView': excluded('internal-view'),
  'intelligenceSources.getPanelView': excluded('internal-view'),
  'intelligenceSources.listDefinitions': exposed('list_intelligence_sources'),
  'intelligenceSources.listProfiles': exposed('list_intelligence_sources'),
  /**
   * **仅维护，读者端无入口**：这是出事之后「按新规则重算历史」的维护动作，产出不是给读者读的
   * 东西——设置页那个壳已删（`8e72898`），能力与 IPC 原样保留。别照 `destructive` 反推出
   * 「本来该有个入门」，然后给它补一个入口。
   */
  'intelligenceSources.replayWindow': excluded('destructive'),
  'intelligenceSources.runNow': exposed('operate_intelligence_source'),
  'intelligenceSources.saveFocusSettings': exposed('configure_intelligence_source'),
  'intelligenceSources.saveProfile': exposed('configure_intelligence_source'),
  'intelligenceSources.setEnabled': exposed('configure_intelligence_source'),
  'intelligenceSources.testConnection': exposed('operate_intelligence_source'),
  'intelligenceSources.testCredentials': excluded('returns-plaintext-credential'),

  'intelligenceTranslation.getModuleStatus': exposed('get_translation_status'),
  'intelligenceTranslation.getSettings': exposed('get_translation_status'),
  'intelligenceTranslation.getStatus': exposed('get_translation_status'),
  'intelligenceTranslation.queueMissing': exposed('configure_translation'),
  'intelligenceTranslation.retryFailed': exposed('configure_translation'),
  'intelligenceTranslation.saveSettings': exposed('configure_translation')
}
