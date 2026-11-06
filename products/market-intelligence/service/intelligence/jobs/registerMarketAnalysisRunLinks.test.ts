import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { createInMemoryMarketAnalysisSettingsStorage, createMarketAnalysisSettingsStore } from '../application/marketAnalysisSettingsStore'
import { createMarketAnalysisSettingsService } from '../application/marketAnalysisSettingsService'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, RUN_MARKET_ANALYSIS_JOB } from './marketAnalysisJobIds'
import { registerMarketAnalysisRuntime } from './registerMarketAnalysisRuntime'

const asOf = '2026-11-05T00:00:00.000Z'

/**
 * The two links share one fact: which job ran which analysis.
 *
 * The trigger ledger row is written before the analysis run exists (the attempt is what the budget
 * counts), and the job run is only known once the enqueue answers. Both ids were null today, so
 * neither the run log nor the analysis page could reach the other — the run log had a job with no
 * analysis, and the analysis had a job id of null. This pins both write-backs in one real run.
 */
describe('market analysis run links', () => {
  it('links a queued analysis to its job run and to the attempt row that paid for it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mi-analysis-run-links-'))
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition: { id: string; handlerId: string; payload: Record<string, unknown> }) => ({ id: definition.id }))
    const jobRuntime = {
      registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
      enqueueDefinition,
      listRuns: () => [],
      enqueueStartup: vi.fn(async (id: string) => ({ id }))
    } as unknown as JobRuntime
    const now = () => asOf
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [], listRevisions: () => [] } as unknown as IntelligencePipeline,
      publicQueryService: {} as MarketIntelligencePublicQueryService,
      structuredModelInvocation: { invoke: vi.fn() } as never,
      settingsService: createMarketAnalysisSettingsService({
        store: createMarketAnalysisSettingsStore(
          createInMemoryMarketAnalysisSettingsStorage({ enabled: true, providerId: '', modelId: '', updatedAt: now() }),
          now
        ),
        now
      }),
      dataDir: directory,
      now
    })
    try {
      const group: EventGroup = {
        id: 'mi-eg-links', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official|US|2026-11|cpi|1',
        firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-11-05T02:00:00.000Z', eventRefs: ['item-1'],
        triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
      }
      runtime.repository.appendEventGroup(group)
      const ledgerId = runtime.repository.appendTriggerLedger({
        id: 'mi-ledger-links', eventGroupId: group.id, triggerKey: 'macro.actual.first-confirmed', changeHash: 'change-hash',
        decision: 'queued', reasonCode: 'severity-confirmed', snapshotHash: null, analysisRunId: null, createdAt: asOf
      })
      expect(ledgerId).toBe('mi-ledger-links')

      await handlers.get(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)!({
        eventGroupId: group.id, triggerKey: 'macro.actual.first-confirmed', analysisPhase: 'initial', asOf, attemptLedgerId: ledgerId
      }, { jobRunId: 'job-freeze', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) })

      const [run] = runtime.repository.listRuns()
      expect(run).toBeDefined()
      // Both sides are written and they name the same run.
      expect(run!.jobRunId).toBe(`market-analysis:run:${run!.id}`)
      expect(runtime.repository.listTriggerLedger(group.id)[0]!.analysisRunId).toBe(run!.id)

      // Job -> analysis: the dispatched run job carries the analysis id.
      const dispatched = enqueueDefinition.mock.calls.map(([definition]) => definition)
        .filter((definition) => definition.handlerId === RUN_MARKET_ANALYSIS_JOB)
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]!.payload).toEqual({ analysisRunId: run!.id })
      // Analysis -> job: the stored job id resolves back to the same job, which is what lets the
      // analysis page open the run log at that row.
      expect(dispatched[0]!.id).toBe(run!.jobRunId)
    } finally {
      runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
