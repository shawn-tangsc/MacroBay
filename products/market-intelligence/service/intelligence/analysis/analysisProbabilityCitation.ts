import type { AgentFact, AnalysisConclusion } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_POLICY_PATH_METRICS } from '../../../contracts/marketAnalysisContracts'
import { concreteReadingPattern } from '../../../contracts/concreteAnchorPattern'

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
  changeNotFrozen: 'policy-probability-change-not-frozen',
  /**
   * 正文写的变化值与快照的变化事实**不同值**。变化**不取整**：事实是 +0.3，正文写 +0 也是另一个谎。
   */
  changeMismatch: 'policy-probability-change-mismatch'
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
  ambiguousSignedPercentage: 'ambiguous-signed-percentage',
  /** 正文写了变化值，但快照没有这条变化事实（不许自己算）。 */
  changeNotFrozen: 'policy-probability-change-not-frozen',
  /** 正文写的变化值与快照的变化事实**不同值**（变化不取整，0.3 写成 0 也是另一个谎）。 */
  changeMismatch: 'policy-probability-change-mismatch'
})

export type AnalysisPercentageBindingRule =
  (typeof analysisPercentageBindingRules)[keyof typeof analysisPercentageBindingRules]

/** 任何带符号或变化标记绑定的数字：`+76.65%` / `-0.3 个百分点` / `+6bp` / `3 个百分点`。 */
const PERCENTAGE_NUMBER = /[-+＋−－]?\s*\d+(?:\.\d+)?\s*(?:%|\uFF05|个百分点|百分点|bp|基点)/gu
/** 变化/比较标记：有它才是「变化量」，否则是没头没尾的带符号数。**全仓只有这一份词表**。 */
const CHANGE_MARKER = /(?:变化|变动|较|环比|同比|上升|下降|上调|下调|走高|走低|回落|收窄|扩大)/u
/** 增量单位：`bp` / `基点` 本身就是增量，不需要「变化」二字。 */
const INCREMENT_UNIT = /(?:bp|基点)\s*$/u

/**
 * 概率/定价位置上的带符号值（两种语序）。**只在确认「不是变化量」之后才用它**——
 * 顺序反了会误杀 `较上一日定价变化 +0.3 个百分点` 这种正确写法（架构师实测）。
 */
function signedAtProbability(clause: string): boolean {
  // 概率/定价，以及**政策动作词直接接带符号百分比**（`降息 +5%`）——那同样是概率语境。
  const keyword = '(?:概率|定价|降息|加息)'
  const after = new RegExp(`${keyword}[^\\d%。；;\\n]{0,4}[-+＋−－]\\s*\\d`, 'u')
  const before = new RegExp(`[-+＋−－]\\s*\\d+(?:\\.\\d+)?\\s*(?:%|\\uFF05)[^\\d%。；;\\n]{0,4}${keyword}`, 'u')
  return after.test(clause) || before.test(clause)
}

/**
 * 概率/定价位置上用**变化量单位**（`个百分点`）冒充水平值：`降息概率 3 个百分点`。
 * **逐子句判，且关键字与数字之间不许有变化标记**——`概率变化 3 个百分点` 是变化量，不是冒充。
 */
function percentPointAtProbability(clause: string): boolean {
  const match = /(?:概率|定价)([^\d%。；;\n]{0,8})\d+(?:\.\d+)?\s*(?:个百分点|百分点)/u.exec(clause)
  return match !== null && !CHANGE_MARKER.test(match[1] ?? '')
}

/**
 * 结论里有一句在说「概率/定价的变化」，且句中的数字。变化值必须来自事实且**同值**
 * （`04` §3.4.1：变化缺失写「24 小时变化尚未可得」，不许自己算；`0.3` 取整成 `0` 也是另一个谎）。
 */
function probabilityChangeMention(clause: string, prose: string): number | undefined {
  // 概率语境可能在**同一段的前一句**里（`…市场定价 77%，截至…；较上一日变化 +9 个百分点`），
  // 所以看整段；但数字只取当前子句里的那一个。
  if (!/(?:概率|定价)/u.test(prose)) return undefined
  if (!CHANGE_MARKER.test(clause)) return undefined
  const number = /([-+]?\s*\d+(?:\.\d+)?)\s*(?:%|\uFF05|个百分点|百分点|bp|基点)/u.exec(clause)
  if (number === null) return undefined
  const value = Number(number[1]!.replace(/\s+/gu, ''))
  return Number.isFinite(value) ? value : undefined
}

export function percentageBindingDefect(
  conclusion: AnalysisConclusion,
  /** 快照里的 24 小时变化事实值；没有这条事实就是 `undefined`。 */
  snapshot?: ProbabilityEvidence
): AnalysisPercentageBindingRule | undefined {
  const prose = conclusionProse(conclusion)
  const changeFact = changeFactOf(snapshot)
  // 正文已经明说「变化拿不到」时，不做任何变化断言判定（那句话本身就是要的写法）。
  const admitsNoChange = /(?:尚未可得|暂不可得|未提供|没有变化数据)/u.test(prose)

  for (const match of prose.matchAll(PERCENTAGE_NUMBER)) {
    const clause = clauseOf(prose, match.index ?? 0)
    // ① 增量单位：`收益率 +6bp` 是对的，不需要「变化」二字。
    if (INCREMENT_UNIT.test(match[0])) continue
    // ② 同一子句有变化/比较标记：明确的变化量（先判它，才不会误杀 `定价变化 +0.3 个百分点`）。
    if (CHANGE_MARKER.test(clause)) {
      const mentioned = probabilityChangeMention(clause, prose)
      if (mentioned === undefined || admitsNoChange) continue
      if (changeFact === undefined) return analysisPercentageBindingRules.changeNotFrozen
      if (Math.abs(mentioned - changeFact) > 0.001) return analysisPercentageBindingRules.changeMismatch
      continue
    }
    // ③ 概率/定价位置上的带符号值，或该位置用变化量单位冒充水平值：概率是水平值，不许带符号。
    if (signedAtProbability(clause) || percentPointAtProbability(clause)) {
      return analysisPercentageBindingRules.probabilityIsALevel
    }
    // ④ 绑到了**可命名的被变读数**（`BTC 24 小时 -3.2%`、`市场情绪 +5%`）：这是允许的写法。
    //    读数是词表里除政策动作与机构名之外的那部分，与日报共用 `contracts/concreteAnchorPattern`，
    //    **不在这里另写一份**。注意：概率/定价在第 ③ 步已经先判过——顺序不能反。
    if (concreteReadingPattern.test(clause)) continue
    // ⑤ 其余带符号数字：既绑不到读数、也不在概率语境，读者分不清是水平还是变化 → 歧义拒。
    if (/^[-+＋−－]/u.test(match[0].trim())) return analysisPercentageBindingRules.ambiguousSignedPercentage
  }
  return undefined
}

/** 快照里的 24 小时变化事实值；没有就是 `undefined`（不是 0——0 是一个真实的取值）。 */
function changeFactOf(snapshot: ProbabilityEvidence | undefined): number | undefined {
  const fact = snapshot?.facts.find(entry => entry.metric === MARKET_ANALYSIS_POLICY_PATH_METRICS.probabilityChange24h)
  return typeof fact?.value === 'number' && Number.isFinite(fact.value) ? fact.value : undefined
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
