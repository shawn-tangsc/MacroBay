import type { Catalyst } from '../../../contracts/marketAnalysisContracts'
import type { ValidatedAnalysisModelOutput } from './analysisOutputValidator'
import { eventKeyOfEvidenceRef } from './macroEvidenceRef'

/**
 * 引用的两条判据：**引用了什么**、**指向哪一场**。
 *
 * 从 `analysisOutputValidator` 抽出来的唯一原因是体积门禁（那里已经到 500 行上限），判据本身没有变：
 * 这里只读快照与输出里的 id / 键，不读任何给读者看的那句话——读句子等于用词表猜事实。
 */

/** 每条引用都必须是冻结快照里真的有的 id：事实 id 与证据引用 id 各一组。 */
export function hasKnownReferences(output: ValidatedAnalysisModelOutput, factIds: ReadonlySet<string>, evidenceRefIds: ReadonlySet<string>): boolean {
  const referencedFactIds = [
    ...output.knownFacts.map((claim) => claim.factId),
    ...output.marketReaction.flatMap((claim) => claim.factIds)
  ]
  const referencedEvidenceIds = [
    ...output.knownFacts.flatMap((claim) => claim.evidenceRefIds),
    ...output.transmissionHypotheses.flatMap((claim) => claim.evidenceRefIds),
    ...output.marketReaction.flatMap((claim) => claim.evidenceRefIds),
    ...output.supportingEvidence.map((claim) => claim.evidenceRefId),
    ...output.counterEvidence.map((claim) => claim.evidenceRefId),
    ...output.nextCatalysts.flatMap((claim) => claim.evidenceRefIds),
    ...output.directions.flatMap(entry => entry.evidenceRefIds),
    ...output.evidenceRefs
  ]
  return referencedFactIds.every((reference) => factIds.has(reference)) &&
    referencedEvidenceIds.every((reference) => evidenceRefIds.has(reference))
}

/**
 * 催化剂写的 `calendarEventKey` 必须等于快照里某条日历事实的 `eventKey`。
 *
 * 日历事实的证据引用是 `macro-calendar:<sourceId>:<eventKey>`（`public-query/marketAnalysisContextProjection.ts`），
 * eventKey 原样带在里面（官方键里的点号不会被 `factId` 的清洗吃掉）——所以这里读引用，不读那句话。
 */
export function catalystsReferToKnownCalendarEvents(
  catalysts: readonly Catalyst[],
  facts: readonly Readonly<{ evidenceRefId?: string | null }>[]
): boolean {
  const calendarEventKeys = new Set(
    facts
      .map((fact) => fact.evidenceRefId)
      .filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('macro-calendar:'))
      .map((ref) => eventKeyOfEvidenceRef(ref))
      .filter((key): key is string => key !== null)
  )
  return catalysts.every((catalyst) => catalyst.calendarEventKey === undefined || calendarEventKeys.has(catalyst.calendarEventKey))
}
