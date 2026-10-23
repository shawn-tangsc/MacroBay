import type { IntelligenceProcessingLabels } from '../intelligenceItemLabels'
import { parseProcessingLabels } from '../intelligenceItemLabels'

export type ClassifierImpactHint = {
  direction?: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  reasonCode?: string
  horizon?: 'intraday' | '1d' | '1w' | '1m'
}

export function readClassifierLabels(processingLabelsJson?: string): IntelligenceProcessingLabels {
  return parseProcessingLabels(processingLabelsJson)
}

export function readClassifierImpactHint(processingLabelsJson?: string): ClassifierImpactHint | undefined {
  const labels = parseProcessingLabels(processingLabelsJson)
  if (!labels.impactHintJson?.trim()) return undefined
  try {
    const parsed = JSON.parse(labels.impactHintJson) as ClassifierImpactHint
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export function isClassifierSentimentEligible(processingLabelsJson?: string): boolean {
  const labels = parseProcessingLabels(processingLabelsJson)
  return labels.sentimentEligible !== false
}

export function resolveFedPolicyTone(input: {
  processingLabelsJson?: string
  title?: string
  summary?: string
}): 'hawkish' | 'dovish' | 'balanced' | undefined {
  const labels = readClassifierLabels(input.processingLabelsJson)
  const hint = readClassifierImpactHint(input.processingLabelsJson)

  if (hint?.reasonCode === 'hawkish' || hint?.direction === 'bearish') return 'hawkish'
  if (hint?.reasonCode === 'dovish' || hint?.direction === 'bullish') return 'dovish'
  if (hint?.reasonCode === 'balanced' || hint?.direction === 'neutral') return 'balanced'

  if (labels.eventSubtype?.includes('hawkish')) return 'hawkish'
  if (labels.eventSubtype?.includes('dovish')) return 'dovish'

  const text = `${input.title ?? ''} ${input.summary ?? ''}`
  if (/(raise|hike|tighter|restrictive|higher for longer|inflation remains elevated|further tightening|hawkish)/i.test(text)) {
    return 'hawkish'
  }
  if (/(pause|cut|ease|accommodative|disinflation|lower rates|dovish)/i.test(text)) {
    return 'dovish'
  }

  return undefined
}

export function resolveRegulatorDirection(input: {
  processingLabelsJson?: string
  title?: string
  summary?: string
}): 'bullish' | 'bearish' | undefined {
  const labels = readClassifierLabels(input.processingLabelsJson)
  const hint = readClassifierImpactHint(input.processingLabelsJson)

  if (labels.relevanceOutcome === 'context-only' && labels.sentimentEligible === false) {
    return undefined
  }

  if (hint?.direction === 'bullish' || hint?.direction === 'bearish') {
    return hint.direction
  }

  const subtype = labels.eventSubtype ?? hint?.reasonCode
  if (subtype === 'regulator-enforcement') return 'bearish'
  if (subtype === 'regulator-etf-approval' || subtype === 'regulator-market-access') return 'bullish'

  const text = `${input.title ?? ''} ${input.summary ?? ''}`
  if (/(etf approval|approved|court ruling|market structure|clarity|settlement)/i.test(text)) return 'bullish'
  if (/(enforcement|lawsuit|ban|restrict|investigation|penalty|halt)/i.test(text)) return 'bearish'

  return undefined
}

export function resolveExchangeAnnouncementAction(input: {
  processingLabelsJson?: string
  title?: string
  summary?: string
}): 'listing' | 'delisting' | 'api-context' | undefined {
  const labels = readClassifierLabels(input.processingLabelsJson)
  const hint = readClassifierImpactHint(input.processingLabelsJson)
  const subtype = labels.eventSubtype ?? hint?.reasonCode

  if (subtype === 'exchange-listing') return 'listing'
  if (subtype === 'exchange-delisting' || subtype === 'exchange-trading-suspension') return 'delisting'
  if (subtype === 'exchange-api-update') return 'api-context'

  if (labels.relevanceOutcome === 'context-only' && subtype?.includes('api')) {
    return 'api-context'
  }

  const text = `${input.title ?? ''} ${input.summary ?? ''}`.toLowerCase()
  if (/delist|remove.*collateral|monitoring tag|will cease/i.test(text)) return 'delisting'
  if (/will list|lists|listing|launch.*futures|perpetual contract/i.test(text)) return 'listing'

  return undefined
}
