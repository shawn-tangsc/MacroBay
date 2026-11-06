import type { JobRuntime } from '@platform/jobs'

import { DEFAULT_PERIOD_ID, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  createDefaultDailyBriefingPeriod,
  generationTimeZoneIssue,
  type DailyBriefingPeriod
} from '../daily-briefing/dailyBriefingGenerationSettings'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import {
  syncDailyBriefingSchedules,
  type DailyBriefingScheduleSync
} from './dailyBriefingSchedules'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

/** A definition always carries its period; anything else means the only period there used to be. */
function periodIdOf(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const periodId = (payload as { periodId?: unknown }).periodId
    if (typeof periodId === 'string' && periodId) return periodId
  }
  return DEFAULT_PERIOD_ID
}

/**
 * One handler for every period's definition.
 *
 * The definition's payload says which period fired, and the handler re-reads the periods before
 * spending anything: a run queued for a period that has since been removed, or whose zone is now
 * unreadable, returns without fetching. The generation itself uses the period's own time, window
 * and zone, so two definitions can never write one period's edition under the other's name.
 */
export function registerDailyBriefingJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    service: Pick<DailyBriefingService, 'getToday'>
    getLocale: () => Promise<DailyBriefingLocale>
    /** 主进程唯一的读者时区来源；只在期没有自己的时区时决定它的钟。 */
    timeZone: () => string
    /**
     * The saved periods, read at registration and again at every run.
     *
     * 带 `language`：一期配什么语言，就写什么语言的版次（用户 2026-11-06 报的 20:00 英文期跑出中文）。
     * 旧数据没有这个字段时回落到界面语言，行为与此前一致。
     */
    getPeriods: () => Promise<readonly (DailyBriefingPeriod & Readonly<{ language?: DailyBriefingLocale }>)[]>
    /** 期自己的时区读不出来、这一期因此不排期时调用；只在真的暂停了时才调。 */
    onPaused?: (paused: readonly string[]) => void
  }>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_DAILY_BRIEFING_JOB, async (payload) => {
    const periodId = periodIdOf(payload)
    const period = (await deps.getPeriods()).find((candidate) => candidate.id === periodId)
    if (!period) return
    if (generationTimeZoneIssue(period.generationTimeZone)) return
    // 这一期自己的语言优先：定时触发的是"20:00 那一期（英文）"，不是"界面现在是什么语言"。
    const locale = period.language ?? await deps.getLocale()
    const timeZone = period.generationTimeZone ?? deps.timeZone()
    const result = await deps.service.getToday({
      locale,
      timeZone,
      periodId,
      // The scheduler fired this run: that is the trigger the edition must record.
      periodKind: 'scheduled',
      runTrigger: 'scheduled',
      generation: { generationTime: period.generationTime, windowHours: period.windowHours }
    })
    if (result.state !== 'available') throw new Error(`daily-briefing-generation-${result.failureCode}`)
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  // The settings file is read asynchronously; until it answers, the fallback below is what a fresh
  // install gets. The fallback registers the period id too, so a fresh install has the same id
  // shape the saved periods produce.
  // 注册时**必须**带上读者当前时区：期里没写时区时，排期就按读者的钟走（用户 2026-11-06：
  // "我配的是每天 7 点，换时区就该在新时区的 7 点跑"）。以前这里传 undefined，被 `?? 'UTC'`
  // 悄悄接住，于是 07:00 排成了 UTC 07:00 = 本地 15:00。
  void deps.getPeriods()
    .then((periods) => applyDailyBriefingSchedules(jobRuntime, periods, deps.timeZone(), deps.onPaused))
    .catch(() => applyDailyBriefingSchedules(jobRuntime, [createDefaultDailyBriefingPeriod()], deps.timeZone(), deps.onPaused))
}

/** Re-register the definitions that changed and remove the ones whose period is gone. */
export function applyDailyBriefingSchedules(
  jobRuntime: Pick<JobRuntime, 'setSchedule' | 'removeSchedule' | 'listSchedules'>,
  periods: readonly DailyBriefingPeriod[],
  /** 读者当前时区；**不许有 'UTC' 这种静默默认**——那会把"每天 7 点"排成 UTC 7 点。 */
  readerTimeZone: string,
  onPaused?: (paused: readonly string[]) => void
): DailyBriefingScheduleSync {
  const sync = syncDailyBriefingSchedules(jobRuntime, periods, readerTimeZone, generationTimeZoneIssue)
  // 暂停是读者会吃亏的状态（自动生成静默停了），所以在判决落地的这一处报出去，不在读路径上报。
  if (sync.paused.length > 0) onPaused?.(sync.paused)
  return sync
}
