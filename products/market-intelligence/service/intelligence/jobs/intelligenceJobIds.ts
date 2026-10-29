export const INTELLIGENCE_COLLECT_SOURCE_JOB = 'market-intelligence.collectSource'
export const INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB = 'market-intelligence.normalizeRawRecords'
export const INTELLIGENCE_TRANSLATE_ITEMS_JOB = 'market-intelligence.translateItems'
export const INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB = 'market-intelligence.assessChangedItems'
export const INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB = 'market-intelligence.refreshSentimentAggregates'
export const INTELLIGENCE_REEVALUATE_CLUSTERS_JOB = 'market-intelligence.reevaluateClusters'
export const INTELLIGENCE_REEVALUATE_SENTIMENT_SCOPES_JOB = 'market-intelligence.reevaluateSentimentScopes'
export const INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB = 'market-intelligence.enrichNewsDocuments'
export const INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB = 'market-intelligence.scoreNewsSentiment'
export const INTELLIGENCE_ARCHIVE_COMPACTION_JOB = 'market-intelligence.archiveCompaction'
export const INTELLIGENCE_PARQUET_EXPORT_JOB = 'market-intelligence.parquetExport'
export const INTELLIGENCE_PURGE_JOB = 'market-intelligence.purge'
export const INTELLIGENCE_REPLAY_WINDOW_JOB = 'market-intelligence.replayWindow'
export const INTELLIGENCE_REINDEX_JOB = 'market-intelligence.reindex'
export const INTELLIGENCE_DAILY_BRIEFING_JOB = 'market-intelligence.dailyBriefing'

export const INTELLIGENCE_JOB_IDS = [
  INTELLIGENCE_COLLECT_SOURCE_JOB,
  INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
  INTELLIGENCE_TRANSLATE_ITEMS_JOB,
  INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB,
  INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB,
  INTELLIGENCE_REEVALUATE_CLUSTERS_JOB,
  INTELLIGENCE_REEVALUATE_SENTIMENT_SCOPES_JOB,
  INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB,
  INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB,
  INTELLIGENCE_ARCHIVE_COMPACTION_JOB,
  INTELLIGENCE_PARQUET_EXPORT_JOB,
  INTELLIGENCE_PURGE_JOB,
  INTELLIGENCE_REPLAY_WINDOW_JOB,
  INTELLIGENCE_REINDEX_JOB,
  INTELLIGENCE_DAILY_BRIEFING_JOB
] as const
