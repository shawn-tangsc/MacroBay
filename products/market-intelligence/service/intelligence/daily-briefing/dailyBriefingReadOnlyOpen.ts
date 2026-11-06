import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingZoneSource } from './dailyBriefingWindow'

/**
 * Opening the brief as a read: the stored edition of this issue, or the fact that nothing was
 * written yet. It never starts a run — generation is the reader's to start.
 *
 * Extracted from the service's `getToday`, where it is one branch of an otherwise-run-shaped
 * function; it has no run logic and reads only the store.
 */
export type ReadOnlyOpenResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument; timeZoneSource?: DailyBriefingZoneSource }>
  | Readonly<{ state: 'unavailable'; failureCode: 'not-generated' }>

export async function openStoredEdition(input: Readonly<{
  store: Readonly<{ get: (date: string, locale: DailyBriefingLocale, periodId: string) => Promise<{ document: DailyBriefingDocument } | undefined> }>
  date: string
  locale: DailyBriefingLocale
  periodId: string
  zoneSource: DailyBriefingZoneSource
  /** Whether the stored document still matches the current policy; a stale one is not "available". */
  isCurrent: (document: DailyBriefingDocument) => boolean
}>): Promise<ReadOnlyOpenResult> {
  const stored = await input.store.get(input.date, input.locale, input.periodId).catch(() => undefined)
  return stored && input.isCurrent(stored.document)
    ? { state: 'available', document: stored.document, timeZoneSource: input.zoneSource }
    : { state: 'unavailable', failureCode: 'not-generated' }
}
