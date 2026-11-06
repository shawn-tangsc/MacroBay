import type { BriefingNewsItem } from '../../../contracts/dailyBriefing'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'

/**
 * One scored news item as the briefing stores it.
 *
 * The translated headline is attached only when it was translated into **this edition's** language.
 * A translation into another language (the interface's, usually) must not leak in — that cross-
 * language fallback is exactly how a Chinese headline ended up in an English edition.
 */
export function toBriefingNewsItem(item: NewsSentimentItemView, locale: 'zh-CN' | 'en-US'): BriefingNewsItem {
  const translated = item.displayTitle && item.titleLocale === locale && item.displayTitle !== item.title
    ? item.displayTitle
    : undefined
  return Object.freeze({
    itemId: item.itemId,
    title: item.title,
    ...(translated ? { translatedTitle: translated } : {}),
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    polarity: item.polarity,
    strength: item.strength,
    confidence: item.confidence,
    symbols: Object.freeze([...item.symbols])
  })
}
