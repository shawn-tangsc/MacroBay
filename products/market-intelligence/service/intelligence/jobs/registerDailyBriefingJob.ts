import type { JobRuntime, ScheduledJobDefinition } from '@platform/jobs'

import { dailyBriefingGenerationPolicy, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingGenerationCronExpression, isDailyBriefingTimeZoneId } from '../daily-briefing/dailyBriefingGenerationSettings'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

export const dailyBriefingJobPolicy = Object.freeze({
  productId: 'market-intelligence',
  title: 'Generate the daily briefing',
  /** Fallback when no settings reader is wired. The reader setting defaults to the same time. */
  generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime
})

/** The one trigger definition, so registration and a settings change build it the same way. */
export function dailyBriefingScheduleDefinition(
  input: Readonly<{ timeZone: string; generationTime: string }>
): ScheduledJobDefinition {
  return {
    id: INTELLIGENCE_DAILY_BRIEFING_JOB,
    owner: 'product',
    productId: dailyBriefingJobPolicy.productId,
    handlerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    title: dailyBriefingJobPolicy.title,
    audience: 'user' as const,
    trigger: {
      kind: 'cron',
      expression: dailyBriefingGenerationCronExpression({ generationTime: input.generationTime }),
      timezone: input.timeZone
    },
    payload: {}
  }
}

/** Re-registers the same definition id; the runtime replaces the previous timer. */
export function scheduleDailyBriefingJob(
  jobRuntime: Pick<JobRuntime, 'setSchedule'>,
  input: Readonly<{ timeZone: string; generationTime: string }>
): void {
  jobRuntime.setSchedule(dailyBriefingScheduleDefinition(input))
}

/**
 * The schedule a saved setting means, in one place: the stored zone wins over the reader zone whenever
 * the setting carries one, because the cron and the edition cutoff must be the same clock.
 */
export function briefingScheduleFrom(
  settings: Readonly<{ generationTime: string; generationTimeZone?: string }>,
  readerTimeZone: string
): Readonly<{ timeZone: string; generationTime: string }> {
  return { timeZone: settings.generationTimeZone ?? readerTimeZone, generationTime: settings.generationTime }
}

/** The saved settings as the scheduler reads them, with an unreadable zone carried, not repaired. */
export function briefingScheduleInput(view: Readonly<{ generationTime: string; generationTimeZone: string | null; generationTimeZoneInvalid: string | null }>): Readonly<{ generationTime: string; generationTimeZone?: string; generationTimeZoneInvalid?: string }> {
  return {
    generationTime: view.generationTime,
    ...(view.generationTimeZone ? { generationTimeZone: view.generationTimeZone } : {}),
    ...(view.generationTimeZoneInvalid ? { generationTimeZoneInvalid: view.generationTimeZoneInvalid } : {})
  }
}

/**
 * One clock job. It does not own a second queue or a timer: the platform scheduler calls the same
 * service the reader calls, and `getToday` coalesces with an open that happened first. The cron is
 * the reader's generation time, which is also the edition cutoff. A day that already exists is a
 * successful no-op; a failed source read throws so the run is visible, and the service has written
 * nothing.
 *
 * The service itself runs the deterministic core-fact ensure after building the packet/document
 * and before the editorial turn (see `createDailyBriefingService`), so this job needs no second
 * fetch step: it only asks for the edition, and the Agent backfill protocol remains the fallback
 * for whatever gap the deterministic pass could not fill.
 */
export function registerDailyBriefingJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    service: Pick<DailyBriefingService, 'getToday'>
    getLocale: () => Promise<DailyBriefingLocale>
    /** 主进程唯一的读者时区来源；每次生成都重新取，注册时的值只用于排期。 */
    timeZone: () => string
    /**
     * Read once at registration; a save re-registers through `scheduleDailyBriefingJob`. The stored
     * zone wins over `timeZone` whenever the setting carries one: the cron and the edition cutoff
     * must be the same clock, and only the stored value can say which clock that is.
     */
    getSchedule?: () => Promise<Readonly<{ generationTime: string; generationTimeZone?: string; generationTimeZoneInvalid?: string }>>
  }>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_DAILY_BRIEFING_JOB, async () => {
    const locale = await deps.getLocale()
    const timeZone = deps.timeZone()
    const result = await deps.service.getToday({ locale, timeZone })
    if (result.state !== 'available') throw new Error(`daily-briefing-generation-${result.failureCode}`)
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  const readerTimeZone = deps.timeZone()
  if (!deps.getSchedule) {
    scheduleDailyBriefingJob(jobRuntime, { timeZone: readerTimeZone, generationTime: dailyBriefingJobPolicy.generationTime })
    return
  }
  // The settings file is read asynchronously; until it answers the job simply has no schedule,
  // which is the same state as a fresh install before the first read. The read is the migration
  // point: by the time the first cron is built, the setting already carries its zone.
  void deps.getSchedule()
    .then((schedule) => {
      // A saved zone that cannot be read pauses the automatic run instead of guessing one: the
      // panel already tells the reader which value is wrong, and a guessed clock would move the
      // edition without saying so.
      if (schedule.generationTimeZoneInvalid) return
      scheduleDailyBriefingJob(jobRuntime, {
        timeZone: schedule.generationTimeZone && isDailyBriefingTimeZoneId(schedule.generationTimeZone)
          ? schedule.generationTimeZone
          : readerTimeZone,
        generationTime: schedule.generationTime
      })
    })
    .catch(() => scheduleDailyBriefingJob(jobRuntime, { timeZone: readerTimeZone, generationTime: dailyBriefingJobPolicy.generationTime }))
}
