import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJobRuntime } from '@platform/jobs'
import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { createAnalysisRunService } from '../analysis/analysisRunService'
import { buildAnalysisSnapshotHash } from '../analysis/analysisHash'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'
import { createInitialMarketAnalysisRequest } from './requestInitialMarketAnalysis'

const asOf = '2026-10-04T00:00:00.000Z'
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })

function setup() {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  const jobRuntime = createJobRuntime()
  cleanups.push(() => { jobRuntime.stopAll(); repository.close() })
  const items: IntelligenceItem[] = [{
    itemId: 'item-original', primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'dedupe-1', sourceId: 'source-1',
    eventType: 'news', title: '市场消息', sourceCategory: 'news', sourceTrust: 'high', detectedAt: asOf,
    publishedAt: asOf, timelineStatus: 'evaluated', normalizerVersion: 'v1',
    processingLabelsJson: JSON.stringify({ relevanceOutcome: 'full-intelligence', sentimentEligible: true })
  }]
  const group: EventGroup = {
    id: 'mi-eg-original', schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: 'original',
    firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-10-04T02:00:00.000Z',
    eventRefs: ['item-original'], triggerCount: 0, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  }
  repository.appendEventGroup(group)
  const deps = { repository, jobRuntime, listItems: () => items, now: () => asOf,
    createGroup: (itemId: string) => {
      const created = { ...group, id: `mi-eg-${itemId}`, mergeKey: itemId, eventRefs: [itemId] }
      repository.appendEventGroup(created)
      return created
    }
  }
  const freeze = vi.fn(async () => {})
  jobRuntime.registerHandler(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, () => freeze())
  const failedRun = () => {
    const snapshot = { id: 'mi-es-original', schemaVersion: 1 as const, eventGroupId: group.id, asOf, dataCutoff: asOf,
      profileId: 'crypto-market-analysis-v1' as const, facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
      sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' as const }
    const snapshotHash = buildAnalysisSnapshotHash(snapshot)
    repository.appendSnapshot({ ...snapshot, snapshotHash })
    const { run } = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => 'mi-ar-original' })
      .enqueue({ eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash, analysisPhase: 'initial', triggerKey: 'manual.initial' })
    repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: 'analysis-provider-error' })
    return run.id
  }
  const request = createInitialMarketAnalysisRequest(deps)
  return { ...deps, items, group, failedRun, freeze, request, queuedRun }

  /** A correction run left in `queued`: from the gate's point of view, work already on its way. */
  function queuedRun() {
    const snapshot = { id: 'mi-es-inflight', schemaVersion: 1 as const, eventGroupId: group.id, asOf, dataCutoff: asOf,
      profileId: 'crypto-market-analysis-v1' as const, facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
      sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' as const }
    const snapshotHash = buildAnalysisSnapshotHash(snapshot)
    repository.appendSnapshot({ ...snapshot, snapshotHash })
    return createAnalysisRunService({ repository, now: () => asOf, idFactory: () => 'mi-ar-inflight' })
      .enqueue({ eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash, analysisPhase: 'correction', triggerKey: 'manual.refresh' }).run.id
  }
}

