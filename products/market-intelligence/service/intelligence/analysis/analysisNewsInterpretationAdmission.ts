import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { isNewsSeveritySource } from './analysisItemSeverity'

/**
 * 手动解读的准入（R39 S1 §3，**唯一一份**）。
 *
 * 抽屉右键、只读接口的菜单可用性、以及任何遗留的手动刷新调用，都调这一处；任何一处再写一遍
 * 即缺陷。两个分支：
 *
 * - **舆情（四个有判定的源）**：还要一条情绪判定——没有判定就写不出第一段的偏向；
 * - **消息面（其它来源）**：只要求有发布时间 + 来源在注册表里，不要求判定。
 *
 * 今天不可达的一条分支要说清：非四源条目（`github-releases` 这类 generics 判成 `high` 的）
 * 虽能过准入，但 news 线的触发事实建不出来，而且它们没有抽屉入口——**今天不可解读**，不是
 * 被准入拒绝。等给它们入口时一起解。
 */
export type InterpretationAdmissionReason =
  | 'item-not-found'
  | 'source-not-covered'
  | 'no-publication'
  | 'no-judgment'

export type InterpretationAdmissionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: InterpretationAdmissionReason }>

export type InterpretationAdmissionDeps = Readonly<{
  latestNewsSentiment?: (itemId: string, asOf: string) => NewsSentimentRecord | undefined
  now: () => string
}>

export function interpretationAdmission(
  item: IntelligenceItem | undefined,
  deps: InterpretationAdmissionDeps
): InterpretationAdmissionResult {
  if (!item) return { ok: false, reason: 'item-not-found' }
  const newsSource = isNewsSeveritySource(item.sourceId)
  if (newsSource) {
    if (!item.publishedAt) return { ok: false, reason: 'no-publication' }
    if (!deps.latestNewsSentiment?.(item.itemId, deps.now())) return { ok: false, reason: 'no-judgment' }
    return { ok: true }
  }
  if (!getIntelligenceSourceDefinition(item.sourceId)) return { ok: false, reason: 'source-not-covered' }
  if (!item.publishedAt) return { ok: false, reason: 'no-publication' }
  return { ok: true }
}
