export type MarketEventCategory = 'exchange-announcement' | 'news' | 'macro' | 'project-update' | string
export type MarketEventSourceTrust = 'high' | 'medium' | 'low'
export type MarketEventDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type NormalizedMarketEventImpact = {
  direction: MarketEventDirection
  strength: number
  confidence: number
  horizon?: 'minutes' | 'intraday' | 'swing' | 'long_term' | string
  reasoning?: string[]
  riskNotes?: string[]
}

export type NormalizedMarketEvent = {
  id: string
  sourceId: string
  sourceType: string
  title: string
  summary?: string
  url?: string
  publishedAt: string
  detectedAt: string
  category: MarketEventCategory
  symbols: string[]
  assets: string[]
  quoteAssets?: string[]
  language?: string
  sourceTrust: MarketEventSourceTrust
  marketWideCritical?: boolean
  impact?: NormalizedMarketEventImpact
}

export type EventRelevanceKind =
  | 'active-futures-position'
  | 'active-spot-exposure'
  | 'watchlist'
  | 'position-and-watchlist'
  | 'market-wide-critical'
  | 'related-sector'
  | 'irrelevant'

export type EventMatch = {
  eventId: string
  relevance: EventRelevanceKind
  matchedSymbols: string[]
  matchedAssets: string[]
  matchReasons: string[]
  watchlistInterestLevel?: 'low' | 'normal' | 'high'
  matchedWatchlistVenues?: string[]
  dataQualityCaveat?: string
}

export type IntelligenceTimelineFilter = 'active-exposure' | 'watchlist' | 'both' | 'all'

export type IntelligenceTimelineItem = {
  event: NormalizedMarketEvent
  match: EventMatch
  alertStatus?: 'suppressed' | 'timeline-only' | 'notify' | 'none'
  alertDecisionId?: string
}

export type IntelligenceTimelineQuery = {
  filter?: IntelligenceTimelineFilter
  limit?: number
}

export type IntelligenceTimelinePage = {
  items: IntelligenceTimelineItem[]
  filter: IntelligenceTimelineFilter
  updatedAt: string
}

export type MarketEventState = {
  eventsById: Record<string, NormalizedMarketEvent>
  order: string[]
  updatedAt: string
}

export type {
  IntelligenceEventCluster,
  IntelligenceItem,
  IntelligenceItemRevision
} from './intelligenceRecord'

export function createEmptyMarketEventState(now = new Date().toISOString()): MarketEventState {
  return { eventsById: {}, order: [], updatedAt: now }
}

export function normalizeMarketEvent(raw: NormalizedMarketEvent): NormalizedMarketEvent {
  return {
    ...raw,
    title: raw.title.trim(),
    symbols: uniqueUpper(raw.symbols ?? []),
    assets: uniqueUpper(raw.assets ?? []),
    quoteAssets: raw.quoteAssets ? uniqueUpper(raw.quoteAssets) : undefined,
    sourceTrust: raw.sourceTrust ?? 'medium',
    impact: raw.impact
      ? {
          ...raw.impact,
          strength: clamp(raw.impact.strength, 1, 5),
          confidence: clamp(raw.impact.confidence, 0, 100)
        }
      : undefined
  }
}

function uniqueUpper(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
