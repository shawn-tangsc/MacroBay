import { describe, expect, it, vi } from 'vitest'

import { buildAnalysisIdempotencyKey } from './analysisHash'
import { createAnalysisRunService } from './analysisRunService'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { buildAnalysisSnapshotHash } from './analysisHash'
import type { AnalysisRun, EvidenceSnapshot, EventGroup } from '../../../contracts/marketAnalysisContracts'

const asOf = '2026-09-27T00:00:00.000Z'
describe('analysisRunService', () => {
  it('uses the canonical idempotency key and returns an existing run without incrementing attempts', () => {
    const enqueueRun = vi.fn((run) => ({ created: true, run }))
    const service = createAnalysisRunService({ repository: { enqueueRun } as never, now: () => asOf, idFactory: () => 'mi-ar-1' })
    const input = { eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'hash', analysisPhase: 'initial' as const, triggerKey: 'macro.actual.first-confirmed' }
    const result = service.enqueue(input)
    expect(result.run.idempotencyKey).toBe(buildAnalysisIdempotencyKey(input))
    expect(result.run.attempt).toBe(1)
    expect(enqueueRun).toHaveBeenCalledOnce()
  })

  it('records the model the run was queued for, and leaves it empty when none was chosen', () => {
    const enqueueRun = vi.fn((run) => ({ created: true, run }))
    const service = createAnalysisRunService({ repository: { enqueueRun } as never, now: () => asOf, idFactory: () => 'mi-ar-1' })
    const base = { eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'hash', analysisPhase: 'initial' as const, triggerKey: 'macro.actual.first-confirmed' }

    expect(service.enqueue({ ...base, model: { providerId: 'provider-1', modelId: 'model-1' } }).run)
      .toMatchObject({ modelProviderId: 'provider-1', modelId: 'model-1' })
    // A run queued without a model keeps the null pair, and the invocation then follows the
    // platform default rather than inventing a model here.
    expect(service.enqueue(base).run).toMatchObject({ modelProviderId: null, modelId: null })
  })

  it('converts running runs to failed runtime-recovered on restart', () => {
    const updateRunStatus = vi.fn(() => true)
    const service = createAnalysisRunService({ repository: { updateRunStatus, listRuns: () => [{ id: 'mi-ar-1', status: 'running' }] } as never, now: () => asOf, idFactory: () => 'mi-ar-2' })
    expect(service.recover()).toEqual({ failed: ['mi-ar-1'], stale: [], dispatch: [] })
    expect(updateRunStatus).toHaveBeenCalledWith({ id: 'mi-ar-1', status: 'failed', failureCode: 'runtime-recovered', failureDetailCode: 'runtime-recovered', completedAt: asOf })
  })

  it('uses the repository unique index to return the same persisted run for an identical snapshot', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    const eventGroup: EventGroup = { id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official|US|2026-08|CPI', firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-27T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf }
    const snapshot: EvidenceSnapshot = { id: 'mi-es-1', schemaVersion: 1, eventGroupId: eventGroup.id, asOf, dataCutoff: asOf, snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts: [], missingDomains: [], caveats: [], evidenceRefs: [] }), profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' }
    repository.appendEventGroup(eventGroup)
    repository.appendSnapshot(snapshot)
    const service = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => `mi-ar-${Math.random()}` })
    const input = { eventGroupId: eventGroup.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash, analysisPhase: 'initial' as const, triggerKey: 'macro.actual.first-confirmed' }
    const first = service.enqueue(input)
    const second = service.enqueue(input)
    expect(first.created).toBe(true)
    expect(second).toEqual({ created: false, run: first.run })
    repository.close()
  })

  it('persists an auditable skipped trigger ledger record', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    const eventGroup: EventGroup = { id: 'mi-eg-ledger', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official|US|2026-08|CPI', firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-27T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf }
    repository.appendEventGroup(eventGroup)
    const service = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => 'ledger-id' })
    service.recordDecision({ eventGroupId: eventGroup.id, triggerKey: 'macro.actual.first-confirmed', changeHash: 'change-hash', decision: 'skipped', reasonCode: 'cooldown-active' })
    service.recordDecision({ eventGroupId: eventGroup.id, triggerKey: 'macro.actual.first-confirmed', changeHash: 'change-hash', decision: 'skipped', reasonCode: 'cooldown-active' })
    expect(repository.listTriggerLedger(eventGroup.id)).toEqual([expect.objectContaining({
      eventGroupId: eventGroup.id, decision: 'skipped', reasonCode: 'cooldown-active', snapshotHash: null, analysisRunId: null
    })])
    repository.close()
  })

  it('keeps only the newest snapshot active and compensates one valid initial run after restart', () => {
    const latestAt = '2026-09-27T00:10:00.000Z'
    const group: EventGroup = { id: 'mi-eg-recovery', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official|US|2026-08|CPI', firstObservedAt: asOf, lastObservedAt: latestAt, reviewDeadlineAt: '2026-09-27T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: latestAt }
    const oldSnapshot = makeSnapshot('mi-es-old', group.id, asOf, 'old-hash')
    const latestSnapshot = makeSnapshot('mi-es-latest', group.id, latestAt, 'latest-hash')
    const queued: AnalysisRun = { ...makeRun('mi-ar-old', group.id, oldSnapshot.id, oldSnapshot.snapshotHash), status: 'queued', analysisPhase: 'initial' }
    const created: AnalysisRun[] = []
    const updateRunStatus = vi.fn(() => true)
    const repository = {
      listRuns: () => [queued],
      listEventGroups: () => [group],
      listSnapshots: () => [oldSnapshot, latestSnapshot],
      updateRunStatus,
      enqueueRun: vi.fn((run: AnalysisRun) => { created.push(run); return { created: true, run } }),
      appendTriggerLedger: vi.fn()
    }
    const service = createAnalysisRunService({ repository: repository as never, now: () => '2026-09-27T00:20:00.000Z', idFactory: () => 'mi-ar-recovered' })
    expect(service.recover()).toEqual({
      failed: [],
      stale: ['mi-ar-old'],
      dispatch: [{ analysisRunId: 'mi-ar-recovered', eventGroupId: group.id }]
    })
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: queued.id, status: 'stale', failureCode: 'restart-expired' }))
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ eventGroupId: group.id, snapshotId: latestSnapshot.id, snapshotHash: latestSnapshot.snapshotHash, analysisPhase: 'initial', status: 'queued' })
  })

  it('re-dispatches a queued run that points at the active snapshot and was never claimed', () => {
    // The observed orphan: the row exists, no `runMarketAnalysis` job ever did. Nothing in
    // the run lifecycle can move it, so recovery must hand it back to the caller.
    const latestAt = '2026-09-27T00:10:00.000Z'
    const group: EventGroup = { id: 'mi-eg-orphan', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|orphan', firstObservedAt: asOf, lastObservedAt: latestAt, reviewDeadlineAt: '2026-09-27T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: latestAt }
    const latestSnapshot = makeSnapshot('mi-es-active', group.id, latestAt, 'active-hash')
    const orphan: AnalysisRun = { ...makeRun('mi-ar-orphan', group.id, latestSnapshot.id, latestSnapshot.snapshotHash), status: 'queued' }
    const repository = {
      listRuns: () => [orphan], listEventGroups: () => [group], listSnapshots: () => [latestSnapshot],
      updateRunStatus: vi.fn(() => true), enqueueRun: vi.fn(), appendTriggerLedger: vi.fn()
    }
    const service = createAnalysisRunService({ repository: repository as never, now: () => '2026-09-27T00:20:00.000Z', idFactory: () => 'mi-ar-unused' })
    expect(service.recover()).toEqual({ failed: [], stale: [], dispatch: [{ analysisRunId: orphan.id, eventGroupId: group.id }] })
    expect(repository.enqueueRun).not.toHaveBeenCalled()
  })

  it('expires a queued run whose snapshot is past the restart window instead of blocking the group', () => {
    const latestAt = '2026-09-27T00:10:00.000Z'
    const group: EventGroup = { id: 'mi-eg-expired', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|expired', firstObservedAt: asOf, lastObservedAt: latestAt, reviewDeadlineAt: '2026-09-27T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: latestAt }
    const latestSnapshot = makeSnapshot('mi-es-expired', group.id, latestAt, 'expired-hash')
    const orphan: AnalysisRun = { ...makeRun('mi-ar-stuck', group.id, latestSnapshot.id, latestSnapshot.snapshotHash), status: 'queued' }
    const updateRunStatus = vi.fn(() => true)
    const appendTriggerLedger = vi.fn()
    const repository = { listRuns: () => [orphan], listEventGroups: () => [group], listSnapshots: () => [latestSnapshot], updateRunStatus, enqueueRun: vi.fn(), appendTriggerLedger }
    // Two hours later: publishing an analysis over this snapshot would present stale evidence
    // as the current conclusion, and leaving it queued blocks every manual request.
    const service = createAnalysisRunService({ repository: repository as never, now: () => '2026-09-27T02:10:00.000Z', idFactory: () => 'mi-ar-unused' })
    expect(service.recover()).toEqual({ failed: [], stale: ['mi-ar-stuck'], dispatch: [] })
    expect(updateRunStatus).toHaveBeenCalledWith({ id: 'mi-ar-stuck', status: 'stale', failureCode: 'restart-expired', failureDetailCode: 'restart-expired', completedAt: '2026-09-27T02:10:00.000Z' })
    expect(appendTriggerLedger).toHaveBeenCalledWith(expect.objectContaining({ analysisRunId: 'mi-ar-stuck', reasonCode: 'restart-expired', decision: 'skipped' }))
  })
})

function makeSnapshot(id: string, eventGroupId: string, createdAt: string, snapshotHash: string): EvidenceSnapshot {
  return { id, schemaVersion: 1, eventGroupId, asOf: createdAt, dataCutoff: createdAt, snapshotHash, profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [], createdAt, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' }
}

function makeRun(id: string, eventGroupId: string, snapshotId: string, snapshotHash: string): AnalysisRun {
  return { id, schemaVersion: 1, eventGroupId, snapshotId, snapshotHash, analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: id, status: 'queued', attempt: 1, retryOfRunId: null, modelProviderId: null, modelId: null, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1', promptVersion: 'market-analysis-v1', skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null }
}
