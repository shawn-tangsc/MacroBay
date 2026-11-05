import { DEFAULT_PERIOD_ID, type DailyBriefingLocale, type DailyBriefingRunTrigger, type DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, type DailyBriefingZoneSource } from './dailyBriefingWindow'
import type { DailyBriefingRunCoalescer } from './dailyBriefingRunCoalescer'
import type { DailyBriefingTodayResult } from './dailyBriefingService'

export type DailyBriefingRegenerateInput = Readonly<{
  locale: DailyBriefingLocale
  timeZone: string
  periodId?: string
  generation?: Readonly<{ asOf: string; windowHours?: DailyBriefingWindowHours }>
}>

/**
 * The manual/re-run path, kept out of the service so the service stays inside its size baseline.
 *
 * Called only by the service, with its own clock, schedule reader and single-flight group: the same
 * edition still joins the run already working on it, and a chosen cutoff is only ever this run's
 * nominal moment — it never writes back to a period configuration.
 */
export function createDailyBriefingRegenerate(deps: Readonly<{
  now: () => string
  readGeneration: () => Promise<DailyBriefingGenerationSettings>
  runs: Pick<DailyBriefingRunCoalescer<DailyBriefingTodayResult>, 'join' | 'key'>
  resolve: (input: Readonly<{
    asOf: string
    date: string
    periodId: string
    locale: DailyBriefingLocale
    timeZone: string
    windowHours: number
    periodKind?: 'manual'
    periodTime?: string
    runTrigger?: DailyBriefingRunTrigger
  }>, force: boolean) => Promise<DailyBriefingTodayResult>
  withZone: (result: DailyBriefingTodayResult, zoneSource: DailyBriefingZoneSource) => DailyBriefingTodayResult
}>): (input: DailyBriefingRegenerateInput) => Promise<DailyBriefingTodayResult> {
  return async function regenerate(input) {
    // The moment chosen in the dialog is this run's nominal cutoff; "now" is one of its values.
    const chosen = input.generation?.asOf
    const window = chosen === undefined
      ? briefingWindow(deps.now(), input.timeZone, await deps.readGeneration())
      : briefingWindow(chosen, input.timeZone, { ...(await deps.readGeneration()), ...(input.generation?.windowHours === undefined ? {} : { windowHours: input.generation.windowHours }) })
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    const periodId = input.periodId ?? DEFAULT_PERIOD_ID
    return deps.withZone(await deps.runs.join(deps.runs.key(window.date, periodId, input.locale), async () =>
      deps.resolve({
        asOf: window.windowEnd, date: window.date, periodId, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours,
        runTrigger: 'manual',
        // Three values or none: the row's "cutoff · actual" pair and "current" both need them.
        ...(input.generation === undefined ? {} : { periodKind: 'manual' as const, periodTime: input.generation.asOf })
      }, true)), window.zoneSource)
  }
}
