import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentFilters } from './useNewsSentiment'

export function passesNeutralFilter(
  row: Pick<NewsSentimentItemView, 'polarity'>,
  includeNeutral: boolean
): boolean {
  return includeNeutral || row.polarity !== 'neutral'
}

export function filterNewsSentimentRows(
  view: NewsSentimentView | undefined,
  filters: NewsSentimentFilters
): NewsSentimentItemView[] {
  return (view?.items ?? []).filter((row) => {
    if (!passesNeutralFilter(row, filters.includeNeutral)) return false
    if (filters.direction !== 'all' && row.polarity !== filters.direction) return false
    if (filters.sourceId !== 'all' && row.sourceId !== filters.sourceId) return false
    if (filters.scope !== 'market' && !row.symbols.includes(filters.scope)) return false
    return true
  })
}
