import type { JobRuntime } from '@platform/jobs'
import type { DailyBriefSessionLinkStore } from '../daily-briefing/dailyBriefSessionLinks'
import { pruneDailyBriefSessions } from '../daily-briefing/dailyBriefSessionRetention'

export const dailyBriefSessionRetentionJobId = 'intelligence.dailyBriefingPruneSessions'

export function registerDailyBriefSessionRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    links: DailyBriefSessionLinkStore
    deleteSessions: (sessionIds: string[]) => Promise<unknown>
    today: () => string
    timeZone: () => string
  }>
): void {
  jobRuntime.registerHandler(dailyBriefSessionRetentionJobId, async () => {
    const result = await pruneDailyBriefSessions({ links: deps.links, deleteSessions: deps.deleteSessions, today: deps.today() })
    if (result.failed) throw new Error('daily-brief-session-retention-failed')
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  jobRuntime.setSchedule({
    id: dailyBriefSessionRetentionJobId,
    owner: 'product',
    productId: 'market-intelligence',
    handlerId: dailyBriefSessionRetentionJobId,
    title: 'Prune daily brief sessions',
    trigger: { kind: 'cron', expression: '10 8 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}
