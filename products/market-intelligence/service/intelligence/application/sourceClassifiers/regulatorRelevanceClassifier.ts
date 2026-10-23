import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

const CRYPTO_ENTITY_RE =
  /\b(bitcoin|btc|ether|ethereum|eth|stablecoin|token|digital asset|crypto|defi|staking|etf|blockchain)\b/i
const VENUE_RE = /\b(coinbase|binance|kraken|okx|exchange|broker-dealer)\b/i
const NEGATIVE_RE =
  /\b(enforcement|lawsuit|charges|penalty|investigation|restriction|halt|cease|fraud|violation)\b/i
const POSITIVE_RE =
  /\b(approval|approved|settlement|clarity|framework|etf approval|market access|guidance)\b/i
const UNRELATED_RE =
  /\b(securities fraud|insider trading|accounting fraud|mutual fund|insurance company|municipal bond)\b/i

export function classifyRegulatorRelevance(input: SourceClassifierInput): ClassifiedSourceEvent {
  const text = `${input.title} ${input.summary ?? ''} ${input.bodyText ?? ''}`
  const entities = extractEntities(text)
  const symbols = extractSymbols(text)
  const cryptoRelevant = CRYPTO_ENTITY_RE.test(text) || VENUE_RE.test(text)
  const unrelated = UNRELATED_RE.test(text) && !cryptoRelevant

  if (unrelated || !cryptoRelevant) {
    return {
      outcome: 'ignore',
      eventSubtype: 'unrelated-enforcement',
      confidence: unrelated ? 80 : 40,
      entities,
      symbols,
      affectedScopes: [],
      sentimentEligible: false,
      ignoredReasonCode: 'scope-not-matched',
      caveats: ['low-classifier-confidence']
    }
  }

  const negative = NEGATIVE_RE.test(text)
  const positive = POSITIVE_RE.test(text)
  const lowConfidence = !negative && !positive

  if (lowConfidence) {
    return {
      outcome: 'context-only',
      eventSubtype: 'regulator-operational',
      confidence: 45,
      entities,
      symbols,
      affectedScopes: [{ type: 'crypto-market', id: 'global' }],
      sentimentEligible: false,
      ignoredReasonCode: 'classification-confidence-low',
      impactHint: { direction: 'neutral', reasonCode: 'regulator-operational', horizon: '1w' },
      caveats: ['low-classifier-confidence']
    }
  }

  const eventSubtype = positive
    ? /etf/i.test(text)
      ? 'regulator-etf-approval'
      : 'regulator-market-access'
    : 'regulator-enforcement'

  return {
    outcome: 'full-intelligence',
    eventSubtype,
    confidence: positive ? 80 : 78,
    entities,
    symbols,
    affectedScopes: [
      { type: 'crypto-market', id: 'global' },
      ...symbols.map((symbol) => ({ type: 'symbol', id: symbol }))
    ],
    sentimentEligible: true,
    impactHint: {
      direction: positive ? 'bullish' : 'bearish',
      reasonCode: eventSubtype,
      horizon: '1w'
    },
    caveats: symbols.length === 0 && cryptoRelevant ? ['asset-scope-fallback'] : []
  }
}

function extractEntities(text: string): string[] {
  const matches = text.match(/\b(Bitcoin|Ethereum|Coinbase|Binance|Kraken|OKX|ETF)\b/gi) ?? []
  return [...new Set(matches.map((entry) => entry.toLowerCase()))]
}

function extractSymbols(text: string): string[] {
  const paren = text.match(/\(([A-Z0-9]{2,10})\)/g) ?? []
  return [...new Set(paren.map((entry) => entry.replace(/[()]/g, '')))]
}
