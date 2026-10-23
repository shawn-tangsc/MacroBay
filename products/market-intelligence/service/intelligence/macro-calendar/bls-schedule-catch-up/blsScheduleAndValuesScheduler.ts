import type { JobDefinition, JobRuntime } from '@platform/jobs'
import type { BlsScheduleAndValuesSyncWorkflow } from './blsScheduleAndLatestValuesSyncWorkflow'

/**
 * Automatic refresh policy for the BLS official release values.
 *
 * The catch-up workflow already selects only schedule groups whose release date
 * has passed, so a tick that finds nothing new reports `not-required` and spends
 * no value request. This policy owns the cadence, the year derivation and the
 * job envelope; it deliberately does not add historical backfill or a persisted
 * backlog.
 */
export const blsScheduleAndValuesSchedulerPolicy = Object.freeze({
  definitionId: 'market-intelligence.syncBlsScheduleAndValues.automatic',
  handlerId: 'market-intelligence.syncBlsScheduleAndValues',
  title: 'Sync BLS schedule and latest values',
  /** BLS releases are monthly; six hours keeps a released value visible the same day. */
  intervalMs: 6 * 60 * 60 * 1_000,
  /** One tick syncs the schedule and at most two value requests. */
  jobTimeoutMs: 3 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 }
})

export type BlsScheduleAndValuesScheduler = Readonly<{ initialize: () => void; dispose: () => void }>

/**
 * Registers the interval job that keeps BLS official values fresh without a user
 * action.
 *
 * The workflow re-reads the schedule on every tick and only catches up groups
 * whose release date has passed, so repeated ticks without a new release are
 * no-ops. The year is derived per tick from the clock, never captured when the
 * schedule is registered, so the job keeps working across a year boundary.
 */
export function createBlsScheduleAndValuesScheduler(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  workflow: Pick<BlsScheduleAndValuesSyncWorkflow, 'sync'>
  /** The same enabled gate the other calendar jobs use: a disabled source does nothing. */
  readEnabled: () => boolean | Promise<boolean>
  now: () => Date
}>): BlsScheduleAndValuesScheduler {
  const policy = blsScheduleAndValuesSchedulerPolicy
  let disposed = false

  function automaticDefinition(): JobDefinition {
    return {
      id: policy.definitionId,
      owner: 'product',
      productId: 'market-intelligence',
      handlerId: policy.handlerId,
      title: policy.title,
      trigger: { kind: 'interval', intervalMs: policy.intervalMs, anchor: 'lastStart' },
      payload: {},
      concurrencyKey: policy.handlerId,
      timeoutMs: policy.jobTimeoutMs,
      retryPolicy: policy.jobRetryPolicy
    }
  }

  function initialize(): void {
    if (disposed) return
    deps.jobRuntime.registerHandler(policy.handlerId, async () => {
      if (disposed) return
      if (!await readEnabledSafe(deps.readEnabled)) return
      const year = String(deps.now().getUTCFullYear())
      const result = await deps.workflow.sync({ year })
      // `unavailable` means the schedule sync or the value read failed outright;
      // surfacing it as a failed job run keeps a dead source visible.
      if (result.state !== 'completed') throw new Error('BLS schedule and latest values sync did not complete.')
    })
    const definition = automaticDefinition()
    deps.jobRuntime.setSchedule(definition)
    // Run once at startup as well: a `lastStart` interval only fires after six hours,
    // so a fresh launch would not reconcile the BLS schedule until then. The startup
    // run carries its own definition id, so it cannot re-arm the interval.
    void deps.jobRuntime.enqueueDefinition({ ...definition, trigger: { kind: 'startup' } }).catch(() => undefined)
  }

  function dispose(): void {
    disposed = true
    deps.jobRuntime.removeSchedule(policy.definitionId)
  }

  return Object.freeze({ initialize, dispose })
}

async function readEnabledSafe(read: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    return (await read()) === true
  } catch {
    return false
  }
}