describe('createInitialMarketAnalysisRequest', () => {
  it('keeps retries bound to the failed event when a newer item arrives', async () => {
    const fixture = setup()
    const runId = fixture.failedRun()
    fixture.items.push({ ...fixture.items[0]!, itemId: 'item-newer', detectedAt: '2026-10-04T00:01:00.000Z' })
    await expect(fixture.request(undefined, runId, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    expect(fixture.jobRuntime.listRuns()).toEqual([expect.objectContaining({ payload: expect.objectContaining({ eventGroupId: fixture.group.id }) })])
    expect(fixture.repository.listEventGroups()).toHaveLength(1)
  })

  it('rejects a retry whose event group cannot be resolved instead of choosing a new item', async () => {
    const fixture = setup()
    const runId = fixture.failedRun()
    vi.spyOn(fixture.repository, 'getEventGroup').mockReturnValue(undefined)
    await expect(fixture.request(undefined, runId, 'initial', 'manual')).rejects.toThrow('analysis-invalid-request')
    expect(fixture.jobRuntime.listRuns()).toHaveLength(0)
  })

  it('rejects an unknown retry run without creating jobs', async () => {
    const fixture = setup()
    await expect(fixture.request(undefined, 'missing', 'initial', 'manual')).rejects.toThrow('analysis-invalid-request')
    expect(fixture.jobRuntime.listRuns()).toHaveLength(0)
  })

  it('answers a concurrent manual request with the in-flight run instead of refusing the click', async () => {
    const fixture = setup()
    const gate = Promise.withResolvers<void>()
    fixture.freeze.mockImplementation(() => gate.promise)
    const first = fixture.request(undefined, undefined, 'initial', 'manual')
    try {
      // The single-flight guard still holds: one freeze job, not two.
      await expect(fixture.request(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
      expect(fixture.jobRuntime.listRuns()).toHaveLength(1)
    } finally { gate.resolve(); await first }
  })

  it('does not report queued for a failed freeze and permits an explicit retry', async () => {
    const fixture = setup()
    fixture.freeze.mockRejectedValueOnce(new Error('query-unavailable'))
    await expect(fixture.request(undefined, undefined, 'initial', 'manual')).rejects.toThrow('analysis-initial-request-failed')
    await expect(fixture.request(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    expect(fixture.jobRuntime.listRuns().map(run => run.status).sort()).toEqual(['completed', 'failed'])
  })

  it('does not start a second run after the UI wait times out while the job continues', async () => {
    const fixture = setup()
    const gate = Promise.withResolvers<void>()
    fixture.freeze.mockImplementation(() => gate.promise)
    const wait = vi.spyOn(fixture.jobRuntime, 'waitForRunTerminal').mockResolvedValue({ state: 'timeout' })
    try {
      await expect(fixture.request(undefined, undefined, 'initial', 'manual')).rejects.toThrow('analysis-initial-request-failed')
      // A new requester has no local pending state; the job runtime remains authoritative,
      // and the job still running is the answer it gets.
      const secondRequest = createInitialMarketAnalysisRequest(fixture)
      await expect(secondRequest(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
      expect(fixture.jobRuntime.listRuns()).toHaveLength(1)
    } finally {
      wait.mockRestore()
      gate.resolve()
      await Promise.all(fixture.jobRuntime.listRuns().map(run => fixture.jobRuntime.waitForRunTerminal(run.id)))
    }
    await expect(fixture.request(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
  })

  it('allows an explicit refresh to create a new correction run while preserving the current summary', async () => {
    const fixture = setup()
    vi.spyOn(fixture.repository, 'listEventGroups').mockReturnValue([{ ...fixture.group, currentSummaryId: 'mi-as-existing' }])

    await expect(fixture.request(undefined, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    expect(fixture.jobRuntime.listRuns()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          eventGroupId: fixture.group.id,
          analysisPhase: 'correction',
          triggerKey: 'manual.refresh'
        })
      })
    ])
  })

  it('never lets a published conclusion block 重新分析', async () => {
    // The whole point of the button: replace the conclusion that is already on screen.
    const fixture = setup()
    vi.spyOn(fixture.repository, 'listEventGroups').mockReturnValue([{ ...fixture.group, currentSummaryId: 'mi-as-existing' }])
    vi.spyOn(fixture.repository, 'listRuns').mockReturnValue([
      { id: 'mi-ar-published', eventGroupId: fixture.group.id, status: 'succeeded', triggerKey: 'manual.refresh' } as never
    ])
    await expect(fixture.request(undefined, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    expect(fixture.jobRuntime.listRuns()).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ analysisPhase: 'correction', triggerKey: 'manual.refresh' }) })
    ])
  })

  it('reports an in-flight correction as queued and starts nothing new', async () => {
    const fixture = setup()
    const queuedRunId = fixture.queuedRun()
    await expect(fixture.request(undefined, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    expect(fixture.jobRuntime.listRuns()).toHaveLength(0)
    expect(fixture.repository.getRun(queuedRunId)?.status).toBe('queued')
  })

  it('keeps the refusal for a data-driven refresh while work is in flight', async () => {
    const fixture = setup()
    fixture.queuedRun()
    // A session-slot refresh is not a click; a skip there is the trigger budget talking.
    await expect(fixture.request(undefined, undefined, 'refresh', 'session-slot', 'asia')).rejects.toThrow('analysis-already-available')
    expect(fixture.jobRuntime.listRuns()).toHaveLength(0)
  })

  it('still resolves a manual first-analysis request only after its freeze completes', async () => {
    const fixture = setup()
    fixture.freeze.mockRejectedValueOnce(new Error('query-unavailable'))
    // `initial` needs no in-flight exemption, but a reader who clicks twice must still be told
    // that work is on its way rather than shown nothing at all.
    await expect(fixture.request(undefined, undefined, 'initial', 'manual')).rejects.toThrow('analysis-initial-request-failed')
    const running = fixture.request(undefined, undefined, 'initial', 'manual')
    await expect(fixture.request(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: 'item-original', queued: true })
    await expect(running).resolves.toEqual({ itemId: 'item-original', queued: true })
  })
})
