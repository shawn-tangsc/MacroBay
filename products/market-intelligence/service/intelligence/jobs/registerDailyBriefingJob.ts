import type { JobDefinition, JobRuntime } from '@platform/jobs'

import { dailyBriefingGenerationPolicy, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingGenerationCronExpression } from '../daily-briefing/dailyBriefingGenerationSettings'
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
): JobDefinition {
  return {
    id: INTELLIGENCE_DAILY_BRIEFING_JOB,
    owner: 'product',
    productId: dailyBriefingJobPolicy.productId,
    handlerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    title: dailyBriefingJobPolicy.title,
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
 * One clock job. It does not own a second queue or a timer: the platform scheduler calls the same
 * service the reader calls, and `getToday` coalesces with an open that happened first. The cron is
 * the reader's generation time, which is also the edition cutoff. A day that already exists is a
 * successful no-op; a failed source read throws so the run is visible, and the service has written
 * nothing.
 */
export function registerDailyBriefingJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    service: Pick<DailyBriefingService, 'getToday'>
    getLocale: () => Promise<DailyBriefingLocale>
    timeZone?: () => string
    /** Read once at registration; a save re-registers through `scheduleDailyBriefingJob`. */
    getGenerationTime?: () => Promise<string>
  }>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_DAILY_BRIEFING_JOB, async () => {
    const locale = await deps.getLocale()
    const timeZone = deps.timeZone?.() ?? systemTimeZone()
    const result = await deps.service.getToday({ locale, timeZone })
    if (result.state !== 'available') throw new Error(`daily-briefing-generation-${result.failureCode}`)
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  const timeZone = deps.timeZone?.() ?? systemTimeZone()
  if (!deps.getGenerationTime) {
    scheduleDailyBriefingJob(jobRuntime, { timeZone, generationTime: dailyBriefingJobPolicy.generationTime })
    return
  }
  // The settings file is read asynchronously; until it answers the job simply has no schedule,
  // which is the same state as a fresh install before the first read.
  void deps.getGenerationTime()
    .then((generationTime) => scheduleDailyBriefingJob(jobRuntime, { timeZone, generationTime }))
    .catch(() => scheduleDailyBriefingJob(jobRuntime, { timeZone, generationTime: dailyBriefingJobPolicy.generationTime }))
}

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
