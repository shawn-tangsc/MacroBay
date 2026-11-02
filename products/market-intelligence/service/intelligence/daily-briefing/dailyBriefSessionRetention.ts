import type { DailyBriefSessionLinkStore } from './dailyBriefSessionLinks'

export type DailyBriefSessionPruneResult = Readonly<{
  /** Links removed after their platform sessions were deleted and their attempts were marked. */
  removed: number
  /** Attempt rows that took the tombstone. A row already pruned is not an error and is not counted. */
  tombstoned: number
  /** True when a tombstone could not be written yet and the links were kept for the next run. */
  deferred: boolean
  failed: boolean
}>

/**
 * Writes the tombstone onto the attempt row: trace emptied, `cleaned_at` set, row kept. Owned by the
 * attempt store. The three answers are different facts and must not be collapsed:
 *
 * - a count: rows updated. `0` means the row is already gone (pruned on day fourteen) — done;
 * - `null`: the store cannot write a tombstone yet, because the database is still on the old shape
 *   whose `trace_json` is `NOT NULL`. Nothing happened to the row, so the caller must keep the link
 *   and retry: removing it would lose the tombstone for good once the upgrade lands;
 * - a rejection: the write itself failed. Retry as well, for the same reason.
 */
export type DailyBriefAttemptCleanup = (input: Readonly<{
  editionDate: string
  periodId: string
  locale: 'zh-CN' | 'en-US'
  attemptNo?: number
  cleanedAt: string
}>) => Promise<number | null>

export const dailyBriefSessionRetentionPolicy = Object.freeze({
  /**
   * Shorter than the edition window on purpose. A writing session is a runtime resource; the
   * attempt it belongs to is the record. Cleaning the session first is what leaves the attempt row
   * standing with its trace emptied and `cleaned_at` set, so the history rail can still say
   * "that attempt was cleaned up" instead of going blank. With both windows at fourteen days the
   * tombstone would be written onto a row deleted in the same batch, and no one could ever see it.
   */
  days: 7
})

/**
 * Cleans the sessions that fell out of the session window, in one order that is not interchangeable:
 *
 * 1. delete the platform sessions (a failure here leaves every link in place, so the next run retries);
 * 2. write the tombstone onto each attempt row (a row that is already gone counts as done);
 * 3. remove the link rows last — they are the retry anchor, so removing them before step 2 would
 *    make a failed tombstone unrecoverable while the session is already gone.
 *
 * The two failures are handled separately on purpose: "the target row no longer exists" and "the
 * deletion failed" are different facts, and one `catch` around both would report them the same way.
 */
export async function pruneDailyBriefSessions(input: Readonly<{
  links: DailyBriefSessionLinkStore
  deleteSessions: (sessionIds: string[]) => Promise<unknown>
  markAttemptCleaned?: DailyBriefAttemptCleanup
  today: string
  retentionDays?: number
  /** The tombstone timestamp; injected so a test can read the value it wrote. */
  now?: () => string
}>): Promise<DailyBriefSessionPruneResult> {
  const days = input.retentionDays ?? dailyBriefSessionRetentionPolicy.days
  const cutoff = new Date(Date.parse(`${input.today}T00:00:00.000Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const old = await input.links.listBefore(cutoff)
  if (old.length === 0) return { removed: 0, tombstoned: 0, deferred: false, failed: false }
  const ids = old.map((link) => link.sessionId)

  try {
    await input.deleteSessions(ids)
  } catch {
    // Keep the links: the platform session may still exist, and a link is how the next run finds it.
    return { removed: 0, tombstoned: 0, deferred: false, failed: true }
  }

  let tombstoned = 0
  if (input.markAttemptCleaned) {
    const cleanedAt = (input.now ?? (() => new Date().toISOString()))()
    for (const link of old) {
      try {
        const written = await input.markAttemptCleaned({
          editionDate: link.editionDate,
          periodId: link.periodId,
          locale: link.locale,
          ...(link.attemptNo === undefined ? {} : { attemptNo: link.attemptNo }),
          cleanedAt
        })
        // `null`: the store cannot write yet (old table shape). Keep the links and retry later;
        // this is not a failure of the run, and it must not be read as "the row is gone".
        if (written === null) return { removed: 0, tombstoned, deferred: true, failed: false }
        tombstoned += written
      } catch {
        // The sessions are already gone, so the tombstone is the only remaining record; the links
        // stay as the retry anchor and the next run writes it.
        return { removed: 0, tombstoned, deferred: false, failed: true }
      }
    }
  }

  try {
    await input.links.remove(ids)
  } catch {
    return { removed: 0, tombstoned, deferred: false, failed: true }
  }
  return { removed: ids.length, tombstoned, deferred: false, failed: false }
}
