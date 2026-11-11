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
  /**
   * A percentage in the prose that the frozen snapshot does not carry.
   *
   * 旧名是 `policy-probability-not-frozen`（2026-11-11 改名）：它把「正文里有个数找不到出处」
   * 读成了「概率没冻结」，而真正的原因常常只是**负号在读取时被吃掉**。历史运行行里仍是旧码，
   * 那是事实记录、不改写；新写入一律用这个名字。
   */
  notInSnapshot: 'policy-probability-not-in-snapshot',

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
    // 概率可以写**它的整数约数**（76.65 → 76 / 77），所以这一轮也要用它那份判定；其余数只认等值。
    if (!tracedToSnapshot(value, allowed) && !tracedToProbability(value, probabilities.map(fact => Number(fact.value)))) {
      return analysisProbabilityDefects.notInSnapshot
    }
  }
  const probabilityValues = probabilities.map(fact => Number(fact.value))
  // 整段没有一处提到快照里的概率 → 与原来的「回避」同一个缺陷（事实判据，不靠关键词）。
  if (!mentioned.some(value => tracedToProbability(value, probabilityValues))) return analysisProbabilityDefects.absent
  for (const fact of probabilities) {
    const value = Number(fact.value)
    if (mentioned.some(candidate => tracedToProbability(candidate, [value])) && !mentionsInstant(prose, fact.observedAt!)) {
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
  // **负号是数字的一部分**（2026-11-11 的真事故）：正文写「3 天 -2.75%」、快照是 -2.74955757589076，
  // 旧读法把负号吃掉、拿 2.75 去比，于是每次都被判「快照里没有这个数」。
  // 但 `3.75%-4.00%` 里的短横是**范围连接符**，不是负号——所以只有当它前面不是数字、不是百分号、
  // 也不是另一个破折号时才算负号。全角减号 `−` 一并认。
  return [...text.matchAll(/(?<![\d%\uFF05\u2013\u2014])([-\u2212])?(\d+(?:\.\d+)?)\s*(?:%|\uFF05)/gu)]
    .map(match => Number(`${match[1] === undefined ? '' : '-'}${match[2]}`))
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

/**
 * 概率的整数约数：**同一个数相邻的那两个整数**，不是「差得不多」。
 *
 * 76.65 写 76（舍）或 77（入）都是合规写法（用户 2026-11-08：正文每个数都要有出处，约数是写法
 * 不是编数）；75 离它一格半，仍是编造。边界写死在「floor / ceil 之一且候选是整数」，不做容差——
 * 一旦改成容差，编出来的数就会顺着容差溜进来。
 */
function tracedToProbability(value: number, probabilities: readonly number[]): boolean {
  return probabilities.some(candidate =>
    Math.abs(candidate - value) < 0.05 ||
    Math.abs(Math.round(candidate) - value) < 0.05 ||
    (Number.isInteger(value) && !Number.isInteger(candidate) &&
      (value === Math.floor(candidate) || value === Math.ceil(candidate))))
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
