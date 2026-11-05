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
  schemaVersion: 13,
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
 * cutoff, so the two can never drift apart. A period may run at any half hour of the day (00:00 …
 * 23:30): the morning-only table could not express an evening issue at all. The default stays 07:00,
 * and every value the old nine-slot table allowed is still in the table.
 */
export const dailyBriefingGenerationPolicy = Object.freeze({
  defaultGenerationTime: '07:00',
  earliestGenerationHour: 0,
  latestGenerationHour: 23,
  generationMinuteStep: 30,
  defaultWindowHours: 24,
  windowHoursOptions: Object.freeze([12, 24, 48] as const)
})

/** Local generation times a reader may choose, in order: 00:00 … 23:30, one per half hour. */
export const dailyBriefingGenerationTimes: readonly string[] = Object.freeze(
  Array.from(
    // Both ends of the last hour are usable (23:00 and 23:30), so the count covers whole hours.
    { length: (dailyBriefingGenerationPolicy.latestGenerationHour + 1 - dailyBriefingGenerationPolicy.earliestGenerationHour) * (60 / dailyBriefingGenerationPolicy.generationMinuteStep) },
    (_, index) => {
      const minutes = dailyBriefingGenerationPolicy.earliestGenerationHour * 60 + index * dailyBriefingGenerationPolicy.generationMinuteStep
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    }
  )
)

export function isDailyBriefingGenerationTime(value: unknown): value is string {
  return typeof value === 'string' && dailyBriefingGenerationTimes.includes(value)
}

/**
 * The choice grid as one fact, so the form's hint and the form's options cannot disagree.
 *
 * The dialog used to name the grid in prose ("06:00–10:00") while the list behind it had already
 * moved to the whole day; a hint that is typed out separately always becomes a second source. These
 * four numbers are read from the table itself.
 */
export const dailyBriefingGenerationGrid = Object.freeze({
  first: dailyBriefingGenerationTimes[0]!,
  last: dailyBriefingGenerationTimes.at(-1)!,
  count: dailyBriefingGenerationTimes.length,
  stepMinutes: dailyBriefingGenerationPolicy.generationMinuteStep
})

export type DailyBriefingWindowHours = (typeof dailyBriefingGenerationPolicy.windowHoursOptions)[number]

export function isDailyBriefingWindowHours(value: unknown): value is DailyBriefingWindowHours {
  return typeof value === 'number' && (dailyBriefingGenerationPolicy.windowHoursOptions as readonly number[]).includes(value)
}
