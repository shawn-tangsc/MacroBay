import type { JobRuntime } from '@platform/jobs'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

export const dailyBriefingJobPolicy = Object.freeze({
  productId: 'market-intelligence',
  /** Local morning edition. The service skips when the day is already generated. */
  cronExpression: '5 8 * * *',
  title: 'Generate the daily briefing'
})

/**
 * One clock job. It does not own a second queue or a timer: the platform scheduler calls the same
 * service the reader calls, and `getToday` coalesces with an open that happened first. A day that
 * already exists is a successful no-op; a failed source read throws so the run is visible, and the
 * service has written nothing.
 */
export function registerDailyBriefingJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    service: Pick<DailyBriefingService, 'getToday'>
    getLocale: () => Promise<DailyBriefingLocale>
    timeZone?: () => string
  }>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_DAILY_BRIEFING_JOB, async () => {
    const locale = await deps.getLocale()
    const timeZone = deps.timeZone?.() ?? systemTimeZone()
    const result = await deps.service.getToday({ locale, timeZone })
    if (result.state !== 'available') throw new Error(`daily-briefing-generation-${result.failureCode}`)
  })
  if (typeof jobRuntime.setSchedule !== 'function') return
  jobRuntime.setSchedule({
    id: INTELLIGENCE_DAILY_BRIEFING_JOB,
    owner: 'product',
    productId: dailyBriefingJobPolicy.productId,
    handlerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    title: dailyBriefingJobPolicy.title,
    trigger: { kind: 'cron', expression: dailyBriefingJobPolicy.cronExpression, timezone: deps.timeZone?.() ?? systemTimeZone() },
    payload: {}
  })
}

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
