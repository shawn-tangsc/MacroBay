import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

export function classifyMarketStructureMetric(input: SourceClassifierInput): ClassifiedSourceEvent {
  const hasComparison =
    input.comparisonBasis !== 'level' &&
    input.metricPrevious !== undefined &&
    Number.isFinite(input.metricPrevious)

  if (input.metricKind === 'fear-greed' || input.metricKey === 'FEAR_GREED_INDEX') {
    return classifyFearGreed(input)
  }

  if (input.metricKey === 'CHAIN_TVL_TOTAL') {
    if (!hasComparison) {
      return levelOnlyContext('tvl-level')
    }
    const rising = (input.metricActual ?? 0) > (input.metricPrevious ?? 0)
    return {
      outcome: 'full-intelligence',
      eventSubtype: 'tvl-comparison',
      confidence: 68,
      affectedScopes: [{ type: 'crypto-market', id: 'global' }],
      sentimentEligible: true,
      impactHint: {
        direction: rising ? 'bullish' : 'bearish',
        reasonCode: rising ? 'liquidity-expansion' : 'liquidity-contraction',
        horizon: '1d'
      },
      caveats: ['proxy-metric']
    }
  }

  if (input.metricKind === 'funding-rate') {
    const actual = input.metricActual ?? 0
    const extreme = actual >= 0.05 || actual <= -0.02
    return {
      outcome: extreme ? 'full-intelligence' : 'context-only',
      eventSubtype: extreme ? 'funding-extreme' : 'funding-level',
      confidence: extreme ? 62 : 45,
      affectedScopes: [{ type: 'symbol', id: input.symbols?.[0] ?? 'UNKNOWN' }],
      sentimentEligible: extreme,
      impactHint: {
        direction: 'mixed',
        reasonCode: actual >= 0.05 ? 'crowded-long' : actual <= -0.02 ? 'crowded-short' : 'funding-neutral',
        horizon: '1d'
      },
      caveats: extreme ? ['contrarian-metric'] : ['proxy-metric', 'low-classifier-confidence']
    }
  }

  if (input.metricKind === 'spot-market') {
    const actual = input.metricActual ?? 0
    const strong = Math.abs(actual) >= 2
    return {
      outcome: strong ? 'full-intelligence' : 'context-only',
      eventSubtype: strong ? 'spot-momentum' : 'spot-level',
      confidence: strong ? 60 : 40,
      affectedScopes: [{ type: 'symbol', id: input.symbols?.[0] ?? 'UNKNOWN' }],
      sentimentEligible: strong,
      impactHint: {
        direction: actual > 2 ? 'bullish' : actual < -2 ? 'bearish' : 'neutral',
        reasonCode: 'spot-momentum',
        horizon: '1d'
      },
      caveats: strong ? [] : ['low-classifier-confidence']
    }
  }

  if (!hasComparison) {
    return levelOnlyContext('metric-level')
  }

  return {
    outcome: 'full-intelligence',
    eventSubtype: 'metric-comparison',
    confidence: 60,
    affectedScopes: [{ type: 'crypto-market', id: 'global' }],
    sentimentEligible: true,
    impactHint: { direction: 'neutral', reasonCode: 'metric-comparison', horizon: '1d' },
    caveats: ['proxy-metric']
  }
}

function classifyFearGreed(input: SourceClassifierInput): ClassifiedSourceEvent {
  const actual = input.metricActual ?? 50
  const extreme = actual <= 24 || actual >= 75
  return {
    outcome: extreme ? 'full-intelligence' : 'context-only',
    eventSubtype: actual <= 24 ? 'fear-extreme' : actual >= 75 ? 'greed-extreme' : 'fear-greed-neutral',
    confidence: extreme ? 58 : 42,
    affectedScopes: [{ type: 'crypto-market', id: 'global' }],
    sentimentEligible: extreme,
    impactHint: {
      direction: 'mixed',
      reasonCode: actual <= 24 ? 'extreme-fear' : actual >= 75 ? 'extreme-greed' : 'neutral-sentiment',
      horizon: '1d'
    },
    caveats: extreme ? ['contrarian-metric'] : ['low-classifier-confidence']
  }
}

function levelOnlyContext(eventSubtype: string): ClassifiedSourceEvent {
  return {
    outcome: 'context-only',
    eventSubtype,
    confidence: 40,
    affectedScopes: [{ type: 'crypto-market', id: 'global' }],
    sentimentEligible: false,
    impactHint: { direction: 'neutral', reasonCode: eventSubtype, horizon: '1d' },
    caveats: ['proxy-metric', 'low-classifier-confidence']
  }
}
