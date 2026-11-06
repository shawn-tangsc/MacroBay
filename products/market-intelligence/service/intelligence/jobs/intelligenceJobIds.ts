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

/** 一个来源都定位不到的一次性任务用这个来源段，而不是编一个来源名。 */
export const TRANSLATION_JOB_GLOBAL_SCOPE = 'global'

/**
 * 翻译任务的来源级定义 id：`market-intelligence.translateItems.<sourceId>`。
 *
 * 以前每批都拼上时间戳与随机数，于是同一件事每次换一个身份：历史归不拢，
 * 「这个来源最近成功率多少」也永远算不出来。定义 id 是给读者按任务聚合用的，
 * 所以它只能由来源决定——两处各拼一次，迟早长得不一样，因此只许在这里生成。
 *
 * 平台不会按 id 去重：同一来源接连两批仍然是两次运行，各占一行记录。
 */
export function translationJobDefinitionId(sourceId: string | undefined): string {
  return `${INTELLIGENCE_TRANSLATE_ITEMS_JOB}.${sourceId || TRANSLATION_JOB_GLOBAL_SCOPE}`
}

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
