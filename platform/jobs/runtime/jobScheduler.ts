import type { JobDefinition } from '../contracts/jobTypes'
import { computeNextCronRunAt } from './jobCronSchedule'

export type SchedulerDependencies = {
  enqueue: (definition: JobDefinition) => Promise<void>
  isLocked?: (concurrencyKey: string) => boolean
}

export type JobScheduler = {
  setSchedule: (definition: JobDefinition) => void
  removeSchedule: (definitionId: string) => void
  triggerManual: (definitionId: string) => Promise<void>
  triggerStartup: (definitionId: string) => Promise<void>
  notifyRunCompleted: (definitionId: string) => void
  stopAll: () => void
}

type ScheduledEntry = {
  definition: JobDefinition
  timer?: ReturnType<typeof setInterval>
  timeout?: ReturnType<typeof setTimeout>
}

export function createJobScheduler(deps: SchedulerDependencies): JobScheduler {
  const schedules = new Map<string, ScheduledEntry>()

  return {
    setSchedule(definition) {
      const existing = schedules.get(definition.id)
      if (existing?.timer) clearInterval(existing.timer)
      if (existing?.timeout) clearTimeout(existing.timeout)

      const entry: ScheduledEntry = { definition }
      if (definition.trigger.kind === 'interval' && definition.trigger.anchor === 'lastStart') {
        entry.timer = setInterval(() => {
          void maybeEnqueueInterval(definition, deps)
        }, definition.trigger.intervalMs)
      } else if (definition.trigger.kind === 'interval' && definition.trigger.anchor === 'lastComplete') {
        // `lastComplete` re-arms itself after each run, so the chain has to be started once here.
        // Without this first timeout a definition looks scheduled, holds no timer, and never runs:
        // that is why the market analysis staleness floor produced no job runs at all.
        entry.timeout = setTimeout(() => {
          void maybeEnqueueInterval(definition, deps)
        }, definition.trigger.intervalMs)
      } else if (definition.trigger.kind === 'cron') {
        scheduleCronTimeout(definition.id, entry, Date.now(), deps)
      }

      schedules.set(definition.id, entry)
    },
    removeSchedule(definitionId) {
      const entry = schedules.get(definitionId)
      if (entry?.timer) clearInterval(entry.timer)
      if (entry?.timeout) clearTimeout(entry.timeout)
      schedules.delete(definitionId)
    },
    async triggerManual(definitionId) {
      const definition = schedules.get(definitionId)?.definition
      if (!definition) throw new Error(`Unknown job definition "${definitionId}".`)
      await deps.enqueue(definition)
    },
    async triggerStartup(definitionId) {
      const definition = schedules.get(definitionId)?.definition
      if (!definition || definition.trigger.kind !== 'startup') {
        throw new Error(`Startup trigger is not configured for "${definitionId}".`)
      }
      await deps.enqueue(definition)
    },
    notifyRunCompleted(definitionId) {
      const entry = schedules.get(definitionId)
      const definition = entry?.definition
      if (!definition || definition.trigger.kind !== 'interval') return
      if (definition.trigger.anchor !== 'lastComplete') return

      if (entry?.timeout) clearTimeout(entry.timeout)
      entry.timeout = setTimeout(() => {
        void maybeEnqueueInterval(definition, deps)
      }, definition.trigger.intervalMs)
      schedules.set(definitionId, entry)
    },
    stopAll() {
      for (const entry of schedules.values()) {
        if (entry.timer) clearInterval(entry.timer)
        if (entry.timeout) clearTimeout(entry.timeout)
      }
      schedules.clear()
    }
  }
}

async function maybeEnqueueInterval(definition: JobDefinition, deps: SchedulerDependencies): Promise<void> {
  if (definition.trigger.kind !== 'interval') return
  if (definition.concurrencyKey && deps.isLocked?.(definition.concurrencyKey)) {
    return
  }
  await deps.enqueue(definition)
}

function scheduleCronTimeout(
  definitionId: string,
  entry: ScheduledEntry,
  startMs: number,
  deps: SchedulerDependencies
): void {
  if (entry.definition.trigger.kind !== 'cron') return
  if (entry.timeout) clearTimeout(entry.timeout)

  const nextRunAtMs = computeNextCronRunAt(
    entry.definition.trigger.expression,
    entry.definition.trigger.timezone,
    startMs
  )
  if (typeof nextRunAtMs !== 'number' || !Number.isFinite(nextRunAtMs)) {
    entry.timeout = undefined
    return
  }

  entry.timeout = setTimeout(() => {
    void handleCronTimeout(definitionId, entry, nextRunAtMs, deps)
  }, cronTimerDelayMs(nextRunAtMs, Date.now()))
}

/**
 * `setTimeout` stores its delay in a 32-bit signed integer: anything above {@link MAX_TIMER_DELAY_MS}
 * is clamped to 1 ms by the runtime. A monthly or yearly cron is further out than that, so handing
 * the raw difference over would fire the job immediately — at the wrong time — and the re-arm below
 * would fire it again and again. Capping the delay turns that into "wake up early, wait for the slot".
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

export function cronTimerDelayMs(nextRunAtMs: number, nowMs: number): number {
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, nextRunAtMs - nowMs))
}

/**
 * Where the search for the following slot starts after one slot fired.
 *
 * Normally that is a minute past the slot that just ran. If the process was asleep or blocked for
 * longer than the cadence, every slot in between is already missed: replaying them would dispatch
 * hundreds of runs back to back (a five-minute cron after a three-day sleep is 864 runs), so the
 * search restarts at the wake-up time and only one run happens.
 */
export function nextCronSearchStartMs(scheduledAtMs: number, firedAtMs: number): number {
  return Math.max(scheduledAtMs + 60_000, firedAtMs)
}

async function handleCronTimeout(
  definitionId: string,
  entry: ScheduledEntry,
  scheduledAtMs: number,
  deps: SchedulerDependencies
): Promise<void> {
  if (entry.definition.trigger.kind !== 'cron') return
  const firedAtMs = Date.now()
  if (firedAtMs < scheduledAtMs) {
    // Woke at the delay cap, not at the slot: re-arm for the same slot and enqueue nothing.
    scheduleCronTimeout(definitionId, entry, scheduledAtMs, deps)
    return
  }
  await maybeEnqueueCron(entry.definition, deps)
  scheduleCronTimeout(definitionId, entry, nextCronSearchStartMs(scheduledAtMs, Date.now()), deps)
}


async function maybeEnqueueCron(definition: JobDefinition, deps: SchedulerDependencies): Promise<void> {
  if (definition.trigger.kind !== 'cron') return
  if (definition.concurrencyKey && deps.isLocked?.(definition.concurrencyKey)) {
    return
  }
  await deps.enqueue(definition)
}
