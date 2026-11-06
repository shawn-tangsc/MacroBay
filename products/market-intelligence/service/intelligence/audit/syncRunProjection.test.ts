import { describe, expect, it } from 'vitest'
import type { JobRunRecord } from '@platform/jobs'

import type { AnalysisRun } from '../../../contracts/marketAnalysisContracts'
import { projectSyncRun, projectSyncRuns, syncRunsCsv } from './syncRunProjection'

const run = (overrides: Partial<JobRunRecord> = {}): JobRunRecord => ({
  id: 'run-1', definitionId: 'def', handlerId: 'market-intelligence.refreshMacroCalendar',
  owner: 'product', productId: 'market-intelligence', title: 'Refresh', status: 'failed',
  trigger: { kind: 'interval' } as never, payload: {}, attempt: 1, maxAttempts: 1,
  createdAt: '2026-10-30T08:27:20.000Z', startedAt: '2026-10-30T08:27:20.000Z', completedAt: '2026-10-30T08:27:52.000Z',
  lastError: 'Macro calendar schedule run failed: provider-disabled',
  ...overrides
} as JobRunRecord)

describe('sync run projection', () => {  it('reads the failure code and the duration out of a failed run', () => {
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
    const csv = syncRunsCsv([{ at: '2026-10-30T08:27:20.000Z', runId: 'r', correlationId: 'r', taskLabel: '情报源采集', sources: [{ sourceId: 's', label: 'FRED, 利率' }], handlerId: 'h', action: 'collect', outcome: 'failed', analysis: { state: 'not-applicable' }, failureCode: 'provider-disabled', detail: 'boom "x"' }], ['at', 'source', 'action', 'outcome', 'ms', 'code', 'correlation', 'detail'])
    expect(csv.split('\n')[1]).toBe('2026-10-30T08:27:20.000Z,情报源采集,"FRED, 利率",collect,failed,,provider-disabled,r,"boom ""x"""')
  })
})

describe('sync run analysis link', () => {
  const analysisRun = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
    id: 'mi-ar-1', schemaVersion: 1, eventGroupId: 'group-1', snapshotId: 'snap-1', snapshotHash: 'hash-1',
    analysisPhase: 'initial', triggerKey: 'slot:asia', idempotencyKey: 'key-1', status: 'failed',
    attempt: 1, retryOfRunId: null, modelProviderId: 'tokenrhythm', modelId: 'deepseek-v4.1-flash-1017',
    policyVersion: 'policy-1', promptVersion: 'prompt-1', skillVersion: 'skill-1', outputSchemaVersion: 1,
    jobRunId: null, traceId: null, failureCode: 'analysis-provider-error', failureDetailCode: 'upstream-aborted',
    queuedAt: '2026-11-06T10:05:00.000Z', startedAt: '2026-11-06T10:05:02.000Z', completedAt: '2026-11-06T10:06:03.000Z',
    ...overrides
  } as AnalysisRun)

  const lookup = (runs: readonly AnalysisRun[]) => ({
    byJobRunId: new Map(runs.filter((run) => run.jobRunId).map((run) => [run.jobRunId!, run] as const)),
    byRunId: new Map(runs.map((run) => [run.id, run] as const))
  })

  it('links through job_run_id once the analysis side has written it back', () => {
    const row = projectSyncRun(
      run({ id: 'run-9', handlerId: 'market-intelligence.runMarketAnalysis', status: 'completed', lastError: undefined }),
      lookup([analysisRun({ jobRunId: 'run-9' })])
    )
    // The task finished; the analysis it owns did not publish. Two results, never one.
    expect(row.outcome).toBe('succeeded')
    expect(row.analysis).toMatchObject({
      state: 'linked',
      result: { runId: 'mi-ar-1', state: 'failed', failureCode: 'analysis-provider-error', failureDetailCode: 'upstream-aborted' }
    })
  })

  it('links through the id the task carried before the write-back lands', () => {
    const row = projectSyncRun(
      run({ id: 'run-9', handlerId: 'market-intelligence.runMarketAnalysis', payload: { analysisRunId: 'mi-ar-1' } }),
      lookup([analysisRun()])
    )
    expect(row.analysis).toMatchObject({ state: 'linked', result: { runId: 'mi-ar-1' } })
  })

  it('says unlinked when the task owns an analysis but no record can be tied to it', () => {
    const row = projectSyncRun(
      run({ id: 'run-9', handlerId: 'market-intelligence.runMarketAnalysis', payload: {} }),
      lookup([])
    )
    expect(row.analysis).toEqual({ state: 'unlinked' })
  })

  it('says not-applicable for a task that never produces an analysis', () => {
    expect(projectSyncRun(run({ handlerId: 'market-intelligence.collectSource' })).analysis).toEqual({
      state: 'not-applicable'
    })
    expect(projectSyncRun(run({ handlerId: 'market-intelligence.analysisSessionSlots' })).analysis).toEqual({
      state: 'not-applicable'
    })
  })
})
