import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'

/**
 * 饿死诊断：新闻原始记录进来、却超过一天还没归一化出来。
 *
 * 2026-11-21 的事故里，采集全绿、新闻却停在两天前——这条数字是唯一能在运行记录里看见的信号。
 * 放在独立模块里，既给归一化返回的 `staleNewsCount` 用，也方便后续界面/告警复用同一判据。
 */
export const staleNewsRecordPolicy = Object.freeze({ staleAfterMs: 24 * 60 * 60 * 1_000 })

export function countStaleNewsRecords(
  records: readonly RawIntelligenceRecord[],
  nowMs: number = Date.now()
): number {
  const newsSources: readonly string[] = NEWS_SENTIMENT_SOURCE_IDS
  return records
    .filter(record => newsSources.includes(record.sourceId))
    .filter(record => nowMs - Date.parse(record.detectedAt) > staleNewsRecordPolicy.staleAfterMs)
    .length
}
