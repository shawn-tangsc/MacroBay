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
  /**
   * 正文写了变化值，但快照没有这条变化事实（`policy-implied-probability-change-24h`）。
   * 按 `04` §3.4.1，变化缺失应写「24 小时变化尚未可得」，**不许自己算一个**。
   */
  changeNotFrozen: 'policy-probability-change-not-frozen'
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
  // 变化值只许来自事实：快照没有这条变化事实时，正文写「较上一日 +x 个百分点」就是自己算的。
  const carriesChange = snapshot.facts.some(fact => fact.metric === MARKET_ANALYSIS_POLICY_PATH_METRICS.probabilityChange24h)
  if (!carriesChange && POLICY_CHANGE_CLAIM.test(prose) && !POLICY_CHANGE_UNAVAILABLE.test(prose)) {
    return analysisProbabilityDefects.changeNotFrozen
  }
  return undefined
}

/** 「较上一日/24 小时变化 + 一个带符号数字」：这是对变化的断言。 */
const POLICY_CHANGE_CLAIM = /(?:较上一(?:日|个交易日)|24\s*(?:小时|h)\s*(?:变化|变动))[^。；;\n]{0,12}[-+＋−]?\s*\d+(?:\.\d+)?/u
/** 明确的「还没有这条变化」：允许写，不算断言。 */
const POLICY_CHANGE_UNAVAILABLE = /(?:尚未可得|暂不可得|未提供|没有变化数据)/u

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
export const analysisPercentageBindingRules = Object.freeze({
  probabilityIsALevel: 'probability-is-a-level',
  ambiguousSignedPercentage: 'ambiguous-signed-percentage'
})

export type AnalysisPercentageBindingRule =
  (typeof analysisPercentageBindingRules)[keyof typeof analysisPercentageBindingRules]

/** 带符号的数字：`+76.65%` / `-0.3 个百分点` / `+6bp`。 */
const SIGNED_NUMBER = /[+\uFF0B\-\u2212\uFF0D]\s*\d+(?:\.\d+)?\s*(?:%|\uFF05|个百分点|百分点|bp|基点)/gu
/** 变化/比较标记：有它才是「变化量」，否则是没头没尾的带符号数。 */
const CHANGE_MARKER = /(?:变化|变动|较|环比|同比|上升|下降|上调|下调|走高|走低|回落|收窄|扩大)/u
/** 增量单位：`bp` / `基点` 本身就是增量，不需要「变化」二字。 */
const INCREMENT_UNIT = /(?:bp|基点)\s*$/u
/** 概率/定价位置上的带符号值（两种语序）。 */
const SIGNED_AT_PROBABILITY = /(?:概率|定价)[^\d%。；;\n]{0,4}[+\uFF0B\-\u2212\uFF0D]\s*\d|[+\uFF0B\-\u2212\uFF0D]\s*\d+(?:\.\d+)?\s*(?:%|\uFF05)[^\d%。；;\n]{0,4}(?:概率|定价)/u

/**
 * 概率/定价位置上用**变化量单位**（`个百分点`）冒充水平值：`降息概率 3 个百分点`。
 * 它没有正负号，抓不到上面那条正则，但同样是把水平值写成了变化量。
 */
const PERCENT_POINT_AT_PROBABILITY = /(?:概率|定价)[^\d%。；;\n]{0,4}\d+(?:\.\d+)?\s*(?:个百分点|百分点)/u

export function percentageBindingDefect(conclusion: AnalysisConclusion): AnalysisPercentageBindingRule | undefined {
  const prose = conclusionProse(conclusion)
  // 没有正负号、却用变化量单位冒充水平值的写法，先整段判一次。
  if (PERCENT_POINT_AT_PROBABILITY.test(prose)) return analysisPercentageBindingRules.probabilityIsALevel
  for (const match of prose.matchAll(SIGNED_NUMBER)) {
    const start = match.index ?? 0
    const clause = clauseOf(prose, start)
    // ① 概率/定价位置上带符号：水平值被写成了变化量。
    if (SIGNED_AT_PROBABILITY.test(clause)) return analysisPercentageBindingRules.probabilityIsALevel
    // ② 增量单位：`收益率 +6bp` 是对的，不需要「变化」二字。
    if (INCREMENT_UNIT.test(match[0])) continue
    // ③ 同一子句有变化/比较标记：明确的变化量。
    if (CHANGE_MARKER.test(clause)) continue
    // 其余：读者分不清是水平还是变化 → 歧义拒。
    return analysisPercentageBindingRules.ambiguousSignedPercentage
  }
  return undefined
}

/** 命中所属的那一句（按中文句读与换行切），只用来判上下文。 */
function clauseOf(prose: string, index: number): string {
  const before = prose.slice(0, index)
  const start = Math.max(
    before.lastIndexOf('。'), before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('\n')
  ) + 1
  const after = prose.slice(index)
  const end = after.search(/[。；;\n]/u)
  return prose.slice(start, end < 0 ? prose.length : index + end)
}
