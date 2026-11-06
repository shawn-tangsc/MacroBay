import type { JobRuntime } from '@platform/jobs'
import type { DailyBriefSessionLinkStore } from '../daily-briefing/dailyBriefSessionLinks'
import { pruneDailyBriefSessions, type DailyBriefAttemptCleanup } from '../daily-briefing/dailyBriefSessionRetention'

export const dailyBriefSessionRetentionJobId = 'intelligence.dailyBriefingPruneSessions'

export function registerDailyBriefSessionRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    links: DailyBriefSessionLinkStore
    deleteSessions: (sessionIds: string[]) => Promise<unknown>
    /** The attempt store's tombstone writer; without it the links are removed with no tombstone. */
    markAttemptCleaned?: DailyBriefAttemptCleanup
    today: () => string
    timeZone: () => string
  }>
): void {
  jobRuntime.registerHandler(dailyBriefSessionRetentionJobId, async () => {
    const result = await pruneDailyBriefSessions({
      links: deps.links,
      deleteSessions: deps.deleteSessions,
      ...(deps.markAttemptCleaned ? { markAttemptCleaned: deps.markAttemptCleaned } : {}),
      today: deps.today()
    })
    if (result.failed) throw new Error('daily-brief-session-retention-failed')
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  jobRuntime.setSchedule({
    id: dailyBriefSessionRetentionJobId,
    owner: 'product',
    productId: 'market-intelligence',
    handlerId: dailyBriefSessionRetentionJobId,
    title: 'Prune daily brief sessions',
    audience: 'user' as const,
    trigger: { kind: 'cron', expression: '10 8 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}
