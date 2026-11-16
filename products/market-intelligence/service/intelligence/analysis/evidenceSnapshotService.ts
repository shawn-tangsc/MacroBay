import type { EvidenceSnapshot, MarketAnalysisContextAvailable, SnapshotTrigger } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { computeSnapshotChange } from './snapshotChange'

export type EvidenceSnapshotService = Readonly<{
  freeze: (input: Readonly<{
    eventGroupId: string
    context: MarketAnalysisContextAvailable
    /** The predecessor in the same event group, used for the frozen change record. */
    previous?: Pick<EvidenceSnapshot, 'snapshotHash' | 'change' | 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs'>
    /**
     * 触发指针（R37）：这次运行被哪条新闻发起。只有新闻触发才给；它不进 `snapshotHash`
     * （指纹是证据的指纹，指针是「为什么跑」），也不进变化记录。
     */
    trigger?: SnapshotTrigger
  }>) => EvidenceSnapshot
}>

export function createEvidenceSnapshotService(deps: Readonly<{ now: () => string; idFactory: () => string }>): EvidenceSnapshotService {
  const freeze = (input: Parameters<EvidenceSnapshotService['freeze']>[0]): EvidenceSnapshot => {
    if (input.context.state !== 'available' || input.context.eventGroupId !== input.eventGroupId) throw new Error('analysis-snapshot-input-invalid')
    const facts = input.context.facts.map(fact => ({ ...fact })).sort((left, right) => left.domain.localeCompare(right.domain) || left.factId.localeCompare(right.factId))
    const missingDomains = [...input.context.missingDomains].sort()
    const caveats = [...input.context.caveats].sort()
    const evidenceRefs = input.context.evidenceRefs.map(ref => ({ ...ref })).sort((left, right) => left.evidenceRefId.localeCompare(right.evidenceRefId))
    // The change record is written for auditability but kept out of `snapshotHash`
    // (see `buildAnalysisSnapshotHash`), so persisted snapshots stay valid.
    const change = computeSnapshotChange({ current: { facts, missingDomains, caveats, evidenceRefs }, ...(input.previous ? { previous: input.previous } : {}) })
    const snapshotHash = buildAnalysisSnapshotHash({ profileId: input.context.profileId, asOf: input.context.asOf, dataCutoff: input.context.dataCutoff, facts, missingDomains, caveats, evidenceRefs })
    return deepFreeze({
      id: deps.idFactory(), schemaVersion: MARKET_ANALYSIS_CONTRACT_POLICY.schemaVersion, eventGroupId: input.eventGroupId, asOf: input.context.asOf,
      dataCutoff: input.context.dataCutoff, snapshotHash, profileId: input.context.profileId, facts,
      missingDomains, caveats, evidenceRefs, sourceHealth: input.context.sourceHealth.map(item => ({ ...item })),
      change, ...(input.trigger ? { trigger: input.trigger } : {}), createdAt: deps.now(), policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
    })
  }
  return { freeze }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
