import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStoredEdition } from './dailyBriefingService'

/**
 * The most recent edition published before a day — not necessarily yesterday's.
 *
 * A publication-day baseline is the previous *release*, so a day the app was not open must not erase
 * the comparison: the store is walked back through the retention window and the newest edition that
 * actually exists is used. Its date travels with the baseline, which is what lets a row state the
 * real span instead of calling every move a day move.
 */
export async function previousEditionBefore(
  store: Readonly<{ list: (from: string, to: string, locale: DailyBriefingLocale) => Promise<readonly DailyBriefingStoredEdition[]> }>,
  date: string,
  locale: DailyBriefingLocale
): Promise<DailyBriefingStoredEdition | undefined> {
  const start = Date.parse(`${date}T00:00:00.000Z`) - 14 * 24 * 60 * 60 * 1_000
  const from = Number.isFinite(start) ? new Date(start).toISOString().slice(0, 10) : date
  const listed = await store.list(from, previousDate(date), locale).catch(() => [])
  return listed.at(-1)
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}
