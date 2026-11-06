import { describe, expect, it } from 'vitest'

import type { JobRunAggregateResult, JobRunRecord } from '@platform/jobs'

import type { AnalysisRun } from '../../../../contracts/marketAnalysisContracts'
import { SYNC_RUN_IPC_METHODS } from '../../../../contracts/syncRunRecords'
import { registerSyncRunIpc, type SyncRunAnalysisSource } from './registerSyncRunIpc'

const NOW = '2026-11-01T16:00:00.000Z'

function harness(
  aggregates: (query: unknown) => JobRunAggregateResult,
  options?: { runs?: readonly JobRunRecord[]; analysis?: SyncRunAnalysisSource }
) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  const queries: unknown[] = []
  const jobRuntime = {
    listRuns: () => options?.runs ?? [],
    listRunAggregates: (query: unknown) => {
      queries.push(query)
      return aggregates(query)
    }
  }
  registerSyncRunIpc(
    ((_productId: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never,
    jobRuntime as never,
    () => NOW,
    undefined,
    options?.analysis
  )
  return {
    queries,
    call: async (method: string, payload?: unknown) => handlers.get(method)?.(payload)
  }
}

describe('sync run aggregates IPC', () => {
  it('answers with the day that lies past the retained detail window', async () => {
    const { call, queries } = harness(() => ({
      state: 'available',
      rows: [{ day: '2026-10-01', definitionId: 'market-intelligence.collectSource', runs: 4, failures: 1 }]
    }))

    const result = (await call(SYNC_RUN_IPC_METHODS.aggregates)) as { state: string; rows: readonly Record<string, unknown>[] }

    expect(result.state).toBe('available')
    expect(result.rows[0]).toMatchObject({ day: '2026-10-01', taskLabel: '情报源采集', runs: 4, failures: 1 })
    // The window has to reach back further than the 30-day detail retention.
    expect(queries[0]).toMatchObject({ toDay: '2026-11-02', definitionIdPrefix: 'market-intelligence.' })
    expect((queries[0] as { fromDay: string }).fromDay < '2026-10-01').toBe(true)
  })

  it('keeps the reason a store gives, so the page can say why', async () => {
    const { call } = harness(() => ({ state: 'unavailable', reason: 'memory-store-has-no-aggregates', rows: [] }))

    await expect(call(SYNC_RUN_IPC_METHODS.aggregates)).resolves.toEqual({
      state: 'unavailable',
      reason: 'memory-store-has-no-aggregates',
      rows: []
    })
  })

  it('reports its own failure instead of pretending the history is empty', async () => {
    const { call } = harness(() => { throw new Error('store broke') })

    await expect(call(SYNC_RUN_IPC_METHODS.aggregates)).resolves.toEqual({
      state: 'unavailable',
      reason: 'aggregates-unavailable',
      rows: []
    })
  })
})

describe('sync run analysis column', () => {
  const jobRun = (overrides: Partial<JobRunRecord> = {}): JobRunRecord => ({
    id: 'run-9', definitionId: 'def', handlerId: 'market-intelligence.runMarketAnalysis',
    owner: 'product', productId: 'market-intelligence', title: 'Analyze', status: 'completed',
    trigger: { kind: 'interval' } as never, payload: {}, attempt: 1, maxAttempts: 1,
    createdAt: '2026-11-01T15:59:00.000Z', startedAt: '2026-11-01T15:59:00.000Z',
    completedAt: '2026-11-01T16:00:00.000Z', ...overrides
  } as JobRunRecord)

  const analysisRun = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
    id: 'mi-ar-1', schemaVersion: 1, eventGroupId: 'group-1', snapshotId: 'snap-1', snapshotHash: 'hash-1',
    analysisPhase: 'initial', triggerKey: 'slot:asia', idempotencyKey: 'key-1', status: 'failed',
    attempt: 1, retryOfRunId: null, modelProviderId: 'tokenrhythm', modelId: 'deepseek-v4.1-flash-1017',
    policyVersion: 'policy-1', promptVersion: 'prompt-1', skillVersion: 'skill-1', outputSchemaVersion: 1,
    jobRunId: 'run-9', traceId: null, failureCode: 'analysis-provider-error', failureDetailCode: 'upstream-aborted',
    queuedAt: '2026-11-01T15:59:00.000Z', startedAt: '2026-11-01T15:59:02.000Z', completedAt: '2026-11-01T16:00:00.000Z',
    ...overrides
  } as AnalysisRun)

  it('joins a task row to the analysis run it produced', async () => {
    const { call } = harness(() => ({ state: 'available', rows: [] }), {
      runs: [jobRun()],
      analysis: { listRuns: () => [analysisRun()] }
    })

    const result = await call(SYNC_RUN_IPC_METHODS.list, { window: '24h', limit: 50 }) as {
      rows: readonly { outcome: string; analysis: unknown }[]
    }

    // The task completed; the analysis it owns did not publish. Both facts travel together.
    expect(result.rows[0]?.outcome).toBe('succeeded')
    expect(result.rows[0]?.analysis).toMatchObject({
      state: 'linked',
      result: { runId: 'mi-ar-1', state: 'failed', failureDetailCode: 'upstream-aborted' }
    })
  })

  it('says unlinked when the store has no run for the task', async () => {
    const { call } = harness(() => ({ state: 'available', rows: [] }), {
      runs: [jobRun()],
      analysis: { listRuns: () => [] }
    })

    const result = await call(SYNC_RUN_IPC_METHODS.list, { window: '24h', limit: 50 }) as {
      rows: readonly { analysis: unknown }[]
    }

    expect(result.rows[0]?.analysis).toEqual({ state: 'unlinked' })
  })
})
