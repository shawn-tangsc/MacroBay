import type { DailyBriefSessionLinkStore } from './dailyBriefSessionLinks'

export type DailyBriefSessionPruneResult = Readonly<{ removed: number; failed: boolean }>

/** Delete only daily-brief sessions older than the 14-day window; caller owns the link store. */
export async function pruneDailyBriefSessions(input: Readonly<{
  links: DailyBriefSessionLinkStore
  deleteSessions: (sessionIds: string[]) => Promise<unknown>
  today: string
  retentionDays?: number
}>): Promise<DailyBriefSessionPruneResult> {
  const days = input.retentionDays ?? 14
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
