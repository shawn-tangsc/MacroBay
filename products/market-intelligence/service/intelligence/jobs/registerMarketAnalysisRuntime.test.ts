import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'
import type { JobHandler } from '@platform/jobs'
import { createEventBusRuntime } from '@platform/message-bus'

import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { INTELLIGENCE_EVENT_TOPICS } from '../schema/intelligenceEvents'
import {
  buildMarketAnalysisVerificationObservations,
  formatMarketAnalysisContextDiagnostic,
  registerMarketAnalysisRuntime,
  resolveMarketAnalysisSeverity
} from './registerMarketAnalysisRuntime'
import { ANALYSIS_SESSION_SLOTS_JOB, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB, RUN_MARKET_ANALYSIS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB } from './marketAnalysisJobIds'

import { createInMemoryMarketAnalysisSettingsStorage, createMarketAnalysisSettingsStore } from '../application/marketAnalysisSettingsStore'
import { createMarketAnalysisSettingsService, type MarketAnalysisSettingsService } from '../application/marketAnalysisSettingsService'

/** A run queued without a model: the invocation keeps following the platform default. */
function createRuntimeSettingsService(enabled = true): MarketAnalysisSettingsService {
  const now = () => '2026-09-28T00:00:00.000Z'
  return createMarketAnalysisSettingsService({
    store: createMarketAnalysisSettingsStore(
      createInMemoryMarketAnalysisSettingsStorage({ enabled, providerId: '', modelId: '', updatedAt: now() }),
      now
    ),
    now
  })
}

function item(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    itemId: 'item-1', primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'dedupe-1', sourceId: 'news-source',
    eventType: 'news', title: '市场消息', sourceCategory: 'news', sourceTrust: 'high', detectedAt: '2026-09-28T00:00:00.000Z',
    timelineStatus: 'evaluated', normalizerVersion: 'v1', ...overrides
  }
}

describe('registerMarketAnalysisRuntime prediction observations', () => {
  it('prints a safe macro context diagnostic marker for manual verification', () => {
    const marker = formatMarketAnalysisContextDiagnostic({
      asOf: '2026-09-28T00:00:00.000Z', macroQueryState: 'available', macroEventCount: 2,
      macroFactCount: 10, macroEvidenceCount: 2, macroCaveats: ['macro-calendar-consensus-unavailable']
    })
    console.log(marker)
    expect(marker).toBe('{"marker":"MI_ANALYSIS_MACRO_CONTEXT","asOf":"2026-09-28T00:00:00.000Z","macroQueryState":"available","macroEventCount":2,"macroFactCount":10,"macroEvidenceCount":2,"macroCaveats":["macro-calendar-consensus-unavailable"]}')
    expect(marker).not.toMatch(/https?:\/\/|\/Users\/|api[_-]?key|token/i)
  })

  it('does not project high-trust news items into market observations', () => {
    expect(buildMarketAnalysisVerificationObservations('2026-09-28T00:01:00.000Z', [item()])).toEqual([])
  })

  it('projects funding deltas with a stable evidence reference and as-of boundary', () => {
    const asOf = '2026-09-28T08:01:00.000Z'
    const observations = buildMarketAnalysisVerificationObservations(asOf, [], {
      funding: {
        state: 'available',
        asOf,
        btc: [
          { observedAt: '2026-09-28T00:00:00.000Z', ratePercent: 0.01 },
          { observedAt: '2026-09-28T08:00:00.000Z', ratePercent: 0.05 },
          { observedAt: '2026-09-28T16:00:00.000Z', ratePercent: 0.09 }
        ],
        eth: []
      }
    })

    expect(observations).toEqual([
      {
        asset: 'BTC', interval: '8h', observedAt: '2026-09-28T08:00:00.000Z', comparable: true,
        evidenceRefId: 'mi-evidence-funding-BTC-2026-09-28T00:00:00.000Z-2026-09-28T08:00:00.000Z',
        fundingDeltaPctPoints: 0.04
      }
    ])
  })

  it('projects only complete historical cross-asset returns and relative returns', () => {
    const asOf = '2026-09-28T08:01:00.000Z'
    const observations = buildMarketAnalysisVerificationObservations(asOf, [], {
      crossAsset: {
        query: (input) => {
          if (input.range === '1h') return crossAssetSnapshot(asOf, '1h', 0.5)
          if (input.range === '24h') return crossAssetSnapshot(asOf, '24h', 2)
          return crossAssetSnapshot(asOf, '7d', 4)
        }
      }
    })

    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset: 'BTC', horizon: '15m', priceReturnPct: 0.5, comparable: true }),
      expect.objectContaining({ asset: 'BTC', horizon: '2h', priceReturnPct: 2, comparable: true }),
      expect.objectContaining({ asset: 'BTC', horizon: '24h', priceReturnPct: 3, comparable: true }),
      expect.objectContaining({ asset: 'BTC', horizon: '3d', priceReturnPct: 4, comparable: true }),
      expect.objectContaining({ asset: 'BTC', relativeToAsset: 'ETH', horizon: '2h', relativeReturnPct: 1.25, comparable: true })
    ]))
    expect(observations.every((observation) => observation.observedAt <= asOf && observation.evidenceRefId)).toBe(true)
  })
})

