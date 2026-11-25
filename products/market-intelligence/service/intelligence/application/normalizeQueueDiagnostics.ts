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

/**
 * 积压诊断：还停在「已接收」、而且已经超过一天没被处理过的记录。
 *
 * 与 `staleNewsCount` 分开是因为两者漏的东西不一样：那条只盯新闻，这条盯**队列本身动没动**。
 * 2026-11-21 的事故里队列是整体卡死的（930 条、含 730 条行情记录），只盯新闻会漏掉另一半。
 * 判据是「产出」而不是「采集成功率」——采集全绿、队列不动，正是那次被静默盖住的样子。
 */
export const staleReceivedRecordPolicy = Object.freeze({ staleAfterMs: 24 * 60 * 60 * 1_000 })

export type NormalizeQueueDiagnostics = Readonly<{
  /** 超过一天还没归一化出来的新闻原始记录数。 */
  staleNewsCount: number
  /** 超过一天还停在「已接收」的原始记录数（不分来源）。 */
  staleReceivedCount: number
}>

export function describeNormalizeQueue(
  records: readonly RawIntelligenceRecord[],
  nowMs: number = Date.now()
): NormalizeQueueDiagnostics {
  return {
    staleNewsCount: countStaleNewsRecords(records, nowMs),
    staleReceivedCount: records
      .filter(record => record.processingState === 'received')
      .filter(record => nowMs - Date.parse(record.detectedAt) > staleReceivedRecordPolicy.staleAfterMs)
      .length
  }
}
