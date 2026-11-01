import type { NewsSentimentText } from './NewsSentimentCard'

/**
 * The only keys the icon triggers may ask for. `IconButton` keeps `ariaLabelKey` as an open string
 * because each call site names a different control, so the closed set lives here: a key with no
 * entry in the table is a compile error, not a runtime surprise.
 */
export const NEWS_SENTIMENT_ICON_KEYS = [
  'news.sentiment.settings',
  'news.sentiment.refresh',
  'news.sentiment.more'
] as const

export type NewsSentimentIconKey = (typeof NEWS_SENTIMENT_ICON_KEYS)[number]

/**
 * Resolves a key to its label. An unknown key resolves to an empty string rather than to the key
 * itself: reading `news.sentiment.settings` to a user is worse than not rendering the trigger.
 * Callers that must have a label ask `hasIconText` first so the trigger is hidden instead of
 * announced with an internal code.
 */
export function createIconTextResolver(text: NewsSentimentText): (key: string) => string {
  const labels: Record<NewsSentimentIconKey, string> = {
    'news.sentiment.settings': text.settings,
    'news.sentiment.refresh': text.refresh,
    'news.sentiment.more': text.drawer.moreActions
  }
  return (key: string): string => (labels as Record<string, string | undefined>)[key] ?? ''
}

export function hasIconText(text: NewsSentimentText, key: NewsSentimentIconKey): boolean {
  return createIconTextResolver(text)(key).length > 0
}
