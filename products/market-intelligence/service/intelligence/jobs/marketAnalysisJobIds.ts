export const GROUP_MARKET_ANALYSIS_CHANGE_JOB = 'market-intelligence.groupMarketAnalysisChange'
export const FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB = 'market-intelligence.freezeMarketAnalysisSnapshot'
export const RUN_MARKET_ANALYSIS_JOB = 'market-intelligence.runMarketAnalysis'
export const VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB = 'market-intelligence.verifyMarketAnalysisPredictions'
export const ANALYSIS_SESSION_SLOTS_JOB = 'market-intelligence.analysisSessionSlots'
export const RECOVER_MARKET_ANALYSIS_RUNS_JOB = 'market-intelligence.recoverMarketAnalysisRuns'

export const MARKET_ANALYSIS_JOB_IDS = [
  GROUP_MARKET_ANALYSIS_CHANGE_JOB, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, RUN_MARKET_ANALYSIS_JOB,
  VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB
] as const
