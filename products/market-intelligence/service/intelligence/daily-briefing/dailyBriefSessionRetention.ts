import type { DailyBriefSessionLinkStore } from './dailyBriefSessionLinks'

export type DailyBriefSessionPruneResult = Readonly<{ removed: number; failed: boolean }>

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

/** Delete only daily-brief sessions older than the session window; caller owns the link store. */
export async function pruneDailyBriefSessions(input: Readonly<{
  links: DailyBriefSessionLinkStore
  deleteSessions: (sessionIds: string[]) => Promise<unknown>
  today: string
  retentionDays?: number
}>): Promise<DailyBriefSessionPruneResult> {
  const days = input.retentionDays ?? dailyBriefSessionRetentionPolicy.days
  const cutoff = new Date(Date.parse(`${input.today}T00:00:00.000Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const old = await input.links.listBefore(cutoff)
  if (old.length === 0) return { removed: 0, failed: false }
  const ids = old.map((link) => link.sessionId)
  try {
    await input.deleteSessions(ids)
    await input.links.remove(ids)
    return { removed: ids.length, failed: false }
  } catch {
    // Keep links for the next run; do not delete a link whose platform session may still exist.
    return { removed: 0, failed: true }
  }
}
