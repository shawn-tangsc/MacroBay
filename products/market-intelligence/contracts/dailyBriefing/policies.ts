/**
 * The daily brief's frozen policy numbers: what one edition may carry, when it runs, how far back it
 * looks. Kept apart from the document shapes so a schema change and a budget change are never the
 * same diff.
 */

/**
 * The frozen daily-briefing document.
 *
 * This is the one shape the renderer, the Markdown serializer and the stored edition share. It is
 * data only: labels are keys, prose is the published conclusion's own text, and every number keeps
 * its window and observation time. The main process builds it; the renderer never re-derives it.
 *
 * `maximumNewsItems` and `maximumMacroItems` are the per-class candidate budget: one edition may
 * carry at most 200 news candidates and 200 macro candidates. A larger pool is a generation
 * failure (`candidate-overflow`) rather than a silent truncation, so an edition never pretends a
 * dropped tail was the day's full selection. The renderer reads the same numbers from here when it
 * validates an incoming document, which keeps the client and the builder from drifting apart.
 */
export const dailyBriefingPolicy = Object.freeze({
  schemaVersion: 12,
  policyVersion: 'daily-briefing.v23',
  /** The default statistical window. The reader's generation settings may override it per edition. */
  windowHours: 24,
  maximumBytes: 256 * 1024,
  maximumNewsItems: 200,
  maximumMacroItems: 200,
  maximumNextItems: 3,
  maximumCounterEvidence: 3,
  maximumConditions: 5,
  maximumGaps: 3,
  maximumCaveats: 3,
  retentionDays: 14,
  editionDatePattern: /^\d{4}-\d{2}-\d{2}$/
})

/**
 * When the brief is generated and what it covers.
 *
 * The generation time is a local wall-clock time: it is both the scheduler trigger and the edition
 * cutoff, so the two can never drift apart. Only whole and half hours in the morning window are
 * accepted, which keeps the cron expression readable and the cutoff reviewable.
 */
export const dailyBriefingGenerationPolicy = Object.freeze({
  defaultGenerationTime: '07:00',
  earliestGenerationHour: 6,
  latestGenerationHour: 10,
  generationMinuteStep: 30,
  defaultWindowHours: 24,
  windowHoursOptions: Object.freeze([12, 24, 48] as const)
})

/** Local generation times a reader may choose, in order: 06:00 … 10:00. */
export const dailyBriefingGenerationTimes: readonly string[] = Object.freeze(
  Array.from(
    { length: ((dailyBriefingGenerationPolicy.latestGenerationHour - dailyBriefingGenerationPolicy.earliestGenerationHour) * (60 / dailyBriefingGenerationPolicy.generationMinuteStep)) + 1 },
    (_, index) => {
      const minutes = dailyBriefingGenerationPolicy.earliestGenerationHour * 60 + index * dailyBriefingGenerationPolicy.generationMinuteStep
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    }
  )
)

export function isDailyBriefingGenerationTime(value: unknown): value is string {
  return typeof value === 'string' && dailyBriefingGenerationTimes.includes(value)
}

export type DailyBriefingWindowHours = (typeof dailyBriefingGenerationPolicy.windowHoursOptions)[number]

export function isDailyBriefingWindowHours(value: unknown): value is DailyBriefingWindowHours {
  return typeof value === 'number' && (dailyBriefingGenerationPolicy.windowHoursOptions as readonly number[]).includes(value)
}
