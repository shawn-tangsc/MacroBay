import { describe, expect, it } from 'vitest'
import type { JobRunRecord } from '@platform/jobs'

import { projectSyncRun, projectSyncRuns, syncRunsCsv } from './syncRunProjection'

const run = (overrides: Partial<JobRunRecord> = {}): JobRunRecord => ({
  id: 'run-1', definitionId: 'def', handlerId: 'market-intelligence.refreshMacroCalendar',
  owner: 'product', productId: 'market-intelligence', title: 'Refresh', status: 'failed',
  trigger: { kind: 'interval' } as never, payload: {}, attempt: 1, maxAttempts: 1,
  createdAt: '2026-10-30T08:27:20.000Z', startedAt: '2026-10-30T08:27:20.000Z', completedAt: '2026-10-30T08:27:52.000Z',
  lastError: 'Macro calendar schedule run failed: provider-disabled',
  ...overrides
} as JobRunRecord)

describe('sync run projection', () => {
  it('reads the failure code and the duration out of a failed run', () => {
    expect(projectSyncRun(run())).toMatchObject({
      taskLabel: '官方日历排期', action: 'collect', outcome: 'failed',
      failureCode: 'provider-disabled', durationMs: 32_000
    })
  })

  it('takes the source from the run payload, not from the handler', () => {
    // `collectSource` serves every feed; the run itself says which one it read.
    const row = projectSyncRun(run({ handlerId: 'market-intelligence.collectSource', payload: { sourceId: 'coindesk-rss' } }))
    expect(row.taskLabel).toBe('情报源采集')
    expect(row.sources).toEqual([{ sourceId: 'coindesk-rss', label: expect.any(String) }])
  })

  it('leaves analysis runs without a source: they read everything', () => {
    expect(projectSyncRun(run({ handlerId: 'market-intelligence.runMarketAnalysis', payload: {} })).sources).toEqual([])
  })

  it('keeps an unregistered handler visible under its own id', () => {
    expect(projectSyncRun(run({ handlerId: 'market-intelligence.something-new', lastError: undefined }))).toMatchObject({
      taskLabel: 'market-intelligence.something-new', action: 'other', outcome: 'failed'
    })
  })

  it('maps a completed analysis run and a running one', () => {
    expect(projectSyncRun(run({ handlerId: 'market-intelligence.runMarketAnalysis', status: 'completed', lastError: undefined }))).toMatchObject({ action: 'analysis', outcome: 'succeeded' })
    expect(projectSyncRun(run({ status: 'running', completedAt: undefined }))).toMatchObject({ outcome: 'running' })
  })

  it('filters by window, source and outcome, newest first', () => {
    const now = Date.parse('2026-10-30T09:00:00.000Z')
    const rows = [
      run({ id: 'old', createdAt: '2026-10-01T00:00:00.000Z', startedAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T00:00:10.000Z' }),
      run({ id: 'new', status: 'completed', lastError: undefined, createdAt: '2026-10-30T08:50:00.000Z', startedAt: '2026-10-30T08:50:00.000Z', completedAt: '2026-10-30T08:50:01.000Z' }),
      run({ id: 'feed', handlerId: 'market-intelligence.collectSource', payload: { sourceId: 'coindesk-rss' }, completedAt: '2026-10-30T08:40:00.000Z' })
    ]
    expect(projectSyncRuns(rows, { window: '24h', sourceId: 'coindesk-rss', limit: 50 }, now).map((row) => row.runId)).toEqual(['feed'])
    expect(projectSyncRuns(rows, { window: '24h', limit: 50 }, now).map((row) => row.runId)).toEqual(['new', 'feed'])
    expect(projectSyncRuns(rows, { window: 'all', outcome: 'failed', limit: 50 }, now).map((row) => row.runId)).toEqual(['feed', 'old'])
  })

  it('caps the result and escapes the CSV', () => {
    const now = Date.parse('2026-10-30T09:00:00.000Z')
    const many = Array.from({ length: 10 }, (_unused, index) => run({ id: `r${index}` }))
    expect(projectSyncRuns(many, { window: 'all', limit: 3 }, now)).toHaveLength(3)
    const csv = syncRunsCsv([{ at: '2026-10-30T08:27:20.000Z', runId: 'r', correlationId: 'r', taskLabel: '情报源采集', sources: [{ sourceId: 's', label: 'FRED, 利率' }], handlerId: 'h', action: 'collect', outcome: 'failed', failureCode: 'provider-disabled', detail: 'boom "x"' }], ['at', 'source', 'action', 'outcome', 'ms', 'code', 'correlation', 'detail'])
    expect(csv.split('\n')[1]).toBe('2026-10-30T08:27:20.000Z,情报源采集,"FRED, 利率",collect,failed,,provider-disabled,r,"boom ""x"""')
  })
})
