import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

const TRADING_RE = /\b(trading|order placement|matching engine|spot market|futures market)\b/i
const API_RE = /\b(api|websocket|rest endpoint|rate limit)\b/i
const DEPOSIT_RE = /\b(deposit|withdrawal|withdraw|transfer|custody)\b/i
const CHAIN_RE = /\b(chain|block production|validator|network halt|consensus)\b/i
const WEBSITE_RE = /\b(website|status page|blog|marketing site)\b/i
const RESOLVED_RE = /\b(resolved|completed|monitoring|fixed)\b/i

export function classifyStatusIncident(input: SourceClassifierInput): ClassifiedSourceEvent {
  const text = `${input.title} ${input.summary ?? ''} ${input.bodyText ?? ''}`
  const status = (input.incidentStatus ?? '').toLowerCase()
  const resolved = status === 'resolved' || status === 'completed' || RESOLVED_RE.test(text)
  const venue = resolveScope(input)

  if (WEBSITE_RE.test(text) && !TRADING_RE.test(text) && !API_RE.test(text) && !DEPOSIT_RE.test(text)) {
    return {
      outcome: 'ignore',
      eventSubtype: 'minor-website-incident',
      confidence: 70,
      affectedScopes: [],
      sentimentEligible: false,
      ignoredReasonCode: 'noise-policy-filtered',
      caveats: []
    }
  }

  if (resolved) {
    return {
      outcome: 'context-only',
      eventSubtype: 'status-incident-resolved',
      confidence: 75,
      affectedScopes: [{ type: resolveScopeType(input), id: venue }],
      sentimentEligible: false,
      impactHint: { direction: 'neutral', reasonCode: 'status-incident-resolved', horizon: 'intraday' },
      caveats: []
    }
  }

  const eventSubtype = TRADING_RE.test(text)
    ? 'status-trading-outage'
    : API_RE.test(text)
      ? 'status-api-degradation'
      : DEPOSIT_RE.test(text)
        ? 'status-deposit-withdrawal'
        : CHAIN_RE.test(text) || input.sourceId === 'solana-status'
          ? 'status-chain-outage'
          : 'status-operational-incident'

  return {
    outcome: 'full-intelligence',
    eventSubtype,
    confidence: 82,
    affectedScopes: [{ type: resolveScopeType(input), id: venue }],
    sentimentEligible: eventSubtype !== 'status-operational-incident',
    impactHint: { direction: 'bearish', reasonCode: eventSubtype, horizon: 'intraday' },
    caveats: []
  }
}

function resolveScopeType(input: SourceClassifierInput): string {
  if (input.sourceId === 'solana-status') return 'project'
  return 'exchange'
}

function resolveScope(input: SourceClassifierInput): string {
  if (input.venue) return input.venue
  if (input.sourceId.includes('coinbase')) return 'coinbase'
  if (input.sourceId.includes('kraken')) return 'kraken'
  if (input.sourceId === 'solana-status') return 'solana'
  return input.sourceId
}
