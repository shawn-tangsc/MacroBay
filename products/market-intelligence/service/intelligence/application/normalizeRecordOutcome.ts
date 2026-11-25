import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'
import type { IgnoredRawRecordAudit, RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { SOURCE_CLASSIFIER_VERSION } from './sourceClassifiers/classifyParsedIntelligence'
import type { ClassifiedSourceEvent } from './sourceClassifiers/sourceClassifierTypes'

/** 一条原始记录归一化的落点：产出了条目、被判忽略、或解析完什么也没产出。 */
export type NormalizedRecordOutcome = 'processed' | 'ignored' | 'normalized'

/**
 * 一条原始记录的结局与随之要入队的下游作业（从 `intelligencePipeline` 搬出来，纯搬移）。
 *
 * 三条结局都会把原始记录移出待办（`markNormalized` / `markIgnored`）；「产出条目」的还要把
 * 评估、聚合、翻译入队，新闻源再加抓正文。判断与入队必须写在一处，否则新增一个下游作业时
 * 很容易只改了一条路径。
 */
export function settleNormalizedRecord(input: Readonly<{
  rawRecord: Pick<RawIntelligenceRecord, 'rawRecordId' | 'sourceId'>
  store: Readonly<{
    markNormalized: (rawRecordId: string) => unknown
    markIgnored: (rawRecordId: string, audit: IgnoredRawRecordAudit) => unknown
  }>
  recordProcessed: boolean
  ignoredAudit?: Pick<ClassifiedSourceEvent, 'ignoredReasonCode' | 'eventSubtype'>
  enqueue: (jobId: string) => void
}>): NormalizedRecordOutcome {
  if (input.recordProcessed) {
    input.store.markNormalized(input.rawRecord.rawRecordId)
    input.enqueue('market-intelligence.assessChangedItems')
    input.enqueue('market-intelligence.refreshSentimentAggregates')
    input.enqueue('market-intelligence.translateItems')
    if ((NEWS_SENTIMENT_SOURCE_IDS as readonly string[]).includes(input.rawRecord.sourceId)) {
      input.enqueue('market-intelligence.enrichNewsDocuments')
    }
    return 'processed'
  }
  if (input.ignoredAudit?.ignoredReasonCode) {
    input.store.markIgnored(input.rawRecord.rawRecordId, {
      ignoredReasonCode: input.ignoredAudit.ignoredReasonCode,
      classifierVersion: SOURCE_CLASSIFIER_VERSION,
      classifierNotes: input.ignoredAudit.eventSubtype
    })
    return 'ignored'
  }
  input.store.markNormalized(input.rawRecord.rawRecordId)
  return 'normalized'
}