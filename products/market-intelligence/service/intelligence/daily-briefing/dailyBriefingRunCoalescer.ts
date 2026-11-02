import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'

/**
 * One run per edition, whichever path asked for it.
 *
 * The reader opening the page and the scheduler firing at the same minute must not publish two
 * editions, and a reader pressing 重新生成 three times must not start three concurrent runs. A
 * second request for the same key joins the run already working on that edition instead of
 * starting another one.
 *
 * The live snapshot is owned here for the same reason: it is dropped the moment the run settles,
 * because the finished trace is written to the store (or returned with the result), and keeping a
 * copy would be a second version of the same attempt.
 */
export type DailyBriefingRunCoalescer<Result> = Readonly<{
  /** Live snapshots of the runs in progress right now, keyed like `join`. */
  progress: Map<string, BriefingGenerationProgress>
  /** The key that makes two requests mean the same edition: date, period and language. */
  key: (date: string, periodId: string, locale: string) => string
  /** Join the run for `key`, or start one when nothing is working on it. */
  join: (key: string, start: () => Promise<Result>) => Promise<Result>
}>

export function createDailyBriefingRunCoalescer<Result>(): DailyBriefingRunCoalescer<Result> {
  const inFlight = new Map<string, Promise<Result>>()
  const progress = new Map<string, BriefingGenerationProgress>()
  return {
    progress,
    key(date, periodId, locale) {
      return `${date}:${periodId}:${locale}`
    },
    join(key, start) {
      const running = inFlight.get(key)
      if (running) return running
      const promise = start().finally(() => {
        progress.delete(key)
        inFlight.delete(key)
      })
      inFlight.set(key, promise)
      return promise
    }
  }
}
