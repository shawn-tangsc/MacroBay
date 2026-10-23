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

  // Cross-asset interface control is a write surface; only the snapshot read is exposed.
  'intelligence.crossAsset.acquire': excluded('cross-product-write'),
  'intelligence.crossAsset.renew': excluded('cross-product-write'),
  'intelligence.crossAsset.release': excluded('cross-product-write'),
  'intelligence.crossAsset.refresh': excluded('cross-product-write'),
  'intelligence.crossAsset.getSourceConfiguration': excluded('internal-view'),
  'intelligence.crossAsset.testInterface': excluded('raw-payload'),
  'intelligence.crossAsset.cancelInterfaceTest': excluded('internal-view'),
  'intelligence.crossAsset.query': exposed('get_cross_asset_snapshot'),

  'intelligence.macro.marketCalendar.refreshManual': excluded('destructive'),
  'intelligence.macro.marketCalendar.queryMonth': excluded('internal-view'),
  'intelligence.macro.marketSnapshot.query': exposed('get_macro_market_snapshot'),
  'intelligence.macro.dashboardFeedStatus.query': exposed('get_dashboard_feed_status'),
  'intelligence.macro.ratesSnapshot.query': exposed('get_macro_rates_snapshot'),
  'intelligence.provenance.explainFigure': exposed('explain_figure'),

  'intelligence.getDetail': excluded('raw-payload'),
  'intelligence.getEvidenceExcerpt': exposed('get_evidence_excerpt'),
  'intelligence.getMonitoringScope': excluded('user-private-data'),
  'intelligence.getOperationsHealth': exposed('get_operations_health'),
  'intelligence.getSentimentAggregates': excluded('internal-view'),
  'intelligence.getSourceHealth': exposed('get_source_health'),
  'intelligence.getTimeline': exposed('get_intelligence_timeline'),
  'intelligence.getWorkspaceState': excluded('internal-view'),
  'intelligence.getWorkspaceTimeline': exposed('get_intelligence_timeline'),
  'intelligence.ingestEvent': excluded('destructive'),

  'intelligence.macro.economicCalendar.getEventDetail': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderHealth': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderPageState': excluded('internal-view'),
  'intelligence.macro.economicCalendar.getProviderSchedule': excluded('internal-view'),
  'intelligence.macro.economicCalendar.importManualBlsIcs': excluded('destructive'),
  'intelligence.macro.economicCalendar.previewManualBlsIcs': excluded('raw-payload'),
  'intelligence.macro.economicCalendar.queryMonth': exposed('query_macro_calendar'),
  'intelligence.macro.economicCalendar.setReleaseTime': excluded('destructive'),
  'intelligence.macro.economicCalendar.clearReleaseTime': excluded('destructive'),
  'intelligence.macro.economicCalendar.refreshBlsEmploymentRelease': excluded('destructive'),
  'intelligence.macro.economicCalendar.refreshFedFomcDecision': excluded('destructive'),
  'intelligence.macro.economicCalendar.syncBlsEmploymentSchedule': excluded('destructive'),
  'intelligence.macro.economicCalendar.runProviderNow': excluded('destructive'),
  'intelligence.macro.economicCalendar.saveProviderProfile': excluded('destructive'),
  'intelligence.macro.economicCalendar.testProviderConnection': excluded('raw-payload'),

  'intelligence.dashboardSourceConnection.test': excluded('raw-payload'),

  'intelligence.queryImpactTimeline': exposed('query_impact_timeline'),
  'intelligence.queryFundingRateHistory': excluded('internal-view'),
  'intelligence.queryCapitalConditionsSnapshot': excluded('internal-view'),
  'intelligence.queryFearGreedSnapshot': excluded('internal-view'),
  'intelligence.queryRelatedEvents': exposed('query_related_events'),
  'intelligence.querySentimentSeries': exposed('query_sentiment_series'),
  'intelligence.querySentimentSnapshot': exposed('query_sentiment_snapshot'),
  'intelligence.retryItemAssessment': excluded('destructive'),

  'intelligenceSources.getFocusSettings': exposed('list_intelligence_sources'),
  'intelligenceSources.getHealth': exposed('get_source_health'),
  'intelligenceSources.getPageState': excluded('internal-view'),
  'intelligenceSources.revealCredential': excluded('returns-plaintext-credential'),
  'intelligenceSources.setCalendarEnabled': excluded('destructive'),
  'intelligenceSources.getSettingsView': excluded('internal-view'),
  'intelligenceSources.getAgentView': excluded('internal-view'),
  'intelligenceSources.getPanelView': excluded('internal-view'),
  'intelligenceSources.listDefinitions': exposed('list_intelligence_sources'),
  'intelligenceSources.listProfiles': exposed('list_intelligence_sources'),
  'intelligenceSources.replayWindow': excluded('destructive'),
  'intelligenceSources.runNow': excluded('destructive'),
  'intelligenceSources.saveFocusSettings': excluded('destructive'),
  'intelligenceSources.saveProfile': excluded('destructive'),
  'intelligenceSources.setEnabled': excluded('destructive'),
  'intelligenceSources.testConnection': excluded('raw-payload'),
  'intelligenceSources.testCredentials': excluded('returns-plaintext-credential'),

  'intelligenceTranslation.getModuleStatus': exposed('get_translation_status'),
  'intelligenceTranslation.getSettings': exposed('get_translation_status'),
  'intelligenceTranslation.getStatus': exposed('get_translation_status'),
  'intelligenceTranslation.queueMissing': excluded('destructive'),
  'intelligenceTranslation.retryFailed': excluded('destructive'),
  'intelligenceTranslation.saveSettings': excluded('destructive')
}
