import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { AgentFact, EvidenceSnapshot, SnapshotChange } from '../../../contracts/marketAnalysisContracts'
import type { FrozenAnalysisEvidence } from './analysisOutputValidator'
import type { TriggerFocus } from './analysisTriggerFocus'
import { resolveTriggerFocus } from './analysisTriggerFocus'
import { withSnapshotChange } from './snapshotChange'
import { changeValuesForPrompt } from './analysisChangeValues'

/**
 * 这一跑真正冻结给模型的那份证据：快照 + 变更记录 + 语言。
 *
 * 从 `analysisOrchestrator` 里抽出来的理由不是行数（虽然它也是）：这段有**两条**容易写错的规矩——
 * 快照哈希必须与运行记录一致（不一致就是换过证据，整跑作废），以及事实必须是「证据引用能落到本快照」
 * 的那一批（引用不到的事实不许进提示词）。放在一处，下一次改冻结口径只有这一个地方。
 *
 * `changeValues` 是**第二个集合**（架构师 2026-11-11 的决定）：只给「正文里的数字有没有出处」
 * 那条规则读，不进 `facts`——合成事实会多出不存在的 factId，并让同一个 metric 前后出现两条。
 */
export type FrozenRunEvidence =
  | Readonly<{
    state: 'ready'
    snapshot: EvidenceSnapshot
    withChange: EvidenceSnapshot & { change: SnapshotChange }
    facts: readonly AgentFact[]
    frozenEvidence: FrozenAnalysisEvidence
    triggerFocus: TriggerFocus
    /** 提示词渲染用的语言；读不到就 `undefined`，与收窄前一致。 */
    proseLanguage: AppLanguage | undefined
  }>
  | Readonly<{ state: 'failed'; failureCode: 'analysis-snapshot-changed' | 'analysis-missing-evidence' }>

export async function frozenEvidenceForRun(input: Readonly<{
  run: Readonly<{ snapshotId: string; snapshotHash: string; eventGroupId: string }>
  repository: Readonly<{
    getSnapshot?: (id: string) => EvidenceSnapshot | undefined
    listSnapshots?: (eventGroupId: string) => readonly EvidenceSnapshot[]
  }>
  getLanguage?: () => Promise<AppLanguage> | AppLanguage
}>): Promise<FrozenRunEvidence> {
  const snapshot = input.repository.getSnapshot?.(input.run.snapshotId)
    ?? input.repository.listSnapshots?.(input.run.eventGroupId).find(value => value.id === input.run.snapshotId)
  if (!snapshot || snapshot.snapshotHash !== input.run.snapshotHash) {
    return { state: 'failed', failureCode: 'analysis-snapshot-changed' }
  }
  // 老快照没有变更记录：从不可变的前一份推出来，模型总能读到「动了什么」。
  const withChange = withSnapshotChange(snapshot, input.repository.listSnapshots?.(input.run.eventGroupId) ?? [])
  const evidenceIds = new Set(withChange.evidenceRefs.map(ref => ref.evidenceRefId))
  const facts = withChange.facts.filter(fact => fact.evidenceRefId && evidenceIds.has(fact.evidenceRefId))
  if (!facts.length) return { state: 'failed', failureCode: 'analysis-missing-evidence' }
  const proseLanguage = input.getLanguage === undefined ? undefined : await input.getLanguage()
  // 「模型真看过的那些数」只能从**渲染出来的变更摘要**里取：同一 formatter、同一语言，且天然尊重
  // `maximumFactChanges` 的截断（没印出来的不算出处）。
  const changeValues = changeValuesForPrompt(withChange.change, proseLanguage ?? 'zh-CN')
  return {
    state: 'ready',
    snapshot,
    withChange,
    facts,
    frozenEvidence: {
      facts,
      evidenceRefs: withChange.evidenceRefs,
      ...(changeValues === undefined ? {} : { changeValues })
    },
    // 从冻结快照解出来，判的是这次真正持有的问题。
    triggerFocus: resolveTriggerFocus(withChange),
    proseLanguage
  }
}
