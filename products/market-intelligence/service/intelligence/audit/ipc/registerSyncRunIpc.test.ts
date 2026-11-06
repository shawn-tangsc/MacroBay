import { describe, expect, it } from 'vitest'

import type { JobRunAggregateResult, JobRunRecord } from '@platform/jobs'

import type { AnalysisRun } from '../../../../contracts/marketAnalysisContracts'
import { SYNC_RUN_IPC_METHODS } from '../../../../contracts/syncRunRecords'
import { registerSyncRunIpc, type SyncRunAnalysisSource } from './registerSyncRunIpc'

const NOW = '2026-11-01T16:00:00.000Z'

function harness(
  aggregates: (query: unknown) => JobRunAggregateResult,
  options?: {
    runs?: readonly JobRunRecord[]
    analysis?: SyncRunAnalysisSource
    /** The payload-filtered read the focused lookup uses. */
    byPayload?: (payload: Record<string, unknown>) => JobRunRecord | undefined
  }
) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  const queries: unknown[] = []
  /** Every list query, so a filter that must reach the store can be asserted where it is built. */
  const runQueries: unknown[] = []
  const jobRuntime = {
    getRun: () => null,
    /**
     * 分页读取：把 `runs` 按每页 `query.limit`（最多 500）切开，用下标当游标——
     * 只为验证「续取到窗口末尾」，不模拟存储层排序。
     */
    listRunPage: (query?: { limit?: number; cursor?: string }) => {
      runQueries.push(query)
      const all = options?.runs ?? []
      const size = Math.min(query?.limit ?? 500, 500)
      const start = query?.cursor === undefined ? 0 : Number(query.cursor)
      const slice = all.slice(start, start + size)
      const next = start + size < all.length ? String(start + size) : null
      return { runs: slice, nextCursor: next }
    },
    listRuns: (query?: { payload?: Record<string, unknown> }) => {
      runQueries.push(query)
      if (query?.payload && options?.byPayload) {
        const hit = options.byPayload(query.payload)
        return hit ? [hit] : []
      }
      return options?.runs ?? []
    },
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
    runQueries,
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

  it('reads the whole window instead of the newest page, and says so when it had to stop', async () => {
    // 24 小时 = 4,940 条：一页 500 条只覆盖 3.6 小时，所以窗口与服务端续取缺一不可。
    const runs = Array.from({ length: 1_200 }, (_, index) => jobRun({
      id: `run-${String(index).padStart(4, '0')}`,
      createdAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      startedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      completedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString()
    }))
    const { call, runQueries } = harness(() => ({ state: 'available', rows: [] }), { runs })

    const result = await call(SYNC_RUN_IPC_METHODS.list, { window: '24h', limit: 500 }) as {
      rows: readonly unknown[]
      truncated?: boolean
    }
    expect(result.rows).toHaveLength(1_200)
    expect(result.truncated).toBeUndefined()
    // 窗口交给存储层：24 小时档必须带 createdFrom，否则「标签与取数」还是两回事。
    expect(runQueries[0]).toMatchObject({ createdFrom: new Date(Date.parse(NOW) - 24 * 60 * 60 * 1_000).toISOString() })

    // 触到装载上限必须说出来，不许假装取全了。
    const many = Array.from({ length: 20_600 }, (_, index) => jobRun({
      id: `cap-${String(index).padStart(5, '0')}`,
      createdAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      startedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      completedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString()
    }))
    const capped = await harness(() => ({ state: 'available', rows: [] }), { runs: many })
      .call(SYNC_RUN_IPC_METHODS.list, { window: 'all', limit: 500 }) as { rows: readonly unknown[]; truncated?: boolean }
    expect(capped.rows).toHaveLength(20_000)
    expect(capped.truncated).toBe(true)
  })

  it('pushes the task filter down to the store instead of filtering the newest page', async () => {
    // 稀疏任务的根因就是「先取最新 500 条再在客户端筛」：翻译一天 45 次，采集每 17 秒一条，
    // 它永远沉底。所以 handlerId 必须出现在给存储层的查询上。
    const { call, runQueries } = harness(() => ({ state: 'available', rows: [] }), { runs: [jobRun()] })

    await call(SYNC_RUN_IPC_METHODS.list, {
      window: '24h',
      limit: 500,
      handlerId: 'market-intelligence.translateItems'
    })
    expect(runQueries.at(-1)).toMatchObject({
      productId: 'market-intelligence',
      newestFirst: true,
      limit: 500,
      handlerId: 'market-intelligence.translateItems'
    })

    // 不选任务时不带这个键：空串条件等于给存储层加一个假过滤。
    await call(SYNC_RUN_IPC_METHODS.list, { window: '24h', limit: 500 })
    expect(runQueries.at(-1)).not.toHaveProperty('handlerId')
  })

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

  it('fetches the task row behind a notified analysis even when it is older than the page', async () => {
    const older = jobRun({
      id: 'run-old',
      createdAt: '2026-11-01T00:00:00.000Z',
      startedAt: '2026-11-01T00:00:00.000Z',
      completedAt: '2026-11-01T00:01:00.000Z',
      payload: { analysisRunId: 'mi-ar-old' }
    })
    const { call } = harness(() => ({ state: 'available', rows: [] }), {
      runs: [],
      analysis: { listRuns: () => [analysisRun({ id: 'mi-ar-old', jobRunId: null })] },
      byPayload: (payload) => (payload.analysisRunId === 'mi-ar-old' ? older : undefined)
    })

    const result = await call(SYNC_RUN_IPC_METHODS.list, {
      window: 'all',
      limit: 50,
      analysisRunId: 'mi-ar-old'
    }) as { rows: readonly { runId: string; analysis: unknown }[] }

    // The page's own list is empty of it (it is older than the newest runs), yet the link still
    // resolves to the row — without this a notice clicked later would look "not found".
    expect(result.rows.map((row) => row.runId)).toEqual(['run-old'])
    expect(result.rows[0]?.analysis).toMatchObject({ state: 'linked', result: { runId: 'mi-ar-old' } })
  })

  it('adds nothing when the analysis run itself is unknown', async () => {
    const { call } = harness(() => ({ state: 'available', rows: [] }), {
      runs: [],
      analysis: { listRuns: () => [] },
      byPayload: () => undefined
    })

    const result = await call(SYNC_RUN_IPC_METHODS.list, {
      window: 'all',
      limit: 50,
      analysisRunId: 'mi-ar-missing'
    }) as { rows: readonly unknown[] }

    expect(result.rows).toEqual([])
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
