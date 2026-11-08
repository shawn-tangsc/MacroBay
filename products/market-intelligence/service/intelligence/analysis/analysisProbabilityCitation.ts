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
  // Only percentages written as a probability are policed: a yield or a CPI print is not one.
  const mentioned = policyProbabilityMentions(prose)
  if (mentioned.length === 0) return analysisProbabilityDefects.absent
  const allowed = probabilities.map(fact => Number(fact.value))
  // `04` §3.4.1：正文用**约数**（约 77%），两位小数进留痕区——所以「四舍五入到整百分点」是**合规写法**，
  // 不是缺陷。真正的编造仍然拒（既不等值、也不等于快照值的四舍五入）。
  for (const value of mentioned) {
    if (allowed.some(candidate => nearlyEqual(candidate, value) || nearlyEqual(Math.round(candidate), value))) continue
    return analysisProbabilityDefects.notFrozen
  }
  for (const fact of probabilities) {
    const value = Number(fact.value)
    if (mentioned.some(candidate => nearlyEqual(candidate, value) || nearlyEqual(Math.round(value), candidate)) && !mentionsInstant(prose, fact.observedAt!)) {
      return analysisProbabilityDefects.missingInstant
    }
  }
  return undefined
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

/** 结论里读者能看到的那几段文字，按判定需要拼成一份（只用于正则读，不改变任何内容）。 */
function conclusionProse(conclusion: AnalysisConclusion): string {
  return [
    conclusion.summary, conclusion.change, conclusion.causalChain,
    ...(conclusion.macro ? [conclusion.macro] : []),
    ...conclusion.conditions, ...(conclusion.evidenceStrength ? [conclusion.evidenceStrength] : []),
    ...conclusion.dataGaps
  ].join('\n')
}

/**
 * 「带符号的百分比」两条规则（`04` §3.4.1）：**先判数字绑在谁身上，再判该不该带符号**。
 *
 * - `probability-is-a-level`：写在「概率/定价」位置、却带符号的水平值（`降息概率 +5%`、
 *   `降息概率 3 个百分点`）。概率是水平值，带符号会被读成「变了 5 个百分点」。
 * - `ambiguous-signed-percentage`：带符号的数字，既不是增量单位、同一子句里也没有变化/比较
 *   标记，读者无法判断它是水平还是变化——按**歧义**拒，不猜。
 *
 * 允许的三种（不误伤）：
 * 1. 单位本身是增量：`bp` / `基点`（不需要出现「变化」二字，`收益率 +6bp` 是对的）；
 * 2. 同一子句里有变化/比较标记（变化、较、环比、同比、上升下降、上调下调、走高走低、回落）；
 * 3. 无符号概率 + 独立变化句（`市场定价 76%；较上一日 +3 个百分点`）——两个子句各自成立。
 */