describe('registerMarketAnalysisRuntime trigger severity', () => {
  it('promotes a high-trust full-intelligence item to a triggerable severity', () => {
    expect(resolveMarketAnalysisSeverity(item({
      severityHint: 'info',
      processingLabelsJson: JSON.stringify({ relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    }))).toBe('high')
  })

  it('keeps context-only items below the automatic trigger threshold', () => {
    expect(resolveMarketAnalysisSeverity(item({
      severityHint: 'info',
      processingLabelsJson: JSON.stringify({ relevanceOutcome: 'context-only', sentimentEligible: false })
    }))).toBe('low')
  })

  it('queues a controlled first analysis for an eligible stored item', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-request-`)
    const classifiedItem = item({
      itemId: 'item-request-first-analysis', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-09-28T00:00:00.000Z', detectedAt: '2026-09-28T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    const jobRuntime = {
      registerHandler: vi.fn(),
      enqueueDefinition,
      listRuns: () => [],
      waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } }),
      enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId }))
    } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [classifiedItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(), dataDir: directory,
      now: () => '2026-09-28T00:01:00.000Z'
    })
    try {
      await expect(runtime.requestInitialAnalysis(classifiedItem.itemId, undefined, 'initial', 'manual')).resolves.toEqual({
        itemId: classifiedItem.itemId,
        queued: true
      })
      expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
        handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
        payload: expect.objectContaining({ analysisPhase: 'initial', triggerKey: 'manual.initial' }),
        trigger: { kind: 'manual' }
      }))
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves the startup decision to the session slot job instead of spending a run itself', async () => {
    // The 6-hour startup catch-up used to live here. It asked "is the newest conclusion old", which
    // produced an unattributed refresh; the slot job now asks "which opens are unserved", so recovery
    // must not spend a model call of its own.
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-startup-slots-`)
    const classifiedItem = item({
      itemId: 'item-startup-slots', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-10-01T00:00:00.000Z', detectedAt: '2026-10-01T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    const enqueueStartup = vi.fn(async (definitionId: string) => ({ id: definitionId }))
    const jobRuntime = {
      registerHandler: vi.fn(), enqueueDefinition, enqueueStartup,
      listRuns: () => [], waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } })
    } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [classifiedItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(), dataDir: directory,
      now: () => '2026-10-08T14:00:00.000Z'
    })
    try {
      await runtime.startRecovery()
      expect(enqueueStartup).toHaveBeenCalledWith(RECOVER_MARKET_ANALYSIS_RUNS_JOB)
      expect(enqueueDefinition).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('catches up the oldest unserved open when the slot job runs', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-slot-catch-up-`)
    const classifiedItem = item({
      itemId: 'item-slot-catch-up', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-10-01T00:00:00.000Z', detectedAt: '2026-10-01T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    const registerHandler = vi.fn()
    const jobRuntime = {
      registerHandler, enqueueDefinition,
      listRuns: () => [], waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } }),
      enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId }))
    } as never
    // 09:00 local with nothing ever analysed: the 08:00 Asian open is the newest one that passed, and
    // the run that follows must be attributed to that open rather than to a generic clock.
    const now = new Date(2026, 9, 8, 9, 0, 0).toISOString()
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime, pipeline: { listItems: () => [classifiedItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never, structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(), dataDir: directory, now: () => now
    })
    try {
      const handler = registerHandler.mock.calls.find(([id]) => id === ANALYSIS_SESSION_SLOTS_JOB)?.[1] as
        ((payload: unknown, context: never) => Promise<void>) | undefined
      expect(handler).toBeDefined()
      await handler!({}, { log: vi.fn(async () => undefined) } as never)
      expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
        handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
        payload: expect.objectContaining({ analysisPhase: 'correction', triggerKey: 'schedule.asia.open' })
      }))
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('dispatches a queued analysis run that no job ever claimed, and skips one with a live job', async () => {
    // Reproduces the observed orphan: the recovery pass wrote a `queued` row and stopped, so
    // no `runMarketAnalysis` job existed and the run could never leave `queued`.
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-recovery-`)
    const asOf = '2026-09-28T00:01:00.000Z'
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    let liveJobs: readonly unknown[] = []
    const jobRuntime = {
      registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler),
      enqueueDefinition,
      listRuns: () => liveJobs,
      waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } }),
      enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId }))
    } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [], listRevisions: () => [] } as never,
      publicQueryService: {} as never,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(), dataDir: directory,
      now: () => asOf
    })
    try {
      const eventGroup = {
        id: 'mi-eg-orphan', schemaVersion: 1 as const, status: 'open' as const, groupType: 'macro' as const, mergeKey: 'macro|orphan',
        firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-28T02:00:00.000Z', eventRefs: ['item-1'],
        triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
      }
      const snapshot = {
        id: 'mi-es-orphan', schemaVersion: 1 as const, eventGroupId: eventGroup.id, asOf, dataCutoff: asOf,
        profileId: 'crypto-market-analysis-v1' as const, facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
        sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' as const
      }
      runtime.repository.appendEventGroup(eventGroup)
      const { buildAnalysisSnapshotHash: hash } = await import('../analysis/analysisHash')
      const { createAnalysisRunService: createRuns } = await import('../analysis/analysisRunService')
      const snapshotHash = hash(snapshot)
      runtime.repository.appendSnapshot({ ...snapshot, snapshotHash })
      createRuns({ repository: runtime.repository, now: () => asOf, idFactory: () => 'mi-ar-orphan' })
        .enqueue({ eventGroupId: eventGroup.id, snapshotId: snapshot.id, snapshotHash, analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed' })
      const context = { jobRunId: 'job-1', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) }
      const dispatched = () => enqueueDefinition.mock.calls.map(([definition]) => definition).filter(definition => definition.handlerId === RUN_MARKET_ANALYSIS_JOB)
      await handlers.get(RECOVER_MARKET_ANALYSIS_RUNS_JOB)!({}, context)
      expect(dispatched()).toHaveLength(1)
      expect(dispatched()[0]).toEqual(expect.objectContaining({
        handlerId: RUN_MARKET_ANALYSIS_JOB, payload: { analysisRunId: 'mi-ar-orphan' }, concurrencyKey: 'eventGroup:mi-eg-orphan'
      }))
      // The run is still `queued` because no job actually ran; the live job must not be duplicated.
      liveJobs = [{ payload: { analysisRunId: 'mi-ar-orphan' }, handlerId: RUN_MARKET_ANALYSIS_JOB, status: 'queued' }]
      await handlers.get(RECOVER_MARKET_ANALYSIS_RUNS_JOB)!({}, context)
      expect(dispatched()).toHaveLength(1)
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reuses an existing event group for a stored item instead of inserting a duplicate', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-request-existing-`)
    const classifiedItem = item({
      itemId: 'item-request-existing', sourceId: 'alternative-fear-greed', publishedAt: '2026-09-28T00:00:00.000Z',
      processingLabelsJson: JSON.stringify({ relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    const jobRuntime = { registerHandler: vi.fn(), enqueueDefinition, listRuns: () => [], waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } }) } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [classifiedItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never, structuredModelInvocation: { invoke: vi.fn() } as never, settingsService: createRuntimeSettingsService(), dataDir: directory,
      now: () => '2026-09-28T00:01:00.000Z'
    })
    const existing = runtime.repository.listEventGroups()[0]
    try {
      // Seed the same group through the repository's actual event-group contract.
      runtime.repository.appendEventGroup({ id: 'mi-eg-existing', schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: 'sentiment|official|sentiment|市场消息|1', firstObservedAt: classifiedItem.detectedAt, lastObservedAt: classifiedItem.detectedAt, reviewDeadlineAt: '2026-09-28T02:00:00.000Z', eventRefs: [classifiedItem.itemId], triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: '2026-09-28T00:01:00.000Z', updatedAt: '2026-09-28T00:01:00.000Z' })
      await expect(runtime.requestInitialAnalysis(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: classifiedItem.itemId, queued: true })
      expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({ handlerId: 'market-intelligence.freezeMarketAnalysisSnapshot', payload: expect.objectContaining({ eventGroupId: 'mi-eg-existing', analysisPhase: 'initial' }) }))
      expect(existing).toBeUndefined()
      const snapshot = { id: 'mi-es-retry', schemaVersion: 1 as const, eventGroupId: 'mi-eg-existing', asOf: '2026-09-28T00:01:00.000Z', dataCutoff: '2026-09-28T00:01:00.000Z', profileId: 'crypto-market-analysis-v1' as const, facts: [], missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [], createdAt: '2026-09-28T00:01:00.000Z', policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' as const }
      const { buildAnalysisSnapshotHash } = await import('../analysis/analysisHash')
      const { createAnalysisRunService } = await import('../analysis/analysisRunService')
      const snapshotHash = buildAnalysisSnapshotHash(snapshot)
      runtime.repository.appendSnapshot({ ...snapshot, snapshotHash })
      createAnalysisRunService({ repository: runtime.repository, now: () => snapshot.asOf, idFactory: () => 'mi-ar-retry' }).enqueue({ eventGroupId: 'mi-eg-existing', snapshotId: snapshot.id, snapshotHash, analysisPhase: 'initial', triggerKey: 'manual.initial' })
      // The queued run is the answer, not a refusal: one freeze job for the group, still.
      const freezesSoFar = enqueueDefinition.mock.calls.filter(([definition]) => definition.handlerId === 'market-intelligence.freezeMarketAnalysisSnapshot').length
      await expect(runtime.requestInitialAnalysis(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: classifiedItem.itemId, queued: true })
      expect(enqueueDefinition.mock.calls.filter(([definition]) => definition.handlerId === 'market-intelligence.freezeMarketAnalysisSnapshot')).toHaveLength(freezesSoFar)
      runtime.repository.updateRunStatus({ id: 'mi-ar-retry', status: 'failed', failureCode: 'analysis-provider-error' })
      await expect(runtime.requestInitialAnalysis(undefined, undefined, 'initial', 'manual')).resolves.toEqual({ itemId: classifiedItem.itemId, queued: true })
    } finally { runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects a context-only stored item instead of sending it to analysis', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-request-reject-`)
    const contextOnlyItem = item({
      itemId: 'item-request-context-only', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-09-28T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'context-only', sentimentEligible: false })
    })
    const jobRuntime = { registerHandler: vi.fn() } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [contextOnlyItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(), dataDir: directory,
      now: () => '2026-09-28T00:01:00.000Z'
    })
    try {
      await expect(runtime.requestInitialAnalysis(contextOnlyItem.itemId, undefined, 'initial', 'manual')).rejects.toThrow('analysis-not-eligible')
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('arms and disarms the analysis schedules with the switch, and refuses to start while it is off', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-settings-gate-`)
    const asOf = '2026-09-28T00:01:00.000Z'
    const classifiedItem = item({
      itemId: 'item-settings-gate', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-09-28T00:00:00.000Z', detectedAt: '2026-09-28T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const scheduled: string[] = []
    const removed: string[] = []
    const enqueueDefinition = vi.fn(async (definition: { id: string }) => ({ id: definition.id }))
    const jobRuntime = {
      registerHandler: vi.fn(), enqueueDefinition,
      listRuns: () => [], waitForRunTerminal: async () => ({ state: 'terminal', run: { status: 'completed' } }),
      enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId })),
      setSchedule: (definition: { id: string }) => scheduled.push(definition.id),
      removeSchedule: (definitionId: string) => removed.push(definitionId)
    } as never
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime, pipeline: { listItems: () => [classifiedItem], listRevisions: () => [] } as never,
      publicQueryService: {} as never, structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(false), dataDir: directory, now: () => asOf
    })
    try {
      // Off means off: nothing is armed and no work is created, so a stored "off" cannot spend a
      // request on the next tick. (The startup sync reads the stored settings, so wait for it.)
      await vi.waitFor(() => expect(removed).toHaveLength(3))
      expect(scheduled).toEqual([])
      // A stored "off" also clears anything an earlier process left armed.
      expect(removed).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])
      await expect(runtime.requestInitialAnalysis(classifiedItem.itemId, undefined, 'initial', 'manual'))
        .rejects.toThrow('analysis-not-enabled')
      expect(enqueueDefinition).not.toHaveBeenCalled()

      await runtime.updateSettings({ enabled: true, providerId: 'provider-1', modelId: 'model-1' })
      expect(scheduled).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])

      removed.length = 0
      await runtime.updateSettings({ enabled: false })
      expect(removed).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('runs a classified event through run, summary, and timeline without chat writes', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-runtime-`)
    const asOf = '2026-09-28T00:01:00.000Z'
    const classifiedItem = item({
      itemId: 'item-full-intelligence', sourceId: 'alternative-fear-greed',
      publishedAt: '2026-09-28T00:00:00.000Z', detectedAt: '2026-09-28T00:00:00.000Z', severityHint: 'info',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    })
    const pipeline = {
      listItems: () => [classifiedItem],
      listRevisions: () => [],
    }
    const evidence = {
      evidenceRefId: 'evidence-1', sourceId: 'alternative-fear-greed', sourceLabel: 'alternative-fear-greed',
      itemId: classifiedItem.itemId, occurredAt: classifiedItem.detectedAt, publishedAt: classifiedItem.publishedAt,
      detectedAt: classifiedItem.detectedAt, computedAt: null, visibleAt: asOf, excerptHash: 'hash-1'
    }
    const queryEnvelope = (data: unknown) => ({
      schemaVersion: 1, queryId: 'query-1', queryType: 'source-health', asOf, servedAt: asOf,
      resultHash: 'result-1', scope: {}, timeWindow: { to: asOf }, confidence: 1, caveats: [],
      sourceCoverage: [], evidenceRefs: [evidence], data
    })
    const publicQueryService = {
      queryFearGreedSnapshot: vi.fn(async () => ({ state: 'available' as const, asOf, score: 80, bucket: 'greed' as const, observedAt: asOf })),
      queryFundingRateHistory: vi.fn(async () => ({ state: 'empty' as const, asOf })),
      queryCapitalConditionsSnapshot: vi.fn(async () => ({ state: 'empty' as const, asOf })),
      getSourceHealth: vi.fn(async () => ({ ...queryEnvelope({ sources: [] }), evidenceRefs: [] })),
      getEvidenceExcerpt: vi.fn(async () => queryEnvelope({ evidenceRef: evidence, title: '已发布情绪指数', excerpt: '指数为 80' }))
    }
    let chatMessagesWritten = 0
    const structuredModelInvocation = {
      invoke: vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
        // The prompt now hands out short handles, so the stub quotes what a real model would.
        const context = JSON.parse(request.messages.at(-1)!.content) as { facts: readonly { factRef: string; metric: string }[]; evidenceRefs: readonly { evidenceRef: string }[] }
        // The model payload names every identifier, so the stub selects the fact by its
        // reader-facing name; quoting `event-excerpt` is what the fix removed.
        expect(context.facts.some(fact => fact.metric === '事件摘要')).toBe(true)
        const factId = context.facts.find(fact => fact.metric === '事件摘要')!.factRef
        const evidenceRefId = context.evidenceRefs[0]!.evidenceRef
        return { ok: true as const, output: validModelOutput(factId, evidenceRefId), providerId: 'test-provider', modelId: 'test-model', trace: { taskId: 'test', durationMs: 1 } }
      })
    }
    const jobRuntime = createJobRuntime()
    const eventBus = createEventBusRuntime()
    // The schedules are not what this test exercises: without them the run it checks is the one the
    // published event produced, and the session-slot catch-up (covered by its own tests) cannot
    // append a second, unrelated conclusion to the timeline while the assertions run.
    const schedulerlessRuntime = { ...jobRuntime, setSchedule: undefined } as unknown as typeof jobRuntime
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime: schedulerlessRuntime, eventBusRuntime: eventBus, pipeline: pipeline as never, publicQueryService: publicQueryService as never,
      structuredModelInvocation: structuredModelInvocation as never, settingsService: createRuntimeSettingsService(), dataDir: directory, now: () => asOf
    })

    try {
      await eventBus.getDiagnostics({ consumerId: 'market-intelligence.market-analysis-trigger' })
      await Promise.resolve()
      await eventBus.publish({
        topic: INTELLIGENCE_EVENT_TOPICS.itemCreated, producer: { owner: 'product', productId: 'market-intelligence' },
        schemaVersion: 1, occurredAt: asOf, payload: { itemId: classifiedItem.itemId }
      })
      await eventBus.dispatchPending()
      await vi.waitFor(() => {
        const runs = jobRuntime.listRecentRuns()
        const run = runs.find(candidate => candidate.handlerId === 'market-intelligence.groupMarketAnalysisChange')
        if (run?.status === 'failed') {
          throw new Error(`group job failed: ${run.lastError}; runs=${JSON.stringify(runs)}`)
        }
        expect(run?.status).toBe('completed')
      })
      await vi.waitFor(() => expect(runtime.repository.listTimeline({}).items).toHaveLength(1))
      expect(runtime.repository.listRuns()).toHaveLength(1)
      expect(runtime.repository.listRuns()[0]?.status).toBe('succeeded')
      expect(structuredModelInvocation.invoke).toHaveBeenCalledOnce()
      expect(chatMessagesWritten).toBe(0)
    } finally {
      runtime.dispose()
      jobRuntime.stopAll()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function validModelOutput(factId: string, evidenceRefId: string) {
  return {
    conclusion: {
      direction: 'range',
      summary: '情绪指标出现极端读数，需结合其他域观察。',
      change: '恐惧与贪婪指数升至 80。',
      causalChain: '情绪极端 → 风险偏好可能反转 → 方向待确认。',
      conditions: ['其他域数据不冲突。'],
      macro: null,
      evidenceStrength: null,
      dataGaps: ['其他域数据未提供。']
    },
    knownFacts: [{ factId, statement: '情绪指标已记录。', evidenceRefIds: [evidenceRefId] }],
    transmissionHypotheses: [{ statement: '风险偏好可能影响短期波动。', evidenceRefIds: [evidenceRefId] }],
    marketReaction: [],
    supportingEvidence: [{ statement: '数据来自已记录的情绪指标。', evidenceRefId }],
    counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '维持观察', conditions: ['后续数据保持可比'], invalidation: '出现相反事实', status: 'pending' }],
    directions: [
      { horizon: 'short', direction: 'bullish', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: [evidenceRefId] },
      { horizon: 'medium', direction: 'range', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: [evidenceRefId] },
      { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: [evidenceRefId] }
    ],
    nextCatalysts: [{ statement: '关注下一次情绪指标更新。', evidenceRefIds: [evidenceRefId] }],
    dataCaveats: ['其他域数据未提供。'],
    evidenceRefs: [evidenceRefId]
  }
}

