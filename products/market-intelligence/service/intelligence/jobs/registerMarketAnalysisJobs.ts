import type { JobContext, JobRuntime } from '@platform/jobs'
import {
  ANALYSIS_SESSION_SLOTS_JOB,
  FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, GROUP_MARKET_ANALYSIS_CHANGE_JOB, RECOVER_MARKET_ANALYSIS_RUNS_JOB,
  RUN_MARKET_ANALYSIS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB
} from './marketAnalysisJobIds'
import { analysisSlotTickPolicy } from '../analysis/analysisSlotTick'
import { analysisTriggerPolicy } from '../analysis/analysisTriggerPolicy'

export const marketAnalysisJobPolicy = Object.freeze({
  productId: 'market-intelligence',
  definitionIdPrefix: 'market-analysis:',
  // Must exceed the model invocation budget so a valid large snapshot can
  // finish before the enclosing job aborts it. The model budget is 240s and the
  // enclosing job keeps a further 120s for reading the snapshot and committing the
  // summary; `registerMarketAnalysisJobs.test.ts` fails if the two ever invert.
  runTimeoutMs: 360_000,
  runRetryPolicy: { maxAttempts: 3, backoff: 'exponential' as const, baseDelayMs: 5_000, maxDelayMs: 60_000 }
})

type StageResult = Readonly<Record<string, unknown>>
type Stage = (payload: unknown, context: JobContext) => Promise<StageResult | void>
type Dependencies = Readonly<{
  groupChange: Stage
  freezeSnapshot: Stage
  runAnalysis: Stage
  verifyPredictions: Stage
  recoverRuns: Stage
  runSessionSlots: (context: JobContext) => Promise<void>
}>

const canonicalUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function registerMarketAnalysisJobs(jobRuntime: JobRuntime, deps: Dependencies, options: Readonly<{ startRecovery?: boolean; now?: () => string }> = {}): Readonly<{ applySchedules: (enabled: boolean) => void }> {
  jobRuntime.registerHandler(GROUP_MARKET_ANALYSIS_CHANGE_JOB, async (payload, context) => {
    assertPayload(payload, ['changeId', 'eventRef'])
    const result = await deps.groupChange(payload, context)
    if (!result || result.shouldFreeze !== true) return
    await enqueue(jobRuntime, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, {
      eventGroupId: result.eventGroupId, triggerKey: result.triggerKey, analysisPhase: result.analysisPhase, asOf: result.asOf
    }, `freeze:${String(result.eventGroupId)}`)
  })
  jobRuntime.registerHandler(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, async (payload, context) => {
    assertPayload(payload, ['eventGroupId', 'triggerKey', 'analysisPhase', 'asOf'])
    const result = await deps.freezeSnapshot(payload, context)
    if (!result || typeof result.analysisRunId !== 'string') return
    if (typeof result.eventGroupId !== 'string') throw new Error('analysis-invalid-job-result')
    // Why this run happened travels with the run itself: the run job only receives
    // `{ analysisRunId }` and rebuilds its prompt from the persisted snapshot, which has no
    // place to keep the gate's reasoning.
    const carried = typeof result.significanceSignals === 'string' && result.significanceSignals.length > 0
      ? { significanceSignals: result.significanceSignals } : {}
    await enqueue(jobRuntime, RUN_MARKET_ANALYSIS_JOB, { analysisRunId: result.analysisRunId, ...carried }, `run:${result.analysisRunId}`, result.eventGroupId)
  })
  jobRuntime.registerHandler(RUN_MARKET_ANALYSIS_JOB, async (payload, context) => {
    assertPayload(payload, ['analysisRunId'], ['significanceSignals'])
    await deps.runAnalysis(payload, context)
  })
  jobRuntime.registerHandler(VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, async (payload, context) => {
    const suppliedAsOf = readAsOf(payload)
    if (suppliedAsOf === false) throw new Error('analysis-invalid-job-payload')
    const asOf = suppliedAsOf ?? options.now?.() ?? new Date().toISOString()
    if (!isCanonicalUtc(asOf)) throw new Error('analysis-invalid-job-payload')
    await deps.verifyPredictions({ asOf }, context)
  })
  jobRuntime.registerHandler(RECOVER_MARKET_ANALYSIS_RUNS_JOB, async (payload, context) => {
    const result = await deps.recoverRuns(payload, context)
    // Recovery has no snapshot to freeze: it re-dispatches a run that already points at a
    // frozen snapshot, so the run job is the whole remaining chain. Without this the
    // compensated row stayed `queued` for good and blocked the group's manual requests.
    for (const entry of readRecoveryDispatch(result)) {
      await enqueue(jobRuntime, RUN_MARKET_ANALYSIS_JOB, { analysisRunId: entry.analysisRunId }, `run:${entry.analysisRunId}`, entry.eventGroupId)
    }
  })
  // The schedule is a clock, not a data question: an open must be served even when nothing moved.
  jobRuntime.registerHandler(ANALYSIS_SESSION_SLOTS_JOB, async (payload, context) => {
    assertPayload(payload, [])
    await deps.runSessionSlots(context)
  })
  const hasScheduler = typeof jobRuntime.setSchedule === 'function'
  console.log(JSON.stringify({ marker: 'MI_ANALYSIS_JOBS_REGISTERING', hasScheduler }))
  if (!hasScheduler) {
    // Loud on purpose: with no scheduler the floor and the verifier cannot ever run, and the
    // silence is what made "the floor never ran" take a day to find.
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_JOBS_UNSCHEDULED', reason: 'jobRuntime.setSchedule missing' }))
  }
  const verificationDefinition = {
    id: VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, owner: 'product', productId: marketAnalysisJobPolicy.productId,
    handlerId: VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB, title: 'Verify market analysis predictions',
    trigger: { kind: 'interval', intervalMs: analysisTriggerPolicy.verificationIntervalMs, anchor: 'lastComplete' }, payload: {}
  } as const
  const sessionSlotDefinition = {
    id: ANALYSIS_SESSION_SLOTS_JOB, owner: 'product', productId: marketAnalysisJobPolicy.productId,
    handlerId: ANALYSIS_SESSION_SLOTS_JOB, title: 'Serve the market analysis session slots',
    trigger: { kind: 'interval', intervalMs: analysisSlotTickPolicy.intervalMs, anchor: 'lastComplete' }, payload: {}
  } as const
  const recoveryDefinition = {
    id: RECOVER_MARKET_ANALYSIS_RUNS_JOB, owner: 'product', productId: marketAnalysisJobPolicy.productId,
    handlerId: RECOVER_MARKET_ANALYSIS_RUNS_JOB, title: 'Recover market analysis runs',
    trigger: { kind: 'startup' }, payload: {}
  } as const
  let armed = false

  /**
   * The analysis owns no standing schedule.
   *
   * The capability is off until the reader enables it, so nothing may be armed by default: enabling
   * registers the three definitions, disabling removes every one of them and stops the startup
   * catch-up as well. `removeSchedule` is what makes "off" mean off rather than "the handler returns
   * early while the clock keeps ticking".
   */
  function applySchedules(enabled: boolean): void {
    if (!hasScheduler) return
    if (!enabled) {
      // Disarming is idempotent and always runs: a definition left over from an earlier process (or
      // from a version that armed on registration) must not survive a stored "off".
      if (typeof jobRuntime.removeSchedule === 'function') {
        jobRuntime.removeSchedule(VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB)
        jobRuntime.removeSchedule(ANALYSIS_SESSION_SLOTS_JOB)
        jobRuntime.removeSchedule(RECOVER_MARKET_ANALYSIS_RUNS_JOB)
      }
      armed = false
      return
    }
    if (armed) return
    armed = true
    jobRuntime.setSchedule(verificationDefinition)
    void jobRuntime.enqueueDefinition({ ...verificationDefinition, id: `${VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB}:startup`, trigger: { kind: 'manual' } }).catch(() => undefined)
    jobRuntime.setSchedule(sessionSlotDefinition)
    // A `lastComplete` interval arms its first timer a full period from now, so without this the
    // reader who opens the app at 09:05 would wait until 09:20 to be caught up on the 08:00 open —
    // and "catch up when the app opens" is the whole point of the schedule.
    void jobRuntime.enqueueDefinition({ ...sessionSlotDefinition, id: `${ANALYSIS_SESSION_SLOTS_JOB}:startup`, trigger: { kind: 'manual' } }).catch(() => undefined)
    jobRuntime.setSchedule(recoveryDefinition)
    if (options.startRecovery !== false) void jobRuntime.enqueueStartup(RECOVER_MARKET_ANALYSIS_RUNS_JOB).catch(() => undefined)
  }

  return Object.freeze({ applySchedules })
}

