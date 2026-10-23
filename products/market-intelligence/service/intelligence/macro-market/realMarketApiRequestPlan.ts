import { realMarketApiPolicy } from './realMarketApiPolicy'

export type RealMarketApiDxyPlan = 'run' | 'idle'

/** When the last successful tick happened. `force` is the startup tick, which looks immediately. */
export type RealMarketApiDxyPlanHistory = Readonly<{ lastRunAtMs?: number }>

/**
 * Whether this tick fetches.
 *
 * Elapsed time, not wall-clock arithmetic: an interval trigger fires on the phase the job was
 * registered at, so "minute % 5 === 0" collects only when that phase happens to line up — which is
 * how a collector silently stops for everyone whose app started at 09:02. The tolerance is the other
 * half of the same lesson: the handler runs a moment *after* the boundary that armed it, so a plan
 * asking for a full five minutes of elapsed time would skip every other tick and settle at ten.
 *
 * No history means no phase to be late for: the first tick of a fresh profile fetches immediately.
 */
export function realMarketApiDxyRequestPlan(
  nowMs: number,
  history: RealMarketApiDxyPlanHistory = {},
  options: Readonly<{ force?: boolean }> = {}
): RealMarketApiDxyPlan {
  if (options.force) return 'run'
  if (history.lastRunAtMs === undefined) return 'run'
  return nowMs - history.lastRunAtMs >= realMarketApiPolicy.intervalMs - realMarketApiPolicy.dueToleranceMs ? 'run' : 'idle'
}
