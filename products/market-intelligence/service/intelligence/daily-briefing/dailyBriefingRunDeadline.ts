import type { DailyBriefingTodayResult } from './dailyBriefingService'
import { DAILY_BRIEF_GENERATION_BUDGET_MS } from './dailyBriefingService'
import { dailyBriefReadinessPolicy } from './dailyBriefReadinessGate'

/**
 * The longest a caller may wait for one manual run, and what it hears when that runs out.
 *
 * The run itself is bounded step by step — fifteen minutes of readiness, five minutes of generation,
 * and deadlines around the source read and the agent turn. What was missing is the caller's own
 * bound: if any one of those settles in a way that never returns (a promise that neither resolves nor
 * rejects), the renderer shows a spinner forever and says nothing. A person then cannot tell "still
 * working" from "gone", which is the worst of both.
 *
 * The deadline is the sum of the parts plus a margin, so it only fires when something is genuinely
 * past every one of them. It does not cancel the run: the next progress poll still reports it, and
 * a later success still stores the edition.
 */
export const DAILY_BRIEF_RUN_DEADLINE_MS =
  dailyBriefReadinessPolicy.budgetMs + DAILY_BRIEF_GENERATION_BUDGET_MS + 60_000

/** The result a caller gets when its run did not answer in time. */
export const dailyBriefRunTimedOut: DailyBriefingTodayResult = Object.freeze({
  state: 'unavailable',
  failureCode: 'run-timeout'
})

export function withRunDeadline(
  run: Promise<DailyBriefingTodayResult>,
  timeoutMs: number = DAILY_BRIEF_RUN_DEADLINE_MS
): Promise<DailyBriefingTodayResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(dailyBriefRunTimedOut), timeoutMs)
    // Whichever settles first wins; the other path is dropped without an unhandled rejection.
    run.then((result) => { clearTimeout(timer); resolve(result) }, () => { clearTimeout(timer); resolve(dailyBriefRunTimedOut) })
  })
}
