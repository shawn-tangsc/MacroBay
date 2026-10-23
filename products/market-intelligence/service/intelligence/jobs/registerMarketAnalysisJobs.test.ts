import { describe, expect, it, vi } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'
import { ANALYSIS_SESSION_SLOTS_JOB, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, GROUP_MARKET_ANALYSIS_CHANGE_JOB, RUN_MARKET_ANALYSIS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB } from './marketAnalysisJobIds'
import { marketAnalysisJobPolicy, registerMarketAnalysisJobs } from './registerMarketAnalysisJobs'
import { marketAnalysisInvocationPolicy } from '../analysis/analysisOrchestrator'

describe('registerMarketAnalysisJobs', () => {
  it('arms nothing until the capability is enabled, and removes every definition when it is turned off', () => {
    const handlers = new Map<string, JobHandler>()
    const schedules: string[] = []
    const removed: string[] = []
    const runtime = {
      registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler),
      enqueueDefinition: vi.fn(async (definition: { id: string }) => ({ id: definition.id })),
      enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId })),
      setSchedule: (definition: { id: string }) => schedules.push(definition.id),
      removeSchedule: (definitionId: string) => removed.push(definitionId)
    } as unknown as JobRuntime
    const jobs = registerMarketAnalysisJobs(runtime, { groupChange: vi.fn(), freezeSnapshot: vi.fn(), runAnalysis: vi.fn(), verifyPredictions: vi.fn(), recoverRuns: vi.fn() })

    // Nothing is armed by default: the capability is off until the reader turns it on, and turning
    // it off removes every definition the capability owns.
    expect(schedules).toEqual([])
    jobs.applySchedules(false)
    expect(removed).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])
    jobs.applySchedules(true)
    expect(schedules).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])
    // Re-applying the same state must not arm the startup instances twice.
    jobs.applySchedules(true)
    expect(schedules).toHaveLength(3)
    removed.length = 0
    jobs.applySchedules(false)
    expect(removed).toEqual([VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB])
  })

  it('keeps the enclosing job budget above the model budget', () => {
    // The job aborts the handler through `context.signal`, which the orchestrator forwards to the
    // model call. If the job ended first, a model that could still answer would be recorded as
    // `analysis-timeout`. The two values are owned in different files, so the invariant lives here.
    expect(marketAnalysisJobPolicy.runTimeoutMs).toBeGreaterThan(marketAnalysisInvocationPolicy.modelTimeoutMs)
  })

  it('freezes the verification watermark at execution, not registration', async () => {
    const handlers = new Map<string, JobHandler>()
    const verifyPredictions = vi.fn()
    const runtime = { registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler) } as JobRuntime
    const now = () => '2026-09-28T01:00:00.000Z'
    registerMarketAnalysisJobs(runtime, { groupChange: vi.fn(), freezeSnapshot: vi.fn(), runAnalysis: vi.fn(), verifyPredictions, recoverRuns: vi.fn() }, { now })
    const context = { jobRunId: 'test', signal: new AbortController().signal, log: vi.fn(), progress: vi.fn() }
    await handlers.get(VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB)!({}, context)
    expect(verifyPredictions).toHaveBeenLastCalledWith({ asOf: now() }, context)
    const historical = '2026-09-27T00:00:00.000Z'
    await handlers.get(VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB)!({ asOf: historical }, context)
    expect(verifyPredictions).toHaveBeenLastCalledWith({ asOf: historical }, context)
    await expect(handlers.get(VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB)!({ asOf: '2026-02-30T00:00:00.000Z' }, context)).rejects.toThrow('analysis-invalid-job-payload')
  })
  it('registers the five MI-A04 handlers and enqueues the next stage', async () => {
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition) => ({ id: definition.id }))
    const enqueueStartup = vi.fn(async (definitionId: string) => ({ id: definitionId }))
    const schedules: Array<{ id: string; trigger: unknown }> = []
    const runtime = { registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler), enqueueDefinition, enqueueStartup, setSchedule: (definition: { id: string; trigger: unknown; payload?: unknown }) => schedules.push(definition) } as unknown as JobRuntime
    const groupChange = vi.fn(async () => ({ eventGroupId: 'mi-eg-1', shouldFreeze: true, triggerKey: 'macro.actual.first-confirmed', analysisPhase: 'initial' as const, asOf: '2026-09-27T00:00:00.000Z' }))
    const freeze = vi.fn(async () => ({ eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', analysisRunId: 'mi-ar-1', triggerKey: 'macro.actual.first-confirmed', analysisPhase: 'initial' as const, asOf: '2026-09-27T00:00:00.000Z' }))
    registerMarketAnalysisJobs(runtime, { groupChange, freezeSnapshot: freeze, runAnalysis: vi.fn(), verifyPredictions: vi.fn(), recoverRuns: vi.fn() }).applySchedules(true)
    expect([...handlers.keys()]).toEqual(expect.arrayContaining([GROUP_MARKET_ANALYSIS_CHANGE_JOB, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, RUN_MARKET_ANALYSIS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, ANALYSIS_SESSION_SLOTS_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB]))
    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, trigger: { kind: 'interval', intervalMs: 300_000, anchor: 'lastComplete' } }),
      // The opens are served by an interval job, and `lastComplete` arms its first timer a full
      // period out — so the startup instance below is what makes "open the app and be caught up"
      // true rather than "open the app and wait fifteen minutes".
      expect.objectContaining({ id: ANALYSIS_SESSION_SLOTS_JOB, trigger: { kind: 'interval', intervalMs: 15 * 60 * 1_000, anchor: 'lastComplete' } }),
      expect.objectContaining({ id: RECOVER_MARKET_ANALYSIS_RUNS_JOB, trigger: { kind: 'startup' } })
    ]))
    expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({ id: `${ANALYSIS_SESSION_SLOTS_JOB}:startup`, handlerId: ANALYSIS_SESSION_SLOTS_JOB, trigger: { kind: 'manual' } }))
    expect(schedules.find((definition) => definition.id === VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB)?.payload).toEqual({})
    expect(enqueueStartup).toHaveBeenCalledWith(RECOVER_MARKET_ANALYSIS_RUNS_JOB)
    await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: 'c1', eventRef: 'e1' }, { jobRunId: 'job-1', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) })
    const freezeDefinition = enqueueDefinition.mock.calls.find(([definition]) => definition.handlerId === FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)?.[0]
    expect(freezeDefinition?.redact?.({ eventGroupId: 'mi-eg-1', triggerKey: 'safe', prompt: 'secret' })).toEqual({ eventGroupId: 'mi-eg-1', triggerKey: 'safe' })
    expect(freezeDefinition).toEqual(expect.objectContaining({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB }))
    await handlers.get(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)!({ eventGroupId: 'mi-eg-1', triggerKey: 'macro.actual.first-confirmed', analysisPhase: 'initial', asOf: '2026-09-27T00:00:00.000Z' }, { jobRunId: 'job-2', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) })
    const runDefinition = enqueueDefinition.mock.calls.find(([definition]) => definition.handlerId === RUN_MARKET_ANALYSIS_JOB)?.[0]
    expect(runDefinition?.redact?.({ analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', prompt: 'secret', providerBody: 'secret' })).toEqual({ analysisRunId: 'mi-ar-1' })
    expect(runDefinition).toEqual(expect.objectContaining({
      handlerId: RUN_MARKET_ANALYSIS_JOB, payload: { analysisRunId: 'mi-ar-1' },
      concurrencyKey: 'eventGroup:mi-eg-1', timeoutMs: marketAnalysisJobPolicy.runTimeoutMs,
      retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 5_000, maxDelayMs: 60_000 }
    }))
    await expect(handlers.get(RUN_MARKET_ANALYSIS_JOB)!({}, { jobRunId: 'job-3', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) })).rejects.toThrow('analysis-invalid-job-payload')
  })
  it('dispatches a recovered run job, because a compensated row is not a running analysis', async () => {
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition: { id: string }) => ({ id: definition.id }))
    const runtime = { registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler), enqueueDefinition, enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId })), setSchedule: vi.fn() } as unknown as JobRuntime
    const recoverRuns = vi.fn(async () => ({
      dispatch: [
        { analysisRunId: 'mi-ar-orphan', eventGroupId: 'mi-eg-1' },
        // A malformed entry must be dropped, not turned into an unnamed run job.
        { analysisRunId: '', eventGroupId: 'mi-eg-1' },
        { eventGroupId: 'mi-eg-1' }
      ]
    }))
    registerMarketAnalysisJobs(runtime, { groupChange: vi.fn(), freezeSnapshot: vi.fn(), runAnalysis: vi.fn(), verifyPredictions: vi.fn(), recoverRuns })
    const context = { jobRunId: 'job-1', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) }
    await handlers.get(RECOVER_MARKET_ANALYSIS_RUNS_JOB)!({}, context)
    const dispatched = enqueueDefinition.mock.calls.map(([definition]) => definition).filter(definition => definition.handlerId === RUN_MARKET_ANALYSIS_JOB)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual(expect.objectContaining({
      id: 'market-analysis:run:mi-ar-orphan',
      payload: { analysisRunId: 'mi-ar-orphan' },
      concurrencyKey: 'eventGroup:mi-eg-1',
      timeoutMs: marketAnalysisJobPolicy.runTimeoutMs
    }))
  })
  it('carries the gate trigger reasons on the run payload, and still rejects unknown keys', async () => {
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async (definition: { id: string }) => ({ id: definition.id }))
    const runtime = { registerHandler: (id: string, handler: JobHandler) => handlers.set(id, handler), enqueueDefinition, enqueueStartup: vi.fn(async (definitionId: string) => ({ id: definitionId })), setSchedule: vi.fn() } as unknown as JobRuntime
    const freeze = vi.fn(async () => ({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', significanceSignals: '[{"kind":"actual-changed","eventKey":"US.CPI.RELEASE.2026-M09"}]' }))
    const runAnalysis = vi.fn()
    registerMarketAnalysisJobs(runtime, { groupChange: vi.fn(), freezeSnapshot: freeze, runAnalysis, verifyPredictions: vi.fn(), recoverRuns: vi.fn() })
    const context = { jobRunId: 'job-1', signal: new AbortController().signal, log: vi.fn(async () => undefined), progress: vi.fn(async () => undefined) }
    await handlers.get(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)!({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', analysisPhase: 'correction', asOf: '2026-09-27T00:00:00.000Z' }, context)
    const runDefinition = enqueueDefinition.mock.calls.map(([definition]) => definition).find(definition => definition.handlerId === RUN_MARKET_ANALYSIS_JOB)
    expect(runDefinition?.payload).toEqual({ analysisRunId: 'mi-ar-1', significanceSignals: '[{"kind":"actual-changed","eventKey":"US.CPI.RELEASE.2026-M09"}]' })
    // Redaction must keep the reasons the prompt needs, and drop everything else.
    expect(runDefinition?.redact?.({ analysisRunId: 'mi-ar-1', significanceSignals: '[]', prompt: 'secret', providerBody: 'secret' }))
      .toEqual({ analysisRunId: 'mi-ar-1', significanceSignals: '[]' })
    // A run without reasons is still valid: recovery-created runs have none.
    await handlers.get(RUN_MARKET_ANALYSIS_JOB)!({ analysisRunId: 'mi-ar-1' }, context)
    expect(runAnalysis).toHaveBeenCalledTimes(1)
    // The key set stays closed.
    await expect(handlers.get(RUN_MARKET_ANALYSIS_JOB)!({ analysisRunId: 'mi-ar-1', injected: 'x' }, context)).rejects.toThrow('analysis-invalid-job-payload')
    await expect(handlers.get(RUN_MARKET_ANALYSIS_JOB)!({ analysisRunId: 'mi-ar-1', significanceSignals: 7 }, context)).rejects.toThrow('analysis-invalid-job-payload')
  })
})
