import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { briefingGenerationStageIds } from '../../../contracts/dailyBriefing'

import { awaitDailyBriefReadiness, dailyBriefReadinessPolicy, type DailyBriefReadiness } from './dailyBriefReadinessGate'
import { ensureBriefingBars, type BriefingBarBackfill } from './dailyBriefMarketBackfill'

/**
 * The wait before a run may open its attempt, published as progress.
 *
 * The generation waits for the market it is about to read, and it opens no attempt, no session and
 * no stage until the wait ends — by design, so an abandoned wait leaves no half-run behind. The
 * reader then sees one "generating" with no record anywhere and cannot tell waiting from stuck.
 *
 * This publishes the wait itself: the same nine stages, all pending, plus how long it has waited and
 * how many times it has asked. It is replaced by the recorder's own snapshot the moment the attempt
 * opens, so the two never describe the same moment.
 */
export type DailyBriefProgressWaitingPublisher = Readonly<{
  /** The moment the wait began, so the caller can decide whether anything is waiting at all. */
  since: string
  publish: (polls: number, waitedMs: number) => void
}>

export function createDailyBriefProgressWaitingPublisher(
  publish: (progress: BriefingGenerationProgress) => void,
  now: () => string
): DailyBriefProgressWaitingPublisher {
  const since = now()
  const stages = briefingGenerationStageIds.map((id) => ({ id, state: 'pending' as const }))
  return {
    since,
    publish: (polls, waitedMs) => publish({
      // No attempt exists yet: an id here would name a row that does not exist.
      attemptId: '',
      startedAt: since,
      stages,
      waiting: { since, polls, waitedMs, budgetMs: dailyBriefReadinessPolicy.budgetMs }
    })
  }
}

/**
 * The same wait, as the generation path calls it: publish the wait, then wait, then report.
 *
 * One call so the generation path carries one line and cannot forget to publish: a wait nobody can
 * see is the defect this exists to prevent.
 */
export async function awaitDailyBriefReadinessPublished(
  readiness: DailyBriefReadiness | undefined,
  asOf: string,
  publish: (progress: BriefingGenerationProgress) => void,
  now: () => string
): Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }> | undefined> {
  if (!readiness) return undefined
  const waiting = createDailyBriefProgressWaitingPublisher(publish, now)
  waiting.publish(0, 0)
  return awaitDailyBriefReadiness(readiness, asOf, (poll) => waiting.publish(poll.polls, poll.waitedMs))
}

/**
 * The generation path's one call: wait for the market, unless the reader asked for this run.
 *
 * The gate exists to stop an automatic run from reading a market that has not arrived yet. A reader
 * pressing 重新生成 has already decided to spend a run, and making them wait the full budget for a
 * probe that may never answer turns the button into a dead control. A manual run therefore goes
 * straight to work, and says so in the log.
 */
export async function awaitReadinessForRun(
  readiness: DailyBriefReadiness | undefined,
  asOf: string,
  manual: boolean,
  publish: (progress: BriefingGenerationProgress) => void,
  now: () => string
): Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }> | undefined> {
  if (manual) {
    console.log(JSON.stringify({ marker: 'MI_DAILY_BRIEF_READINESS_SKIPPED_MANUAL', asOf }))
    return undefined
  }
  return awaitDailyBriefReadinessPublished(readiness, asOf, publish, now)
}

/** What the generation path needs to know about the market before it opens its attempt. */
export type MarketPreparation = Readonly<{
  readinessWait: Readonly<{ ready: boolean; polls: number; waitedMs: number }> | undefined
  /** Whether a fetch for the missing quotes was attempted, so the edition can say so in its gaps. */
  backfillAttempted: boolean
}>

/**
 * Get this edition's market into the state generation can use: fetch the missing bars once, then wait.
 *
 * Both halves exist because they answer different failures: a bar that was never fetched needs the
 * collector asked (this module), and a bar that was just fetched needs a moment to become readable at
 * the cutoff (the readiness gate). Doing only the second is what made the gate wait out its budget
 * every morning for data nobody had asked for.
 */
export async function prepareMarketForRun(input: Readonly<{
  backfill?: BriefingBarBackfill
  readiness?: DailyBriefReadiness
  asOf: string
  manual: boolean
  publish: (progress: BriefingGenerationProgress) => void
  now: () => string
}>): Promise<MarketPreparation> {
  let backfillAttempted = false
  if (input.backfill) {
    const cutoff = Date.parse(input.asOf)
    if (Number.isFinite(cutoff)) {
      const atMs = Math.floor(cutoff / 300_000) * 300_000
      const outcome = await ensureBriefingBars(input.backfill, { atMs, dayBeforeMs: atMs - 86_400_000, asOfMs: Date.parse(input.now()) })
      backfillAttempted = outcome.attempted
      if (outcome.attempted) console.log(JSON.stringify({ marker: 'MI_DAILY_BRIEF_BAR_BACKFILL', filled: outcome.filled, atMs }))
    }
  }
  const readinessWait = await awaitReadinessForRun(input.readiness, input.asOf, input.manual, input.publish, input.now)
  return { readinessWait, backfillAttempted }
}
