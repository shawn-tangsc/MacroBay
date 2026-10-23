import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

const LISTING_RE = /\b(will list|lists|listing|launch.*futures|perpetual contract|adds.*margin)\b/i
const DELISTING_RE = /\b(delist|delisting|will cease|remove.*collateral|monitoring tag)\b/i
const SUSPENSION_RE = /\b(suspend|suspension|halt trading|trading halt)\b/i
const RESUMPTION_RE = /\b(resume|resumption|reopen trading)\b/i
const MAINTENANCE_RE = /\b(maintenance|scheduled upgrade|system upgrade)\b/i
const API_UPDATE_RE = /\b(api update|api change|endpoint|websocket|rate limit)\b/i
const MARKETING_RE = /\b(celebration|campaign|giveaway|quiz|merch|holiday greeting)\b/i

export function classifyExchangeAnnouncement(input: SourceClassifierInput): ClassifiedSourceEvent {
  const text = `${input.title} ${input.summary ?? ''} ${input.bodyText ?? ''}`
  const venue = resolveVenue(input)
  const symbols = extractSymbols(text)
  const entities = extractAssets(text)

  if (MARKETING_RE.test(text) && !LISTING_RE.test(text) && !DELISTING_RE.test(text)) {
    return ignored('exchange-marketing', 'noise-policy-filtered')
  }

  if (DELISTING_RE.test(text)) {
    return listingOutcome('exchange-delisting', 'bearish', symbols, venue, entities, 85)
  }
  if (LISTING_RE.test(text)) {
    return listingOutcome('exchange-listing', 'bullish', symbols, venue, entities, 88)
  }
  if (SUSPENSION_RE.test(text)) {
    return listingOutcome('exchange-trading-suspension', 'bearish', symbols, venue, entities, 82)
  }
  if (RESUMPTION_RE.test(text)) {
    return listingOutcome('exchange-trading-resumption', 'bullish', symbols, venue, entities, 78)
  }
  if (API_UPDATE_RE.test(text) || input.sourceId.includes('api')) {
    return {
      outcome: 'context-only',
      eventSubtype: 'exchange-api-update',
      confidence: 70,
      entities,
      symbols,
      affectedScopes: [{ type: 'exchange', id: venue }],
      sentimentEligible: false,
      impactHint: { direction: 'neutral', reasonCode: 'exchange-api-update', horizon: '1d' },
      caveats: symbols.length === 0 ? ['asset-scope-fallback'] : []
    }
  }
  if (MAINTENANCE_RE.test(text)) {
    return {
      outcome: 'context-only',
      eventSubtype: 'exchange-maintenance',
      confidence: 65,
      entities,
      symbols,
      affectedScopes: [{ type: 'exchange', id: venue }],
      sentimentEligible: false,
      impactHint: { direction: 'neutral', reasonCode: 'exchange-maintenance', horizon: 'intraday' },
      caveats: []
    }
  }

  return {
    outcome: 'context-only',
    eventSubtype: 'exchange-general-announcement',
    confidence: 50,
    entities,
    symbols,
    affectedScopes: [{ type: 'exchange', id: venue }],
    sentimentEligible: false,
    impactHint: { direction: 'neutral', reasonCode: 'exchange-general-announcement', horizon: '1d' },
    caveats: ['low-classifier-confidence']
  }
}

function listingOutcome(
  eventSubtype: string,
  direction: 'bullish' | 'bearish',
  symbols: string[],
  venue: string,
  entities: string[],
  confidence: number
): ClassifiedSourceEvent {
  return {
    outcome: 'full-intelligence',
    eventSubtype,
    confidence,
    entities,
    symbols,
    affectedScopes: [
      { type: 'exchange', id: venue },
      ...symbols.map((symbol) => ({ type: 'symbol', id: symbol }))
    ],
    sentimentEligible: true,
    impactHint: { direction, reasonCode: eventSubtype, horizon: '1d' },
    caveats: symbols.length === 0 ? ['asset-scope-fallback'] : []
  }
}

function ignored(
  eventSubtype: string,
  ignoredReasonCode: ClassifiedSourceEvent['ignoredReasonCode']
): ClassifiedSourceEvent {
  return {
    outcome: 'ignore',
    eventSubtype,
    confidence: 75,
    affectedScopes: [],
    sentimentEligible: false,
    ignoredReasonCode,
    caveats: []
  }
}

function resolveVenue(input: SourceClassifierInput): string {
  if (input.venue) return input.venue
  if (input.sourceId.includes('binance')) return 'binance'
  if (input.sourceId.includes('okx')) return 'okx'
  return 'exchange'
}

function extractSymbols(text: string): string[] {
  const paren = text.match(/\(([A-Z0-9]{2,10})\)/g) ?? []
  return [...new Set(paren.map((entry) => entry.replace(/[()]/g, '')))]
}

function extractAssets(text: string): string[] {
  const tokens = text.match(/\b([A-Z]{2,10})\b/g) ?? []
  return [...new Set(tokens.filter((token) => !['API', 'USD', 'USDT', 'UTC'].includes(token)))]
}
