import type { JobRuntime } from '@platform/jobs'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingGenerationSettingsService } from './dailyBriefingGenerationSettingsService'
import type { DailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import type { DailyBriefAttemptCleanup } from './dailyBriefSessionRetention'
import type { DailyBriefingService } from './dailyBriefingService'
import { notifyDailyBriefing, type DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import { localDate } from './dailyBriefingWindow'
import { registerDailyBriefSessionRetentionJob } from '../jobs/registerDailyBriefSessionRetentionJob'
import { applyDailyBriefingSchedules, registerDailyBriefingJob } from '../jobs/registerDailyBriefingJob'

/**
 * Everything the daily briefing registers with the job runtime, in one place.
 *
 * The generation definitions are one per period and are rebuilt from the saved periods, never
 * guessed from a toggle; the session-retention cleanup is registered beside them because its
 * "today" must be the same local day the reader sees. Returns the display-zone hook: a timezone
 * change moves what a zone-less period means, so the definitions are rebuilt — nothing is written.
 */
export function wireDailyBriefingJobs(deps: Readonly<{
  jobRuntime: JobRuntime
  service: Pick<DailyBriefingService, 'getToday'>
  getLocale: () => Promise<DailyBriefingLocale>
  timeZone: () => string
  periods: Pick<DailyBriefingGenerationSettingsService, 'getPeriods'>
  links: DailyBriefSessionLinkStore
  deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
  /** The attempt store's tombstone writer; absent in a build that has no attempt table. */
  markAttemptCleaned?: DailyBriefAttemptCleanup
  /** 通知端口；缺省表示未装配运行时，排期照常、只是不报「时区无效」。 */
  submitNotification?: DailyBriefingNoticeSubmit
}>): (timeZone: string) => Promise<void> {
  // 一期因为时区读不出来被暂停时，读者不会自己发现（自动生成静默停了）。一天一条由去重键判。
  const onPaused = (): void => {
    void notifyDailyBriefing(deps.submitNotification, { kind: 'timezone-invalid', date: new Date().toISOString().slice(0, 10) }, new Date().toISOString())
  }
  registerDailyBriefingJob(deps.jobRuntime, {
    service: deps.service,
    getLocale: deps.getLocale,
    timeZone: deps.timeZone,
    getPeriods: () => deps.periods.getPeriods(),
    onPaused
  })
  if (deps.deleteAgentSessions) {
    const deleteSessions = deps.deleteAgentSessions
    registerDailyBriefSessionRetentionJob(deps.jobRuntime, {
      links: deps.links,
      deleteSessions: (sessionIds) => deleteSessions(sessionIds),
      ...(deps.markAttemptCleaned ? { markAttemptCleaned: deps.markAttemptCleaned } : {}),
      today: () => {
        const zone = deps.timeZone()
        return localDate(new Date().toISOString(), zone) ?? new Date().toISOString().slice(0, 10)
      },
      timeZone: deps.timeZone
    })
  }
  return async (timeZone) => {
    applyDailyBriefingSchedules(deps.jobRuntime, await deps.periods.getPeriods(), timeZone, onPaused)
  }
}