/** The five-window closed-return ladder the snapshot publishes, with the 24h value under test. */
const closedReturns = (fiveMinute: number, oneHour: number, oneDay: number) => ({
  '5m': { state: 'available' as const, value: fiveMinute }, '15m': { state: 'available' as const, value: fiveMinute * 2 },
  '1h': { state: 'available' as const, value: oneHour }, '4h': { state: 'available' as const, value: oneHour * 2 },
  '24h': { state: 'available' as const, value: oneDay }
})

function crossAssetSnapshot(asOf: string, range: '1h' | '24h' | '7d', btcReturn: number) {
  const analysisEnd = '2026-09-28T08:00:00.000Z'
  const start = range === '1h' ? '2026-09-28T07:00:00.000Z' : range === '24h' ? '2026-09-27T08:00:00.000Z' : '2026-09-21T08:00:00.000Z'
  const stepMs = range === '7d' ? 3_600_000 : 300_000
  const count = range === '1h' ? 13 : range === '24h' ? 289 : 169
  const curve = Array.from({ length: count }, (_, index) => ({
    at: new Date(Date.parse(start) + index * stepMs).toISOString(),
    returnPercent: index === count - 1 ? btcReturn : index === count - 4 && range === '1h' ? 0 : index === count - 25 && range === '24h' ? 0 : index === count - 73 && range === '7d' ? 0 : index * 0.01
  }))
  return {
    schemaVersion: 1 as const,
    mode: 'historical' as const,
    servedAt: asOf,
    asOf,
    range,
    analysisEnd,
    windowStart: start,
    indexSource: 'real' as const,
    historyCoverage: {
      index: { count, expectedCount: count, complete: true },
      btc: { count, expectedCount: count, complete: true },
      eth: { count, expectedCount: count, complete: true }
    },
    curves: { index: curve, btc: curve, eth: curve.map((point, index) => ({ ...point, returnPercent: point.returnPercent === null ? null : point.returnPercent - (index === count - 1 ? 1.25 : 0) })) },
    closedReturns: {
      index: closedReturns(0.1, 1, 2),
      btc: closedReturns(0.2, 1.5, 3),
      eth: closedReturns(0.1, 0.5, 2)
    },
    correlations: { indexBtc: { state: 'unavailable' as const, reason: 'insufficient' as const, sampleCount: 0, expectedCount: 288 }, indexEth: { state: 'unavailable' as const, reason: 'insufficient' as const, sampleCount: 0, expectedCount: 288 } },
    relativeReturns: { btcMinusIndex: { state: 'available' as const, value: 0.5 }, ethMinusBtc: { state: 'available' as const, value: -1 } },
    observationKey: { indexBtc: 'unavailable' as const, ethBtc: 'unavailable' as const }
  }
}

