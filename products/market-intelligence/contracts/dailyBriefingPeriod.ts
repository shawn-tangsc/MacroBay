import {
  DEFAULT_PERIOD_ID,
  dailyBriefingGenerationPolicy,
  type DailyBriefingLocale,
  type DailyBriefingWindowHours
} from './dailyBriefing'

/**
 * One period the reader configured: when it runs, how far back it looks, and which language it
 * writes. Language lives here, not in a global setting, because choosing the language is choosing
 * which edition you are adding — two periods at the same hour with different languages are two
 * rows, each of which can be changed or deleted on its own.
 *
 * The id is the identity; the generation time is only a display value. It is issued when a period is
 * created, opaque, and never derived from the hour, so moving a period from 07:00 to 08:00 cannot
 * detach the editions already generated under it.
 */
export type BriefingPeriodOrigin = 'user' | 'legacy-settings'

export type BriefingPeriod = Readonly<{
  id: string
  /** Local wall-clock `HH:mm`; also the cutoff of every edition this period writes. */
  generationTime: string
  windowHours: DailyBriefingWindowHours
  language: DailyBriefingLocale
  /** Only the one-time migration writes `legacy-settings`; a normal add is `user` (or absent). */
  origin?: BriefingPeriodOrigin
}>

/** What a reader can choose. The id and the origin are decided by the store, not by the form. */
export type BriefingPeriodDraft = Readonly<{
  generationTime: string
  windowHours: number
  language: DailyBriefingLocale
}>

/**
 * The uniqueness key: the same hour, window and language is the same period. Written once here so
 * the store and any future reader cannot disagree about what "duplicate" means.
 */
export function briefingPeriodTriple(period: Readonly<{
  generationTime: string
  windowHours: number
  language: DailyBriefingLocale
}>): string {
  return `${period.generationTime}|${period.windowHours}|${period.language}`
}

/** The period an empty configuration reads as: this build's single fixed schedule, in one language. */
export function createDefaultBriefingPeriod(language: DailyBriefingLocale): BriefingPeriod {
  return Object.freeze({
    id: DEFAULT_PERIOD_ID,
    generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
    windowHours: dailyBriefingGenerationPolicy.defaultWindowHours,
    language
  })
}
