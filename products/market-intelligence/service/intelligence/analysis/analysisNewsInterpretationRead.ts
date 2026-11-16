import type { NewsInterpretationReadResult } from '../../../contracts/marketAnalysisIpcContracts'
import { buildEvidenceFingerprint } from './analysisHash'
import { prepareMarketAnalysisSnapshot, type PreparationDependencies } from './analysisSnapshotPreparation'
import { isNewsSeveritySource } from './analysisItemSeverity'

/**
 * 「AI 解读」的只读判读：这条新闻有没有已有解读、是哪份证据的。
 *
 * 判断「查看 / 再次解读」只比一对证据指纹；`snapshotHash` 的输入含 `asOf`，读写两侧各算一次必然
 * 不同，拿它判会永远显示「再次解读」。当前指纹走与冻结**同一条**预计算
 * （`prepareMarketAnalysisSnapshot`），不许另写一份组装逻辑。
 */
export function createNewsInterpretationReader(
  deps: PreparationDependencies & Readonly<{ now: () => string }>
): (itemId: string) => Promise<NewsInterpretationReadResult> {
  /** 此刻会冻结成的那份证据的指纹；建不出（没有判定、或建不出证据引用）就是 null。 */
  async function currentFingerprint(itemId: string): Promise<string | null> {
    const item = deps.pipeline.listItems().find(candidate => candidate.itemId === itemId)
    if (!item) return null
    const group = deps.repository.listEventGroups().find(candidate => candidate.eventRefs.includes(itemId))
    if (!group) return null
    try {
      const prepared = await prepareMarketAnalysisSnapshot({ ...deps }, {
        eventGroupId: group.id, asOf: deps.now(),
        ...(isNewsSeveritySource(item.sourceId) ? { triggeredItemId: itemId } : {})
      })
      return 'state' in prepared ? null : prepared.evidenceFingerprint
    } catch {
      return null
    }
  }

  return async function readNewsInterpretation(itemId: string): Promise<NewsInterpretationReadResult> {
    const item = deps.pipeline.listItems().find(candidate => candidate.itemId === itemId)
    const currentEvidenceFingerprint = await currentFingerprint(itemId)
    if (!item) return { itemId, state: 'none', currentEvidenceFingerprint }
    const group = deps.repository.listEventGroups().find(candidate => candidate.eventRefs.includes(itemId))
    if (!group) return { itemId, state: 'none', currentEvidenceFingerprint }
    const runs = deps.repository.listRuns().filter(run => run.eventGroupId === group.id)
    const inFlight = runs.find(run => run.status === 'queued' || run.status === 'running')
    if (inFlight) return { itemId, state: 'in-flight', runId: inFlight.id, currentEvidenceFingerprint }
    // 最近一次「成功、且它的快照就是为这条新闻冻的」：同组别的条目的摘要不能算这条的解读。
    const answered = runs
      .filter(run => run.status === 'succeeded')
      .sort((left, right) => (right.completedAt ?? right.queuedAt).localeCompare(left.completedAt ?? left.queuedAt))
      .map(run => ({ run, snapshot: deps.repository.getSnapshot(run.snapshotId) }))
      .find(entry => entry.snapshot?.trigger?.itemId === itemId)
    if (!answered?.snapshot) return { itemId, state: 'none', currentEvidenceFingerprint }
    const snapshot = answered.snapshot
    const triggerFact = snapshot.facts.find(fact => fact.factId === snapshot.trigger?.factId)
    return {
      itemId, state: 'available', runId: answered.run.id,
      ...(answered.run.completedAt ? { generatedAt: answered.run.completedAt } : {}),
      snapshotHash: snapshot.snapshotHash,
      dataAsOf: snapshot.asOf,
      evidenceScope: {
        asOf: snapshot.asOf, dataCutoff: snapshot.dataCutoff,
        factCount: snapshot.facts.length, evidenceRefCount: snapshot.evidenceRefs.length,
        domains: [...new Set(snapshot.facts.map(fact => fact.domain))].sort()
      },
      evidenceFingerprint: buildEvidenceFingerprint({ facts: snapshot.facts, evidenceRefs: snapshot.evidenceRefs }),
      currentEvidenceFingerprint,
      ...(triggerFact?.subjectLabel ? { subjectLabel: triggerFact.subjectLabel } : {})
    }
  }
}
