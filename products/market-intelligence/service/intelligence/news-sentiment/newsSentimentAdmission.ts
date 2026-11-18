import { NEWS_SENTIMENT_SOURCE_IDS, OKX_SENTIMENT_ANN_TYPES } from '../schema/newsSentiment'

const SOURCES = new Set<string>(NEWS_SENTIMENT_SOURCE_IDS)
const OKX_TYPES = new Set<string>(OKX_SENTIMENT_ANN_TYPES)

/**
 * 「这条新闻进不进舆情评分」的唯一判据。
 *
 * 两个消费者必须读同一份：评分（谁去判）与卡片空态（读者看到空列表时，到底是有新闻没判、
 * 还是本来就没有新闻）。写在两处就会漂：一边加了源、另一边还认为「没有新闻」，空态那句话
 * 就从「未判定」退回假的「这段时间没有相关消息」。
 *
 * OKX 只判三类公告（采集与时间线不变）：其余类型连摘要都没有，判不出东西。
 */
export function isAdmittedNewsItem(item: { sourceId: string; summary?: string }): boolean {
  if (!SOURCES.has(item.sourceId)) return false
  if (item.sourceId !== 'okx-latest-announcements') return true
  return typeof item.summary === 'string' && OKX_TYPES.has(item.summary.trim())
}