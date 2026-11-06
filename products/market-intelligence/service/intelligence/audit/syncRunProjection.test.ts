import { describe, expect, it } from 'vitest'
import type { JobRunRecord } from '@platform/jobs'

import type { AnalysisRun } from '../../../contracts/marketAnalysisContracts'
import type { SyncRunRow } from '../../../contracts/syncRunRecords'
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

  it('reads the batch tally, its failure split and its languages off the record', () => {
    // 三样来自两处：计数与分布是这一批的**结论**（`result`），语言是**任务参数**（payload）。
    // 语言不进结论（平台明确过），所以它只能从 payload 的快照读——再存一份就有两处要同步。
    const row = projectSyncRun(run({
      handlerId: 'market-intelligence.translateItems',
      status: 'completed',
      lastError: undefined,
      payload: { itemIds: ['a', 'b'], reason: 'new-item', targetLocale: 'zh-CN' },
      result: {
        counts: { total: 12, succeeded: 10, failed: 2, skipped: 0 },
        reasonCode: 'model.timeout',
        reasons: { 'model.timeout': 1, 'model.rate-limited': 1 }
      }
    } as Partial<JobRunRecord>))

    expect(row.counts).toEqual({ total: 12, succeeded: 10, failed: 2, skipped: 0 })
    expect(row.reasons).toEqual({ 'model.timeout': 1, 'model.rate-limited': 1 })
    expect(row.languages).toEqual(['zh-CN'])
    expect(row.resultReasonCode).toBe('model.timeout')
  })

  it('shows no tally at all for a record that predates the counts', () => {
    // 「没量过」与「零条」是两件事：旧记录不给 0/0/0/0，否则它会被读成「跑过、一条没成」。
    const row = projectSyncRun(run({ status: 'completed', lastError: undefined }))
    expect(row.counts).toBeUndefined()
    expect(row.languages).toBeUndefined()
    expect('reasons' in row).toBe(false)
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

  it('carries the batch tally through, so "partly failed" can be read as numbers', () => {
    const row = projectSyncRun(run({
      handlerId: 'market-intelligence.translateItems',
      payload: { sourceId: 'coindesk-rss' },
      status: 'completed',
      result: { counts: { total: 6, succeeded: 5, failed: 1, skipped: 0 }, reasonCode: 'model.rate-limited' }
    }))
    expect(row.counts).toEqual({ total: 6, succeeded: 5, failed: 1, skipped: 0 })
    expect(row.resultReasonCode).toBe('model.rate-limited')
    // A batch that partly failed is still a completed job: the two facts stay apart.
    expect(row.outcome).toBe('succeeded')
  })

  it('drops a tally whose parts do not add up instead of showing four numbers that contradict', () => {
    const row = projectSyncRun(run({
      status: 'completed',
      result: { counts: { total: 9, succeeded: 5, failed: 1, skipped: 0 } }
    }))
    expect(row.counts).toBeUndefined()
  })

  it('shows nothing for a run that predates the tally', () => {
    // "no tally" and "zero translated" are different facts; zeroes would claim the second.
    expect(projectSyncRun(run({ status: 'completed' })).counts).toBeUndefined()
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
    // Appended, never inserted: the nine columns a spreadsheet was built on keep their places, and
    // a run with no tally leaves the four new cells empty rather than writing zeroes.
    expect(csv.split('\n')[1]).toBe('2026-10-30T08:27:20.000Z,情报源采集,"FRED, 利率",collect,failed,,provider-disabled,r,"boom ""x""",,,,')
  })

  it('writes the batch tally as four trailing columns, and leaves them empty when a run has none', () => {
    const row = (overrides: Partial<SyncRunRow>) => ({
      at: '2026-10-30T08:27:20.000Z', runId: 'r', correlationId: 'r', taskLabel: '翻译任务',
      sources: [], handlerId: 'market-intelligence.translateItems', action: 'other' as const,
      outcome: 'succeeded' as const, analysis: { state: 'not-applicable' as const }, ...overrides
    })
    const csv = syncRunsCsv([
      row({ counts: { total: 6, succeeded: 5, failed: 1, skipped: 0 } }),
      row({ counts: { total: 3, succeeded: 0, failed: 0, skipped: 3 } }),
      row({})
    ], ['at', 'task', 'source', 'action', 'outcome', 'ms', 'code', 'correlation', 'detail', 'total', 'succeeded', 'failed', 'skipped'])
    const [, counted, skipped, older] = csv.split('\n')
    expect(counted!.endsWith(',6,5,1,0')).toBe(true)
    expect(skipped!.endsWith(',3,0,0,3')).toBe(true)
    // No tally: empty cells. Zeroes would claim the batch ran and found nothing.
    expect(older!.endsWith(',,,,')).toBe(true)
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
