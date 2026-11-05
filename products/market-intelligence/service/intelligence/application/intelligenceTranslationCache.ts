import type { IntelligenceTranslationRecord } from '../schema/intelligenceTranslation'

/**
 * 翻译缓存的两件纯事：**这份缓存占多少字节**、以及**保留期之后还该留哪些记录**。
 *
 * 抽在一处是因为它们回答的是同一件事的两个面（缓存有多大 / 该多小），而且都不需要
 * 任何服务依赖。留在服务里会让装配根为了量一个字节去 import 整个翻译服务，也让保留期规则
 * 和它的字节口径隔着一百行。
 */

export type TranslationRetentionMode = 'compact' | 'balanced' | 'extended'

/** 保留天数：三档口径写在一处，预览与真正清理必须读同一个数。 */
export function translationRetentionDays(retentionMode: TranslationRetentionMode): number {
  return retentionMode === 'compact' ? 7 : retentionMode === 'extended' ? 90 : 30
}

/**
 * The cached volume as the cache page measures it: the JSON payload the store writes on disk.
 * One implementation, so inspect, clear and compact cannot disagree about what a byte is.
 */
export function translationRecordsBytes(records: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify(records), 'utf8')
}

/**
 * 保留期之后仍留下的记录：已失效/失败的按期保留，`not-required` 直接丢，翻好的只留仍在台面上的条目。
 * `now` 可注入，测试不必等一天。
 */
export function buildTranslationCompactionPlan(input: Readonly<{
  records: IntelligenceTranslationRecord[]
  retentionMode: TranslationRetentionMode
  /** 仍出现在台面上的条目 id：它们译过的记录不按时间清掉。 */
  hotItemIds: ReadonlySet<string>
  now: number
}>): Readonly<{ next: IntelligenceTranslationRecord[]; removedCount: number }> {
  const cutoff = input.now - translationRetentionDays(input.retentionMode) * 24 * 60 * 60 * 1000
  const next = input.records.filter((record) => {
    const timestamp = record.translatedAt ? new Date(record.translatedAt).getTime() : 0
    if (record.status === 'stale' || record.status === 'failed') {
      return timestamp >= cutoff
    }
    if (record.status === 'not-required') return false
    if (record.status === 'translated' && !input.hotItemIds.has(record.sourceId)) {
      return timestamp >= cutoff
    }
    return true
  })
  return { next, removedCount: input.records.length - next.length }
}
