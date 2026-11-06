import type { AgentFact, AnalysisConclusion } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_POLICY_PATH_METRICS } from '../../../contracts/marketAnalysisContracts'

/**
 * How a conclusion cites policy probabilities.
 *
 * Kept out of the output validator because it is a self-contained reading of prose: which numbers
 * claim to be a probability, whether each equals a frozen value, and whether each carries that
 * fact's own as-of. The validator only asks this module for the first defect.
 */

/**
 * Which part of `policy-probability-citation` failed.
 *
 * The rule covers three different model mistakes — a probability cited without its as-of, a number
 * the snapshot does not carry, and a frozen value the model rounded on its own. All three arrived as
 * the same rule name, so a replay could say "it was rejected" but never which one, and the
 * question "is the prompt missing a sentence or is the rule too wide" could not be answered.
 * These land in `failure_detail_code`; the primary code stays `policy-probability-citation`.
 */
export const analysisProbabilityDefects = Object.freeze({
  missingInstant: 'policy-probability-missing-instant',
  notFrozen: 'policy-probability-not-frozen',
  rounded: 'policy-probability-rounded'
})

export type AnalysisProbabilityDefect = (typeof analysisProbabilityDefects)[keyof typeof analysisProbabilityDefects]

/** The part of a frozen snapshot this reading needs; a full snapshot satisfies it. */
export type ProbabilityEvidence = Readonly<{
  facts: readonly Pick<AgentFact, 'metric' | 'value' | 'observedAt'>[]
}>

/**
 * The first defect in how the conclusion cites policy probabilities, if any.
 *
 * A rejected conclusion used to say only "policy-probability-citation", which told the next
 * investigation nothing: a missing as-of, a fabricated value and a rounded value are three
 * different model mistakes with three different fixes (one is a prompt sentence, two are model
 * behaviour). The defect lands in `failure_detail_code`; the primary code is unchanged.
 */
export function policyProbabilityDefect(conclusion: AnalysisConclusion, snapshot: ProbabilityEvidence): AnalysisProbabilityDefect | undefined {
  const probabilities = snapshot.facts.filter(fact =>
    fact.metric === MARKET_ANALYSIS_POLICY_PATH_METRICS.impliedProbability &&
    typeof fact.value === 'number' && Number.isFinite(fact.value) && typeof fact.observedAt === 'string')
  if (probabilities.length === 0) return undefined
  const prose = [
    conclusion.summary, conclusion.change, conclusion.causalChain,
    ...(conclusion.macro ? [conclusion.macro] : []),
    ...conclusion.conditions, ...(conclusion.evidenceStrength ? [conclusion.evidenceStrength] : []),
    ...conclusion.dataGaps
  ].join('\n')
  // Only percentages written as a probability are policed: a yield or a CPI print is not one.
  const mentioned = policyProbabilityMentions(prose)
  const allowed = probabilities.map(fact => Number(fact.value))
  for (const value of mentioned) {
    if (allowed.some(candidate => nearlyEqual(candidate, value))) continue
    return looksRounded(value, allowed) ? analysisProbabilityDefects.rounded : analysisProbabilityDefects.notFrozen
  }
  for (const fact of probabilities) {
    const value = Number(fact.value)
    if (mentioned.some(candidate => nearlyEqual(candidate, value)) && !mentionsInstant(prose, fact.observedAt!)) {
      return analysisProbabilityDefects.missingInstant
    }
  }
  return undefined
}

/**
 * A value the snapshot does not carry, but one it would carry if someone rounded the frozen value
 * to a whole number. This is the case that is worth naming separately: `65.5%` written as `66%`
 * is a model habit, not a fabricated number, and whether to allow it is a product decision that
 * needs the count first.
 */
function looksRounded(mention: number, allowed: readonly number[]): boolean {
  return allowed.some(value => {
    const rounded = Math.round(value)
    return !nearlyEqual(rounded, value) && nearlyEqual(rounded, mention)
  })
}

/**
 * Percentages that actually claim to be a probability.
 *
 * The keyword must be within a few characters that carry no other number, so "市场定价 66%" and
 * "66% 的概率" are claims while "政策与市场定价：目标区间 4.00%–4.25%" is not. The earlier window
 * was sixteen characters, which swallowed the target range the prompt itself asks for and rejected
 * a correct conclusion for mentioning it.
 */
const policyProbabilityMentionWindow = 4

function policyProbabilityMentions(text: string): number[] {
  const afterKeyword = new RegExp(`(?:概率|定价)[^0-9%。；\\n]{0,${policyProbabilityMentionWindow}}(\\d+(?:\\.\\d+)?)\\s*[%％]`, 'g')
  const beforeKeyword = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[%％][^0-9%。；\\n]{0,${policyProbabilityMentionWindow}}(?:概率|定价)`, 'g')
  return [
    ...text.matchAll(afterKeyword),
    ...text.matchAll(beforeKeyword)
  ].map(match => Number(match[1])).filter(value => Number.isFinite(value))
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.05
}

/** `observedAt` is UTC; accept the ISO form, `YYYY-MM-DD HH:mm`, or `MM-DD HH:mm`. */
function mentionsInstant(text: string, observedAt: string): boolean {
  const date = observedAt.slice(0, 10)
  const time = observedAt.slice(11, 16)
  const short = date.slice(5)
  return text.includes(observedAt) || text.includes(`${date} ${time}`) || text.includes(`${date}T${time}`) ||
    text.includes(`${short} ${time}`) || text.includes(`${short}T${time}`)
}
