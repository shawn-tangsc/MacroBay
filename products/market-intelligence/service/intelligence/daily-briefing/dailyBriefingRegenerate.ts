import { DEFAULT_PERIOD_ID, type DailyBriefingLocale, type DailyBriefingRunTrigger, type DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, briefingWindowAtCutoff, type DailyBriefingZoneSource } from './dailyBriefingWindow'
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
  /**
   * 期配置列表：按 `periodId` 取**这一期自己**的时刻、窗口与语言。
   *
   * 用户 2026-11-06 报的"20:00 那期的身份、07:00 的内容"就是这里来的：以前不带期号，窗口一律取
   * 期列表第一项（默认 07:00），语言取界面语言——三个来源拼一版。现在三样都从这一期取。
   */
  readPeriods?: () => Promise<readonly Readonly<{ id: string; generationTime: string; windowHours: 12 | 24 | 48; language?: DailyBriefingLocale }>[]>
  resolve: (input: Readonly<{
    asOf: string
    date: string
    periodId: string
    locale: DailyBriefingLocale
    timeZone: string
    windowHours: number
    periodTime?: string
    runTrigger?: DailyBriefingRunTrigger
  }>, force: boolean) => Promise<DailyBriefingTodayResult>
  withZone: (result: DailyBriefingTodayResult, zoneSource: DailyBriefingZoneSource) => DailyBriefingTodayResult
}>): (input: DailyBriefingRegenerateInput) => Promise<DailyBriefingTodayResult> {
  return async function regenerate(input) {
    // The moment chosen in the dialog **is** this run's cutoff, not "which scheduled edition it falls
    // into": `briefingWindow` would snap an 08:00 choice back to the schedule's 07:00 and publish the
    // 07:00 edition — the defect the reader reported as "我选 8 点，生成的是 7 点".
    const chosen = input.generation?.asOf
    const periodId = input.periodId ?? DEFAULT_PERIOD_ID
    const configured = await (deps.readPeriods?.().catch(() => []) ?? Promise.resolve([]))
    const own = configured.find((candidate) => candidate.id === periodId)
    const settings = own ?? await deps.readGeneration()
    const window = chosen === undefined
      ? briefingWindow(deps.now(), input.timeZone, settings)
      : briefingWindowAtCutoff(chosen, input.timeZone, {
        ...settings,
        ...(input.generation?.windowHours === undefined ? {} : { windowHours: input.generation.windowHours })
      })
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // 期自己写了语言就用它：定时/重跑的是一期，不是"界面现在是什么语言"。
    const locale = own?.language ?? input.locale
    return deps.withZone(await deps.runs.join(deps.runs.key(window.date, periodId, input.locale), async () =>
      deps.resolve({
        asOf: window.windowEnd, date: window.date, periodId, locale, timeZone: input.timeZone, windowHours: window.windowHours,
        // **手动发起就是手动期**（`02` v2.134 G9）：期次类型不在这里传，由 `runTrigger` 在
        // 组装文档身份那一处一次推导。以前两边各写一格，于是出现
        // 「periodKind=scheduled + runTrigger=manual」：一版两个身份，列表按后者显示成「定时」。
        runTrigger: 'manual',
        // Three values or none: the row's "cutoff · actual" pair and "current" both need them.
        ...(input.generation === undefined ? {} : { periodTime: input.generation.asOf })
      }, true)), window.zoneSource)
  }
}
