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
    /** 平台的落盘日志；装配缺时区钩子时留一条指名道姓的错误。 */
    log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  }>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_DAILY_BRIEFING_JOB, async (payload, context) => {
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
      // job 被停（应用正在退出）时这个信号先 abort：自动重试据此不再起第二次。
      signal: context.signal,
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
  // 时区在**调用期**读，而且只读一次、读不到就明确降级：以前把 `deps.timeZone()` 放在 `.then`
  // 和 `.catch` 两处，钩子缺失时 `.then` 里抛、`.catch` 里又抛一次——第二个抛就成了没人接的
  // 未捕获拒绝。注册阶段拿不到时区是可诊断的装配问题，不是「排到 UTC 7 点」这种静默错误。
  const readerTimeZone = readReaderTimeZoneForSchedule(deps)
  if (readerTimeZone === undefined) return
  void deps.getPeriods()
    .then(periods => applyDailyBriefingSchedules(jobRuntime, periods, readerTimeZone, deps.onPaused))
    .catch(() => applyDailyBriefingSchedules(jobRuntime, [createDefaultDailyBriefingPeriod()], readerTimeZone, deps.onPaused))
    // 排期同步本身失败也不许变成未捕获拒绝：它已经在 store 里报过，这里只落一条日志。
    .catch(() => undefined)
}

/** Re-register the definitions that changed and remove the ones whose period is gone. */
/**
 * 注册期读一次读者时区；读不到就报一条明确的错误并放弃这次注册。
 *
 * 返回 `undefined` 表示「这一轮不排」——**不是**退回 UTC：把 07:00 排成 UTC 07:00（本地 15:00）
 * 比不排更难发现。装配缺钩子在真实构建里不该出现，但出现时必须留得下一条日志。
 */
function readReaderTimeZoneForSchedule(deps: Readonly<{
  timeZone: () => string
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}>): string | undefined {
  try {
    return deps.timeZone()
  } catch (error) {
    deps.log?.('error', 'briefing.schedule.time-zone-missing', {
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

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
