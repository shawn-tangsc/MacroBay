import type { JobRuntime, ScheduledJobDefinition } from '@platform/jobs'

import {
  dailyBriefingGenerationCronExpression,
  type DailyBriefingPeriod
} from '../daily-briefing/dailyBriefingGenerationSettings'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

/** Which period a definition fires, as its payload: the handler reads it, never guesses. */
export type DailyBriefingSchedulePayload = Readonly<{ periodId: string }>

export type DailyBriefingScheduleSync = Readonly<{
  /** Period ids that now have a definition. */
  scheduled: readonly string[]
  /** Period ids whose definition was removed because the period is gone. */
  removed: readonly string[]
  /** Period ids left without a definition because their zone cannot be read. */
  paused: readonly string[]
}>

const dailyBriefingSchedulePolicy = Object.freeze({
  productId: 'market-intelligence',
  title: 'Generate the daily briefing'
})

/** One period, one definition: the product's base id plus the period id. */
export function dailyBriefingPeriodDefinitionId(periodId: string): string {
  return `${INTELLIGENCE_DAILY_BRIEFING_JOB}.${periodId}`
}

/**
 * The definition one period means.
 *
 * `handlerId` stays the base id on purpose: run history and the job copy are keyed by handler id,
 * so a per-period definition id must not turn every past run into an unknown task. The trigger
 * carries the period's own zone when it has a usable one; otherwise the reader's zone, which is
 * what a period with no zone means.
 */
export function dailyBriefingScheduleDefinition(
  period: DailyBriefingPeriod,
  readerTimeZone: string
): ScheduledJobDefinition<DailyBriefingSchedulePayload> {
  return {
    id: dailyBriefingPeriodDefinitionId(period.id),
    owner: 'product',
    productId: dailyBriefingSchedulePolicy.productId,
    handlerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
    title: period.name ? `${dailyBriefingSchedulePolicy.title} · ${period.name}` : `${dailyBriefingSchedulePolicy.title} · ${period.id}`,
    audience: 'user',
    trigger: {
      kind: 'cron',
      expression: dailyBriefingGenerationCronExpression({ generationTime: period.generationTime }),
      timezone: period.generationTimeZone ?? readerTimeZone
    },
    payload: { periodId: period.id }
  }
}

/**
 * Make the registered definitions match the saved periods, period by period.
 *
 * This is the one place that diffs. A period that is new or whose time moved is (re)registered
 * under its own id — `setSchedule` replaces, so a moved time reuses the id; a period that is gone
 * has its definition removed, because "off" has to mean no definition rather than a handler that
 * returns early; a period whose zone cannot be read is removed and reported as paused, and that
 * judgement is made **inside the loop**: one bad period must not silence the others.
 *
 * Idempotent: running it twice with the same periods removes and adds nothing.
 */
export function syncDailyBriefingSchedules(
  jobRuntime: Pick<JobRuntime, 'setSchedule' | 'removeSchedule' | 'listSchedules'>,
  periods: readonly DailyBriefingPeriod[],
  readerTimeZone: string,
  timeZoneIssue: (generationTimeZone: string | undefined) => 'unparseable' | undefined
): DailyBriefingScheduleSync {
  const desired = new Map<string, ScheduledJobDefinition<DailyBriefingSchedulePayload>>()
  const paused: string[] = []
  for (const period of periods) {
    if (!period.id) continue
    if (timeZoneIssue(period.generationTimeZone)) {
      // Per period, not per sync: a mistyped zone pauses its own run and leaves the rest alone.
      paused.push(period.id)
      continue
    }
    desired.set(dailyBriefingPeriodDefinitionId(period.id), dailyBriefingScheduleDefinition(period, readerTimeZone))
  }

  const prefix = `${INTELLIGENCE_DAILY_BRIEFING_JOB}.`
  const removed: string[] = []
  for (const definition of jobRuntime.listSchedules()) {
    if (!definition.id.startsWith(prefix) || desired.has(definition.id)) continue
    jobRuntime.removeSchedule(definition.id)
    removed.push(definition.id.slice(prefix.length))
  }
  for (const definition of desired.values()) jobRuntime.setSchedule(definition)

  return { scheduled: [...desired.values()].map((definition) => definition.payload.periodId), removed, paused }
}
