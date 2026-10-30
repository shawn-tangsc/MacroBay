import { formatPp, type PolicyPathSettlement } from '../../../contracts/policyPath'

/**
 * How a settlement conclusion is worded, in one place.
 *
 * The card's strip, its verdict line and the drawer's section must not describe the same arithmetic
 * two ways: if one said "priced" and another a different number, a reader would have to decide which
 * surface lies.
 */
export type PolicyPathConclusionText = Readonly<{
  settlementPricedConclusion: string
  settlementHawkish: string
  settlementDovish: string
  settlementConclusionMissing: string
}>

export type PolicyPathSettlementText = PolicyPathConclusionText & Readonly<{
  settledMinutes: string
  settledHours: string
}>

export type PolicyPathJudgedText = Readonly<{
  judgedPriced: string
  judgedHawkish: string
  judgedDovish: string
  settlementConclusionMissing: string
}>

export type PolicyPathConclusionView = Readonly<{
  label: string
  direction: 'hawkish' | 'dovish' | 'priced'
}>

export type PolicyPathJudgedView = Readonly<{
  label: string
  direction: 'hawkish' | 'dovish' | 'priced' | 'missing'
}>

/**
 * The quantitative gap only. Direction is carried by one word and the colour; it says which side of
 * the priced band the outcome landed on, not why the committee moved.
 */
export function conclusionView(
  settlement: PolicyPathSettlement | undefined,
  text: PolicyPathConclusionText
): PolicyPathConclusionView | undefined {
  const conclusion = settlement?.conclusion
  if (!conclusion) return undefined
  if (conclusion.kind === 'priced') return { label: text.settlementPricedConclusion, direction: 'priced' }
  if (conclusion.kind === 'relative') {
    const template = conclusion.direction === 'hawkish' ? text.settlementHawkish : text.settlementDovish
    return { label: template.replace('{value}', formatPp(conclusion.surprisePp)), direction: conclusion.direction }
  }
  return undefined
}

/** The verdict line's shorter form: the label above it already says "last decision vs. pricing". */
export function judgedView(
  settlement: PolicyPathSettlement | undefined,
  text: PolicyPathJudgedText
): PolicyPathJudgedView | undefined {
  const conclusion = settlement?.conclusion
  if (!conclusion) return undefined
  if (conclusion.kind === 'priced') return { label: text.judgedPriced, direction: 'priced' }
  if (conclusion.kind === 'relative') {
    const template = conclusion.direction === 'hawkish' ? text.judgedHawkish : text.judgedDovish
    return { label: template.replace('{value}', formatPp(conclusion.surprisePp)), direction: conclusion.direction }
  }
  return { label: text.settlementConclusionMissing, direction: 'missing' }
}

/** The share of the odds as the panels write it: whole percent, since a pp of noise is noise. */
export function percentOf(share: number): string {
  return `${(share * 100).toFixed(0)}%`
}

/** "Settled 42 minutes ago" — the unit follows the elapsed time, never "2634 minutes". */
export function settledFor(minutesSinceDecision: number, text: Pick<PolicyPathSettlementText, 'settledMinutes' | 'settledHours'>): string {
  return minutesSinceDecision < 60
    ? text.settledMinutes.replace('{minutes}', String(minutesSinceDecision))
    : text.settledHours.replace('{hours}', String(Math.floor(minutesSinceDecision / 60)))
}
