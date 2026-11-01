import { describe, expect, it } from 'vitest'

import type { JobRunAggregateResult } from '@platform/jobs'

import { SYNC_RUN_IPC_METHODS } from '../../../../contracts/syncRunRecords'
import { registerSyncRunIpc } from './registerSyncRunIpc'

const NOW = '2026-11-01T16:00:00.000Z'

function harness(aggregates: (query: unknown) => JobRunAggregateResult) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  const queries: unknown[] = []
  const jobRuntime = {
    listRuns: () => [],
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
    () => NOW
  )
  return {
    queries,
    call: async (method: string) => handlers.get(method)?.(undefined)
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
