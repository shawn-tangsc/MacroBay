import type { IntelligenceSourceCategory } from '../schema/intelligenceSource'

export type IntelligenceEventType =
  | 'news'
  | 'blog'
  | 'announcement'
  | 'exchange-announcement'
  | 'incident'
  | 'maintenance'
  | 'exchange-status'
  | 'regulation'
  | 'macro'

const EVENT_TYPE_ALIASES: Record<string, IntelligenceEventType> = {
  news: 'news',
  'news-event': 'news',
  blog: 'blog',
  announcement: 'announcement',
  'exchange-announcement': 'exchange-announcement',
  incident: 'incident',
  maintenance: 'maintenance',
  'system-status': 'exchange-status',
  'exchange-status': 'exchange-status',
  regulation: 'regulation',
  'regulatory-event': 'regulation',
  macro: 'macro',
  'macro-event': 'macro'
}

export function normalizeEventType(input: {
  eventType?: string
  sourceCategory?: IntelligenceSourceCategory | string
  clusterType?: string
}): IntelligenceEventType {
  const raw = input.eventType?.trim().toLowerCase()
  if (raw && EVENT_TYPE_ALIASES[raw]) {
    return EVENT_TYPE_ALIASES[raw]
  }

  if (input.sourceCategory === 'regulation') return 'regulation'
  if (input.sourceCategory === 'macro') return 'macro'
  if (input.sourceCategory === 'exchange-announcement') return 'exchange-announcement'
  if (input.sourceCategory === 'exchange-status') return 'exchange-status'
  if (input.sourceCategory === 'official-post') return 'blog'
  if (input.clusterType === 'macro-event') return 'macro'
  if (input.clusterType === 'regulatory-event') return 'regulation'
  if (input.clusterType === 'incident') return 'incident'
  if (input.clusterType === 'announcement') return 'announcement'

  return 'news'
}
