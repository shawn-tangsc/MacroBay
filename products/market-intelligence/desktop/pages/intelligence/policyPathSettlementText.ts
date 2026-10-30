import { formatPp, type PolicyPathSettlement } from '../../../contracts/policyPath'

/**
 * How a settlement conclusion is worded, in one place.
 *
 * The card's strip and the drawer's section must not describe the same arithmetic two ways: if one
 * said "priced" and the other a different number, a reader would have to decide which surface lies.
 */
export type PolicyPathConclusionText = Readonly<{
  settlementPricedConclusion: string
  settlementRelative: string
  settlementConclusionMissing: string
}>

export type PolicyPathSettlementText = PolicyPathConclusionText & Readonly<{
  settledMinutes: string
  settledHours: string
}>

export type PolicyPathConclusionView = Readonly<{
  label: string
  direction: 'hawkish' | 'dovish' | 'priced'
}>

/**
 * The quantitative gap only. Direction is carried by the sign and the colour; naming a motive
 * ("dovish", "hawkish") would assert something comparing two bands does not contain.
 */
export function conclusionView(
  settlement: PolicyPathSettlement | undefined,
  text: PolicyPathConclusionText
): PolicyPathConclusionView | undefined {
  const conclusion = settlement?.conclusion
  if (!conclusion) return undefined
  if (conclusion.kind === 'priced') return { label: text.settlementPricedConclusion, direction: 'priced' }
  if (conclusion.kind === 'relative') {
    return {
      label: text.settlementRelative.replace('{value}', `${conclusion.direction === 'hawkish' ? '+' : '-'}${formatPp(conclusion.surprisePp)}`),
      direction: conclusion.direction
    }
  }
  return undefined
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
