import { readerFacingConclusion } from '../../../contracts/dailyBriefing'
import type {
  BriefingConclusion, BriefingConclusionSynthesis, BriefingPriorConclusion
} from '../../../contracts/dailyBriefing'
import { briefingConclusionBasis } from './dailyBriefingConclusionValidation'

/**
 * 把编辑给的那一段合成结论并进这一期。
 *
 * 两件事同时收在这里，因为它们回答同一个问题「读者看到的结论从哪来」：
 * - 有本期合成：方向、摘要、前提、证伪条件、推翻条件全部换成合成给的那份；来自旧分析快照的
 *   那几项（`readerFacingConclusion` 里列的）不进读者可见的结论——一篇之内只能有一个时点。
 * - 只有译文（旧路径）：原文照旧，只补译文。
 *
 * 返回 `undefined` 表示这一期没有要替换的结论，调用点保持原样。
 */
export function mergeEditorialConclusion(input: Readonly<{
  conclusion?: BriefingConclusion
  synthesis?: BriefingConclusionSynthesis
  translation?: string
  priorConclusions: readonly BriefingPriorConclusion[]
}>): BriefingConclusion | undefined {
  const { conclusion, synthesis, translation, priorConclusions } = input
  if (synthesis && conclusion && priorConclusions.length > 0) {
    const merged: BriefingConclusion = {
      ...conclusion,
      direction: synthesis.direction,
      summary: synthesis.summary,
      // 本次判断的前提与证伪条件必须属于这一次：旧结论的 conditions / invalidations /
      // counterEvidence 是另一次判断、另一个期限的，换成合成自己的（或没有前瞻时干脆不给，
      // 而不是照旧显示）。
      ...briefingConclusionBasis(synthesis),
      synthesis: 'agent' as const,
      synthesizedFrom: Object.freeze(priorConclusions.map((prior) => prior.id)),
      // 读者看到的「推翻条件」就是合成的这一句；数与事件已由 `validateConclusionSynthesis`
      // 对本期的数值白名单验过，指不到的数写不出来。
      refutation: synthesis.whatWouldChange,
      synthesisDetail: Object.freeze({
        ...synthesis,
        conditions: Object.freeze([...synthesis.conditions]),
        counterEvidence: Object.freeze([...synthesis.counterEvidence]),
        watch: Object.freeze([...synthesis.watch]),
        confirmed: Object.freeze([...synthesis.confirmed]),
        refuted: Object.freeze([...synthesis.refuted]),
        evidenceRefs: Object.freeze([...synthesis.evidenceRefs])
      })
    }
    return Object.freeze(readerFacingConclusion(merged))
  }
  if (translation && conclusion) {
    return Object.freeze({ ...conclusion, translation }) as BriefingConclusion
  }
  return undefined
}
