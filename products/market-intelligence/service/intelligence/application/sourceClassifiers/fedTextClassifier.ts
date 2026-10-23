import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

const SUPERVISION_RE =
  /(supervision|examination|community development|consumer protection|bank holding|stress test results)/i
const OPERATIONAL_RE = /(holiday schedule|office closed|website maintenance|personnel appointment)/i
const HAWKISH_RE =
  /(raise|hike|tighter|restrictive|higher for longer|inflation remains elevated|further tightening|hawkish)/i
const DOVISH_RE = /(pause|cut|ease|accommodative|disinflation|lower rates|dovish)/i
const RATE_DECISION_RE = /(fomc|interest rate decision|federal funds rate|monetary policy decision)/i
const MINUTES_RE = /(minutes of the|fomc minutes|meeting minutes)/i
const SPEECH_RE = /(remarks by|speech by|testimony|chair|governor)/i

export function classifyFedText(input: SourceClassifierInput): ClassifiedSourceEvent {
  const text = `${input.title} ${input.summary ?? ''} ${input.bodyText ?? ''}`.trim()
  const lower = text.toLowerCase()

  if (OPERATIONAL_RE.test(text) && !HAWKISH_RE.test(text) && !DOVISH_RE.test(text)) {
    return contextOnly('fed-operational', 45, 'noise-policy-filtered', ['generic-source-parser'])
  }

  if (SUPERVISION_RE.test(text) && !RATE_DECISION_RE.test(text) && !HAWKISH_RE.test(text) && !DOVISH_RE.test(text)) {
    return contextOnly('fed-supervision', 50, undefined, ['generic-source-parser'])
  }

  if (RATE_DECISION_RE.test(text)) {
    return policyOutcome('fed-rate-decision', text, 85)
  }
  if (MINUTES_RE.test(text)) {
    return policyOutcome('fed-minutes', text, 80)
  }
  if (SPEECH_RE.test(text)) {
    return policyOutcome('fed-speech', text, 75)
  }
  if (lower.includes('statement')) {
    return policyOutcome('fed-statement', text, 80)
  }

  return policyOutcome('fed-statement', text, 65)
}

function policyOutcome(eventSubtype: string, text: string, confidence: number): ClassifiedSourceEvent {
  const hawkish = HAWKISH_RE.test(text)
  const dovish = DOVISH_RE.test(text)
  const direction = hawkish ? 'bearish' : dovish ? 'bullish' : 'neutral'
  const reasonCode = hawkish ? 'hawkish' : dovish ? 'dovish' : 'balanced'

  return {
    outcome: hawkish || dovish ? 'full-intelligence' : 'context-only',
    eventSubtype,
    confidence,
    affectedScopes: [
      { type: 'market-wide', id: 'global' },
      { type: 'risk-assets', id: 'global' }
    ],
    sentimentEligible: hawkish || dovish,
    impactHint: {
      direction,
      reasonCode,
      horizon: '1w'
    },
    caveats: hawkish || dovish ? [] : ['low-classifier-confidence']
  }
}

function contextOnly(
  eventSubtype: string,
  confidence: number,
  ignoredReasonCode?: ClassifiedSourceEvent['ignoredReasonCode'],
  caveats: ClassifiedSourceEvent['caveats'] = ['low-classifier-confidence']
): ClassifiedSourceEvent {
  return {
    outcome: 'context-only',
    eventSubtype,
    confidence,
    affectedScopes: [{ type: 'market-wide', id: 'global' }],
    sentimentEligible: false,
    ignoredReasonCode,
    impactHint: { direction: 'neutral', reasonCode: eventSubtype, horizon: '1w' },
    caveats
  }
}