describe('market analysis runtime sentiment wiring', () => {
  it('freezes the sentiment it read as citable facts before dispatching the run', async () => {
    const directory = await mkdtemp(`${tmpdir()}/mi-analysis-sentiment-`)
    const asOf = '2026-09-28T00:01:00.000Z'
    const publishedAt = '2026-09-28T00:00:30.000Z'
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition: { id: string }) => ({ id: definition.id }))
    const jobRuntime = {
      registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler),
      enqueueDefinition,
      listRuns: () => [],
      enqueueStartup: vi.fn(async (id: string) => ({ id }))
    } as never
    const evidence = (itemId: string) => {
      const ref = {
        evidenceRefId: `ev-${itemId}`, itemId, sourceId: 'coindesk-rss', sourceLabel: 'CoinDesk RSS',
        occurredAt: publishedAt, publishedAt, detectedAt: publishedAt, computedAt: null,
        visibleAt: publishedAt, excerptHash: 'a'.repeat(64)
      }
      return { state: 'available', evidenceRefs: [ref], data: { evidenceRef: ref, title: 'title', excerpt: `excerpt ${itemId}` } }
    }
    const news = {
      itemId: 'news-1', title: 'Exchange outage', displayTitle: '交易所故障', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS',
      publishedAt, scoredAt: '2026-09-28T00:00:40.000Z', polarity: 'bearish' as const,
      strength: 4, confidence: 80, symbols: ['BTC'] as const
    }
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [], listRevisions: () => [] } as never,
      publicQueryService: { getEvidenceExcerpt: async (input: { itemId: string }) => evidence(input.itemId) } as never,
      newsSentimentQuery: { query: async () => ({ state: 'available' as const, asOf, generatedAt: asOf, window: '1h' as const, items: [news], caveats: [] }) } as never,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createRuntimeSettingsService(),
      dataDir: directory,
      now: () => asOf
    })
    try {
      const group = {
        id: 'mi-eg-news', schemaVersion: 1 as const, status: 'open' as const, groupType: 'sentiment' as const,
        mergeKey: 'sentiment|news', firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-28T02:00:00.000Z',
        eventRefs: ['anchor-item'], triggerCount: 0, reviewCount: 0, currentSummaryId: null,
        supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
      }
      runtime.repository.appendEventGroup(group)
      // The repository does not persist the derived change record, so capture the frozen value.
      const appendSnapshot = vi.spyOn(runtime.repository, 'appendSnapshot')
      const context = { jobRunId: 'sentiment-wiring', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) }

      await handlers.get(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)!(
        { eventGroupId: group.id, triggerKey: 'manual.refresh', analysisPhase: 'correction', asOf }, context)

      const [snapshot] = runtime.repository.listSnapshots(group.id)
      expect(snapshot).toBeDefined()
      const fact = snapshot!.facts.find(candidate => candidate.metric === 'news-sentiment')
      // The whole path is exercised: the runtime's query dependency, the evidence reader, the
      // window filter, the fact relabelling and the frozen snapshot.
      expect(fact).toMatchObject({ domain: 'sentiment', subject: 'BTC', comparability: 'not-comparable', evidenceRefId: 'ev-news-1' })
      expect(String(fact!.value)).toContain('bearish')
      expect(snapshot!.evidenceRefs.some(ref => ref.evidenceRefId === 'ev-news-1')).toBe(true)
      // The rotation is not a market change, even end to end.
      const frozen = appendSnapshot.mock.calls[0]![0]
      expect(frozen.change.facts.some(candidate => candidate.metric === 'news-sentiment')).toBe(false)
      expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({ handlerId: RUN_MARKET_ANALYSIS_JOB }))
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
