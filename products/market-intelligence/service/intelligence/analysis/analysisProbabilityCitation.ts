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
 * The rule covers four different model mistakes — no probability at all, a probability cited
 * without its as-of, a number the snapshot does not carry, and a frozen value the model rounded on
 * its own. All four arrived as the same rule name, so a replay could say "it was rejected" but never
 * which one, and the question "is the prompt missing a sentence or is the rule too wide" could not
 * be answered.
 * These land in `failure_detail_code`; the primary code stays `policy-probability-citation`.
 */
export const analysisProbabilityDefects = Object.freeze({
  /**
   * The snapshot carries a policy probability and the conclusion never mentions one.
   *
   * The other three defects are "mentioned it and got it wrong"; this one is "avoided it". It is
   * the failure mode the rule would otherwise push the model into: once a cited value must match
   * the snapshot exactly, the cheapest way to pass is to say nothing about the probability at all,
   * and the reader would get a complete-looking analysis with the policy pricing silently missing.
   */
  absent: 'policy-probability-absent',
  missingInstant: 'policy-probability-missing-instant',
  notFrozen: 'policy-probability-not-frozen',

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
  // Only when there is a probability to cite: a snapshot without one must not be penalised.
  if (probabilities.length === 0) return undefined
  const prose = conclusionProse(conclusion)
  // **正文里每个百分数逐个查快照出处**：不在快照里的数就是编造——拒的理由是"那个数不存在"，
  // 与句子用了什么词无关。旧做法（`概率/定价` 前后 N 个字）是对措辞的猜测，换个说法就绕过。
  const mentioned = percentagesIn(prose)
  const allowed = snapshotNumbers(snapshot)
  for (const value of mentioned) {
    if (!tracedToSnapshot(value, allowed)) return analysisProbabilityDefects.notFrozen
  }
  const probabilityValues = probabilities.map(fact => Number(fact.value))
  // 整段没有一处提到快照里的概率 → 与原来的「回避」同一个缺陷（事实判据，不靠关键词）。
  if (!mentioned.some(value => tracedToSnapshot(value, probabilityValues))) return analysisProbabilityDefects.absent
  for (const fact of probabilities) {
    const value = Number(fact.value)
    if (mentioned.some(candidate => tracedToSnapshot(candidate, [value])) && !mentionsInstant(prose, fact.observedAt!)) {
      return analysisProbabilityDefects.missingInstant
    }
  }
  return undefined
}

/**
 * 正文里的**每一个百分数**，逐个查它在快照里有没有出处。
 *
 * 旧做法是「`概率/定价` 前后 N 个字以内的数字」——那是对措辞的猜测：`概率/定价` 只是其中一种说法，
 * 模型换个说法就绕过去了，而合规的写法（`目标区间 4.00%–4.25%`）反而会被窗口吞掉。现在只问事实：
 * **这个数在快照里存在吗**。
 */
function percentagesIn(text: string): number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|\uFF05)/gu)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value))
}

/** 快照里出现过的所有数字：数字型值直接取，字符串型值把里面的数（如 `4.00%–4.25%`）也取出来。 */
function snapshotNumbers(snapshot: ProbabilityEvidence): readonly number[] {
  const numbers: number[] = []
  for (const fact of snapshot.facts) {
    if (typeof fact.value === 'number' && Number.isFinite(fact.value)) numbers.push(fact.value)
    else if (typeof fact.value === 'string') numbers.push(...percentagesIn(fact.value))
  }
  return numbers
}

/** 某个数在快照里有没有出处：等值，或等于它的整百分点（正文写约数是允许的）。 */
function tracedToSnapshot(value: number, allowed: readonly number[]): boolean {
  return allowed.some(candidate => Math.abs(candidate - value) < 0.05 || Math.abs(Math.round(candidate) - value) < 0.05)
}

/** `observedAt` is UTC; accept the ISO form, `YYYY-MM-DD HH:mm`, or `MM-DD HH:mm`. */
function mentionsInstant(text: string, observedAt: string): boolean {
  const date = observedAt.slice(0, 10)
  const time = observedAt.slice(11, 16)
  const short = date.slice(5)
  return text.includes(observedAt) || text.includes(`${date} ${time}`) || text.includes(`${date}T${time}`) ||
    text.includes(`${short} ${time}`) || text.includes(`${short}T${time}`)
}

/** 结论里读者能看到的那几段文字，按判定需要拼成一份（只用于正则读，不改变任何内容）。 */
function conclusionProse(conclusion: AnalysisConclusion): string {
  return [
    conclusion.summary, conclusion.change, conclusion.causalChain,
    ...(conclusion.macro ? [conclusion.macro] : []),
    ...conclusion.conditions, ...(conclusion.evidenceStrength ? [conclusion.evidenceStrength] : []),
    ...conclusion.dataGaps
  ].join('\n')
}