async function enqueue(jobRuntime: JobRuntime, handlerId: string, payload: Record<string, unknown>, id: string, eventGroupId?: string): Promise<void> {
  if (handlerId === RUN_MARKET_ANALYSIS_JOB && !eventGroupId) throw new Error('analysis-invalid-job-result')
  await jobRuntime.enqueueDefinition({
    id: `${marketAnalysisJobPolicy.definitionIdPrefix}${id}`, owner: 'product', productId: marketAnalysisJobPolicy.productId, handlerId,
    title: handlerId.split('.').pop() ?? handlerId, trigger: { kind: 'manual' }, payload,
    redact: value => redactMarketAnalysisPayload(handlerId, value),
    ...(handlerId === RUN_MARKET_ANALYSIS_JOB ? {
      concurrencyKey: `eventGroup:${String(eventGroupId)}`,
      timeoutMs: marketAnalysisJobPolicy.runTimeoutMs,
      retryPolicy: marketAnalysisJobPolicy.runRetryPolicy,
    } : {})
  })
}

/**
 * `optionalStrings` exists for keys a payload may legitimately omit (the gate's trigger
 * reasons: recovery-created runs have none). The key set stays closed either way, so an
 * unknown key is still rejected rather than silently carried around.
 */
function assertPayload(value: unknown, requiredStrings: readonly string[], optionalStrings: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('analysis-invalid-job-payload')
  const payload = value as Record<string, unknown>
  const allowed = [...requiredStrings, ...optionalStrings]
  const wrongShape = requiredStrings.some(key => typeof payload[key] !== 'string' || (key === 'asOf' && !canonicalUtc.test(payload[key] as string))) ||
    optionalStrings.some(key => Object.hasOwn(payload, key) && typeof payload[key] !== 'string')
  if (Object.keys(payload).some(key => !allowed.includes(key)) || wrongShape) throw new Error('analysis-invalid-job-payload')
}

function redactMarketAnalysisPayload(handlerId: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const payload = value as Record<string, unknown>
  if (handlerId === GROUP_MARKET_ANALYSIS_CHANGE_JOB) return pickStrings(payload, ['changeId', 'eventRef'])
  if (handlerId === FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB) return pickStrings(payload, ['eventGroupId', 'triggerKey', 'analysisPhase', 'asOf'])
  if (handlerId === RUN_MARKET_ANALYSIS_JOB) return pickStrings(payload, ['analysisRunId', 'significanceSignals'])
  if (handlerId === VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB) return pickStrings(payload, ['asOf'])
  return {}
}

function pickStrings(payload: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => typeof payload[key] === 'string' ? [[key, payload[key] as string]] : []))
}

/**
 * Reads the recovery stage's dispatch list defensively: a stage result is an untyped record,
 * and a malformed entry must be dropped rather than enqueued as an unnamed run job.
 */
function readRecoveryDispatch(result: StageResult | void): readonly { analysisRunId: string; eventGroupId: string }[] {
  const raw = (result as { dispatch?: unknown } | null | undefined)?.dispatch
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is { analysisRunId: string; eventGroupId: string } => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const value = entry as { analysisRunId?: unknown; eventGroupId?: unknown }
    return typeof value.analysisRunId === 'string' && value.analysisRunId.length > 0 && typeof value.eventGroupId === 'string' && value.eventGroupId.length > 0
  })
}

function readAsOf(value: unknown): string | false | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).some(key => key !== 'asOf')) return false
  if (!Object.hasOwn(payload, 'asOf')) return undefined
  return typeof payload.asOf === 'string' ? payload.asOf : false
}

function isCanonicalUtc(value: string): boolean {
  if (!canonicalUtc.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}
