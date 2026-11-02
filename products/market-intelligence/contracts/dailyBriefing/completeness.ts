import type { DailyBriefingLocale } from './readings'

/**
 * Whether a published period is whole — the one place this is decided.
 *
 * The history rail and the exported image both say "incomplete", and they must say it for the same
 * reason. Reading the run's expected languages here instead of counting rows in each view keeps
 * them from disagreeing: a single-language period that published is complete (nothing is said),
 * a period that expected two and published one is missing a version, and a document short of its
 * readings says how many it lacks.
 */
export type DailyBriefingCompleteness =
  | Readonly<{ state: 'complete' }>
  | Readonly<{ state: 'missing-version' }>
  | Readonly<{ state: 'missing-readings'; count: number }>

export function briefingCompleteness(input: Readonly<{
  /** Languages the run intended to publish; absent means the published set is the intent. */
  expectedLocales?: readonly DailyBriefingLocale[]
  publishedLocales: readonly DailyBriefingLocale[]
  readingsAvailable?: number
  readingsTotal?: number
}>): DailyBriefingCompleteness {
  const expected = new Set(input.expectedLocales ?? input.publishedLocales)
  const published = new Set(input.publishedLocales)
  if ([...expected].every((locale) => published.has(locale))) {
    const missing = (input.readingsTotal ?? 0) - (input.readingsAvailable ?? 0)
    return missing > 0 ? { state: 'missing-readings', count: missing } : { state: 'complete' }
  }
  return { state: 'missing-version' }
}
