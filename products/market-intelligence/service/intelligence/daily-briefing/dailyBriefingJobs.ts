import type { JobRuntime } from '@platform/jobs'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingGenerationSettingsService } from './dailyBriefingGenerationSettingsService'
import type { DailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import type { DailyBriefAttemptCleanup } from './dailyBriefSessionRetention'
import type { DailyBriefingService } from './dailyBriefingService'
import { catchUpMissedDailyBriefings } from './dailyBriefingCatchUp'
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
  service: Pick<DailyBriefingService, 'getToday' | 'listAttempts' | 'wasEditionDeleted'>
  /** 补跑时用的时钟；测试可注入。缺省取真实时间。 */
  now?: () => string
  getLocale: () => Promise<DailyBriefingLocale>
  timeZone: () => string
  periods: Pick<DailyBriefingGenerationSettingsService, 'getPeriods'>
  /** 平台的落盘日志（app.log）。补跑是后台事实，必须留一条事后查得到的记录。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
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
  /**
   * 今天已经过了点、却一次都没跑过的那一期，现在补跑一次（用户 2026-11-06）。
   *
   * 启动与重排时各看一次：定时器只会往前排，错过了的那一次没人替它补——今天 07:00 那期就是这么
   * 一整天没人跑。补跑走**同一个入口**，只是把触发记成 `catch-up`；跑过的证据是 attempt 行，
   * 所以重复调用最多并进正在跑的那一次，不会再补第二遍。
   */
  const catchUp = (): void => {
    // 读者时区读不出来（装配缺这一钩子）也不许把启动打挂：记一条错误、这一轮补跑跳过。
    // 生产一定接了这个钩子；这里守的是装配不全的构建与用例。
    let timeZone: string
    try {
      timeZone = deps.timeZone()
    } catch (error) {
      deps.log?.('error', 'briefing.catchup.error', { error: error instanceof Error ? error.message : String(error) })
      return
    }
    void catchUpMissedDailyBriefings({
      getPeriods: () => deps.periods.getPeriods(),
      getLocale: deps.getLocale,
      readerTimeZone: () => timeZone,
      now: deps.now ?? (() => new Date().toISOString()),
      hasEdition: async (input) => (await deps.service.getToday({ locale: input.locale, timeZone, periodId: input.periodId, generate: false })).state === 'available',
      // 读不到尝试记录就当作"跑过"：宁可少补一次，也不在同一刻补两遍。
      attemptCount: async (input) => {
        const listed = await deps.service.listAttempts(input)
        return listed.state === 'available' ? listed.attempts.length : 1
      },
      wasDeleted: (input) => deps.service.wasEditionDeleted(input),
      run: async (input) => deps.service.getToday({
        locale: input.locale,
        timeZone: input.timeZone,
        periodId: input.periodId,
        periodKind: 'scheduled',
        runTrigger: 'catch-up',
        generation: { generationTime: input.generationTime, windowHours: input.windowHours }
      })
    }).then((outcome) => {
      // 留痕走平台日志（app.log），不是 console：console 只落在跑 dev 的那个终端里，事后查不到。
      // 补了谁、跳过了谁、谁补了没成，三样都要有出口——否则"没跑成"和"没跑"看起来一样。
      const fields = { at: deps.now?.() ?? new Date().toISOString(), timeZone, ran: outcome.ran, skipped: outcome.skipped, failed: outcome.failed }
      if (outcome.failed.length > 0) deps.log?.('error', 'briefing.catchup.failed', fields)
      else deps.log?.('info', 'briefing.catchup', fields)
    }).catch((error: unknown) => {
      deps.log?.('error', 'briefing.catchup.error', {
        at: deps.now?.() ?? new Date().toISOString(),
        timeZone,
        error: error instanceof Error ? error.message : String(error)
      })
    })
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
  // 启动即看一次：昨天到今天之间错过的，就在这里补。
  catchUp()
  return async (timeZone) => {
    applyDailyBriefingSchedules(deps.jobRuntime, await deps.periods.getPeriods(), timeZone, onPaused)
    // 重排之后再看一次：换时区可能把某一期推进"今天已过点"的状态。
    catchUp()
  }
}
