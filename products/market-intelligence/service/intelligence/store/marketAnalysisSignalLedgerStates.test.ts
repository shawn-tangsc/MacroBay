import { describe, expect, it } from 'vitest'

import { createHash } from 'node:crypto'

import { queuedSignalEvidence } from '../../../contracts/moduleSignalEvidence'
import type { EventGroup, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import type { SignalWindow } from '../../../contracts/moduleSignal'
import { buildAnalysisSnapshotHash } from '../analysis/analysisHash'
import { createMarketAnalysisRepository } from './marketAnalysisRepository'

const at = '2026-11-06T10:30:00.000Z'
const window: SignalWindow = { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }
const signal = {
  version: '1', moduleId: 'open-interest' as const, ruleId: 'oi-liquidation-proxy', asset: 'btc' as const,
  severity: 'high' as const, observedAt: '2026-11-06T10:15:00.000Z', cadence: { kind: 'intraday' as const, bucketMs: 15 * 60_000 },
  values: { dropPct: -2.7, volumeMultiple: 3.4 }, dedupeKey: 'oi|btc|10:15',
  readiness: 'available' as const, triggerOwner: 'module-signal'
}

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'funding',
  mergeKey: 'signal|open-interest|2026-11-06', firstObservedAt: at, lastObservedAt: at,
  reviewDeadlineAt: at, eventRefs: [], triggerCount: 0, reviewCount: 0,
  currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: at, updatedAt: at
}

function snapshot(): EvidenceSnapshot {
  const facts = [{ factId: 'fact-1', domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value: '3.1', unit: '%', sourceId: 'source-fed', sourceLabel: '官方', observedAt: at, asOf: at, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-1' }]
  const evidenceRefs = [{ evidenceRefId: 'ev-1', sourceId: 'source-fed', sourceLabel: '官方', itemId: null, occurredAt: at, publishedAt: at, detectedAt: at, computedAt: null, visibleAt: at, excerptHash: createHash('sha256').update('ev-1').digest('hex') }]
  return {
    id: 'mi-es-1', schemaVersion: 1 as const, eventGroupId: group.id, asOf: at, dataCutoff: at,
    snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf: at, dataCutoff: at, facts, missingDomains: [], caveats: [], evidenceRefs }),
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [{ sourceId: 'source-fed', status: 'healthy' as const, asOf: at }],
    createdAt: at, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function harness() {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  repository.appendEventGroup(group)
  repository.appendSignalTrigger({
    id: 'mi-ledger-1', eventGroupId: group.id, triggerKey: 'signal.open-interest.oi-liquidation-proxy',
    changeHash: signal.dedupeKey, reasonCode: 'signal-high-triggered',
    evidence: queuedSignalEvidence([{ signal, window }]), createdAt: at
  })
  return repository
}

describe('the run id write-back', () => {
  // 这一条只钉「回写动作本身」：账本那一行上的运行 id 从空变成非空。漏掉这一步，牌子会永远停在
  // 「已排上队」，而且不会报错——所以钉的是这一列，不是最后那句文案。
  it('turns the ledger row’s run id from null into the run it produced', () => {
    const repository = harness()
    expect(repository.listLatestSignalLedgerStates([signal.dedupeKey]))
      .toEqual([{ changeHash: signal.dedupeKey, decision: 'queued', reasonCode: 'signal-high-triggered', analysisRunId: null }])

    // 先把这次尝试真的产出成一行运行（外键指向它），再回写——回写本身才是被钉的那一步。
    const stored = snapshot()
    repository.appendSnapshot(stored)
    repository.enqueueRun({
      id: 'mi-ar-1', schemaVersion: 1, eventGroupId: group.id, snapshotId: stored.id, snapshotHash: stored.snapshotHash,
      analysisPhase: 'correction', triggerKey: 'signal.open-interest.oi-liquidation-proxy', idempotencyKey: 'idem-1',
      status: 'queued', attempt: 1, retryOfRunId: null, modelProviderId: 'p', modelId: 'm',
      policyVersion: 'policy', promptVersion: 'prompt', skillVersion: 'skill', outputSchemaVersion: 1,
      jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null, validationMode: null,
      queuedAt: at, startedAt: null, completedAt: null
    })
    expect(repository.linkTriggerLedgerRun({ id: 'mi-ledger-1', analysisRunId: 'mi-ar-1', snapshotHash: stored.snapshotHash })).toBe(true)

    expect(repository.listLatestSignalLedgerStates([signal.dedupeKey])[0]?.analysisRunId).toBe('mi-ar-1')
  })

  it('takes the latest row per change hash and answers one query for a screenful', () => {
    const repository = harness()
    // 同一个 change hash 在另一组里又落了一行：牌子上必须显示最新那次，不回退。
    repository.appendEventGroup({ ...group, id: 'mi-eg-2', mergeKey: 'signal|open-interest|2026-11-06-b' })
    repository.appendSignalTrigger({
      id: 'mi-ledger-2', eventGroupId: 'mi-eg-2', triggerKey: 'signal.open-interest.oi-liquidation-proxy',
      changeHash: signal.dedupeKey, reasonCode: 'signal-high-triggered',
      evidence: queuedSignalEvidence([{ signal, window }]), createdAt: '2026-11-06T10:45:00.000Z'
    })

    const rows = repository.listLatestSignalLedgerStates([signal.dedupeKey, 'never-seen'])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.changeHash).toBe(signal.dedupeKey)
    // 查不到的那个 hash 不凭空造一行。
    expect(repository.listLatestSignalLedgerStates([])).toEqual([])
  })
})
