import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { DEFAULT_PERIOD_ID, type DailyBriefingLocale, type DailyBriefingRunTrigger, type DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, briefingWindowAtCutoff, localDate, type DailyBriefingZoneSource } from './dailyBriefingWindow'
import { isManualGenerationDateAllowed } from '../../../contracts/dailyBriefingGenerationWindow'
import type { DailyBriefingRunCoalescer } from './dailyBriefingRunCoalescer'
import type { DailyBriefingTodayResult } from './dailyBriefingService'

export type DailyBriefingRegenerateInput = Readonly<{
  locale: DailyBriefingLocale
  timeZone: string
  periodId?: string
  generation?: Readonly<{ asOf: string; windowHours?: DailyBriefingWindowHours }>
  /**
   * 重跑已经存在的这一版：它的截止时刻与统计窗口。
   *
   * 有四样就够了——期号、截止、窗口、语言——都在那一版自己的文档里，一样都不需要问默认期配置。
   * 上一版只对齐了期号，时刻与窗口还在取期列表第一项，于是"点重新生成，又变成 07:00"
   * （用户 2026-11-06 两次报同一条）。
   */
  rerun?: Readonly<{ periodTime: string; windowHours?: DailyBriefingWindowHours }>
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
  readPeriods?: () => Promise<readonly BriefingPeriod[]>
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
    // 重跑这一版时**不读默认期配置**：它自己的截止与窗口就是全部依据。默认期配置（期列表第一项）
    // 只服务"从来没有过的默认期"，比如今天第一次生成——那条路径仍走下面的 `readGeneration`。
    const rerun = input.rerun
    const settings = rerun !== undefined ? undefined : own ?? await deps.readGeneration()
    const window = rerun !== undefined
      ? briefingWindowAtCutoff(rerun.periodTime, input.timeZone, {
        ...(rerun.windowHours === undefined ? {} : { windowHours: rerun.windowHours })
      })
      : chosen === undefined
        ? briefingWindow(deps.now(), input.timeZone, settings)
        : briefingWindowAtCutoff(chosen, input.timeZone, {
          ...settings,
          ...(input.generation?.windowHours === undefined ? {} : { windowHours: input.generation.windowHours })
        })
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // 服务端也校验手动生成的时间窗（用户 2026-11-06）：只靠界面挡不住 bug 与直接调接口，而每次生成
    // 都是一次模型调用。今天是**读者设置时区**的今天；超窗拒收，理由由界面翻成人话。
    const today = localDate(deps.now(), window.zoneSource === 'settings' ? input.timeZone : input.timeZone)
    if (today !== undefined && !isManualGenerationDateAllowed(window.date, today)) {
      return { state: 'unavailable', failureCode: 'date-out-of-window' }
    }
    // 期自己写了语言就用它：定时/重跑的是一期，不是"界面现在是什么语言"。
    const locale = own?.language ?? input.locale
    // 这一版的截止：重跑时就是它自己的，弹框选的就是读者选的那一个，都没有就不写（旧调用点）。
    const periodTime = rerun?.periodTime ?? input.generation?.asOf
    // 合并键用**真正要写的那个语言**：用界面语言会让同一版在两种界面语言下各起一次跑。
    return deps.withZone(await deps.runs.join(deps.runs.key(window.date, periodId, locale), async () =>
      deps.resolve({
        asOf: window.windowEnd, date: window.date, periodId, locale, timeZone: input.timeZone, windowHours: window.windowHours,
        // **手动发起就是手动期**（`02` v2.134 G9）：期次类型不在这里传，由 `runTrigger` 在
        // 组装文档身份那一处一次推导。以前两边各写一格，于是出现
        // 「periodKind=scheduled + runTrigger=manual」：一版两个身份，列表按后者显示成「定时」。
        runTrigger: 'manual',
        // Three values or none: the row's "cutoff · actual" pair and "current" both need them.
        // 重跑那一版时用**它自己的**截止；弹框选的一次性截止仍是 `generation`。
        ...(periodTime === undefined ? {} : { periodTime })
      }, true)), window.zoneSource)
  }
}
