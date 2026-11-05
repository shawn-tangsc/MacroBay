import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { BriefingRegenerateFailure } from './runBriefingRegenerate'
import { runBriefingRegenerate } from './runBriefingRegenerate'
import { mergeEditionSummary } from './dailyBriefingPageDerived'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'

/**
 * The two actions that spend a model run: "generate this issue" and "regenerate it again".
 *
 * Both call the same service path and report through the same two setters, so the pane and the rail
 * cannot end up describing the outcome differently. Kept out of the page because it is a
 * capability, not layout.
 */
/** 临时挂上去的"生成中"行：没有正文、语言状态是 generating。 */
function isGeneratingPlaceholder(row: DailyBriefingEditionSummary): boolean {
  return row.state === 'missing'
    && row.summaryLine === undefined
    && (row.languages ?? []).some((language) => language.state === 'generating')
}

/** 正在跑的那一行：列表据此显示「生成中」，而不是等重读之后才出现。 */
function withGeneratingRow(
  rows: readonly DailyBriefingEditionSummary[],
  input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; periodTime?: string; manual: boolean }>
): readonly DailyBriefingEditionSummary[] {
  const exists = rows.some((row) => row.date === input.date && row.periodId === input.periodId && row.locale === input.locale)
  if (exists) return rows
  return [{
    date: input.date,
    periodId: input.periodId,
    locale: input.locale,
    availableLocales: [input.locale],
    state: 'missing',
    // 来源徽标跟**这一次的运行**走：手动发起的就写「手动」，不许回落到排期身份。
    ...(input.manual ? { periodKind: 'manual' as const } : {}),
    ...(input.periodTime === undefined ? {} : { periodTime: input.periodTime }),
    languages: [{ locale: input.locale, state: 'generating' as const }]
  }, ...rows]
}

/**
 * What the run currently in flight is doing.
 *
 * The pane and the toolbar both read this one value: a manual run for one moment and one language is
 * not "regenerating the edition you are looking at", and saying so made the reader think his choice
 * was ignored. `asOf` travels because the toolbar names the moment it is writing.
 */
export type BriefingRunTrigger = 'manual' | 'regenerate' | 'retry'

export type BriefingRunIntent = Readonly<{
  kind: 'manual' | 'regenerate'
  /** 这一版所在日期：与挂临时行同一个值，否则选中项凑不齐 (日期, 期号, 语言)。 */
  date: string
  periodId: string
  locale: 'zh-CN' | 'en-US'
  asOf?: string
}>

export function useBriefingRunActions(input: Readonly<{
  client: Pick<DailyBriefingClient, 'regenerate'>
  locale: 'zh-CN' | 'en-US'
  /** An unreadable stored zone means the run works on the UTC clock, and says so on screen. */
  zoneInvalid: string | null
  timeZone: string
  setView: (next: DailyBriefingPageViewState | ((current: DailyBriefingPageViewState) => DailyBriefingPageViewState)) => void
  setRegenerating: (busy: boolean) => void
  setRegenerateFailure: (failure: BriefingRegenerateFailure | null) => void
  setEditions: (next: (current: readonly DailyBriefingEditionSummary[]) => readonly DailyBriefingEditionSummary[]) => void
  setCurrentPeriodDate?: (date: string) => void
  /** 今天（期次自己的日期定义）；给了才能先挂一行"生成中"。 */
  todayDate?: string
  /** 这一次跑用了哪个期号——进度查询要用它，不是"当前选中的那一期"。 */
  onRunStarted?: (periodId: string) => void
  /** 这一次**在做什么**（手动的一期 / 重跑当前版），跑完置空。 */
  onRunIntent?: (intent: BriefingRunIntent | null) => void
  /** Read the list again once the run settles: the row must show what just landed. */
  onSettled?: () => void
}>): Readonly<{
  /**
   * 生成一次的**唯一入口**。
   *
   * 五个调用点（弹框生成、撞期替换、工具栏重新生成、正文失败面板重试、失败行行内重试）都走这里，
   * 每个入口只声明**意图**（`trigger`），期号/语言/截止由它按这一行自己的身份给出——以前每个入口
   * 自带一套参数组合，读者从不同按钮点下去会跑到不同的期上。
   */
  runBriefing: (request: Readonly<{
    /** 不传就是服务端的默认期：只留给"重跑当前版"这种本来就落默认期的入口。 */
    periodId?: string
    locale: 'zh-CN' | 'en-US'
    generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
    /** 只决定文案与"这一次在做什么"，不决定跑哪一期——那是上面两样的职责。 */
    trigger: BriefingRunTrigger
  }>) => Promise<void>
}> {
  const run = (options: Readonly<{ locale?: 'zh-CN' | 'en-US'; periodId?: string; generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }> }> = {}): Promise<DailyBriefingDocument | undefined> => runBriefingRegenerate({
    client: input.client,
    locale: options.locale ?? input.locale,
    timeZone: input.zoneInvalid ? 'UTC' : input.timeZone,
    // 期号必须一路传到服务：没有它，这一跑会落到 `default` 那一期上，把别的期覆盖掉。
    ...(options.periodId === undefined ? {} : { periodId: options.periodId }),
    ...(options.generation === undefined ? {} : { generation: options.generation })
  }).then((outcome) => {
    if (outcome.kind === 'available') return outcome.document
    input.setRegenerateFailure(outcome.failure)
    return undefined
  })

  /**
   * 一次运行的**起点**：每个入口都走这里，否则"再加一个入口就再坏一次"。
   * 挂行 + 立 generating 标志 + 清上一次失败，三样在同一处发生。
   */
  const begin = (options: Readonly<{
    locale?: 'zh-CN' | 'en-US'
    periodId?: string
    generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
    trigger?: BriefingRunTrigger
  }> = {}): void => {
    input.setRegenerateFailure(null)
    input.setRegenerating(true)
    // 手动期带自己的期号与截止；没有这两样的就是"重跑当前版"。两个入口在这里分叉，别在下游判。
    input.onRunIntent?.({
      kind: options.trigger === 'manual' ? 'manual' : 'regenerate',
      date: input.todayDate ?? '',
      periodId: options.periodId ?? 'default',
      locale: options.locale ?? input.locale,
      ...(options.generation?.asOf === undefined ? {} : { asOf: options.generation.asOf })
    })
    if (input.todayDate === undefined) return
    const startedPeriodId = options.periodId ?? 'default'
    input.onRunStarted?.(startedPeriodId)
    input.setEditions((current) => withGeneratingRow(current, {
      date: input.todayDate!,
      periodId: startedPeriodId,
      locale: options.locale ?? input.locale,
      manual: options.trigger === 'manual',
      ...(options.generation?.asOf === undefined ? {} : { periodTime: options.generation.asOf })
    }))
  }

  return {
    async runBriefing(request) {
      // 这一次运行的**身份**：临时行就是按它造的，跑完也按它收回（不靠合并碰巧覆盖）。
      const started = {
        date: input.todayDate ?? '',
        periodId: request.periodId ?? 'default',
        locale: request.locale
      }
      begin(request)
      // 先挂一行"生成中"再开始跑：今天还没有任何版次/运行记录时，列表里连挂进度的那一行都没有，
      // 读者只会看到标题在转、步骤一个都不出。这一行是**这一刻的事实**（确实在跑），跑完由服务
      // 返回的结果替换；失败时下一轮重读会把这一行去掉。
      const document = await run(request)
      // 跑失败/超时也要把这行收回：它是"正在跑"的临时事实，不是一条版次。留着它会变成一行永远
      // "生成中"的幽灵（进程崩过的那次尤其明显）。判据只用"占位行 + 语言正在生成"这两个特征。
      if (!document) input.setEditions((current) => current.filter((row) => !isGeneratingPlaceholder(row)))
      // 临时行是页面编出来表示"这次在跑"的：跑完先按**它自己的身份**删掉，再挂真实结果。
      // 只靠"合并碰巧覆盖"会留两处幽灵：语言那格没被覆盖（一直显示生成中）、身份对不上时整行不走。
      if (document) {
        input.setEditions((current) => current.filter((row) => !(row.date === started.date
          && row.periodId === started.periodId && row.locale === started.locale)))
        input.setView({ status: 'ready', document, kind: 'today' })
        // 手动期可能落在另一天/另一期：切到它自己的日期，否则正文写的是新的一版、列表还停在旧那天。
        input.setCurrentPeriodDate?.(document.edition.date)
        // 只替换读到的那一行（日期 + 期号 + 语言）：同一天另一语言的行必须原样留着，
        // 否则两行会变成同一版次，键相同、语言相同，看上去像"选中了两个"。
        input.setEditions((current) => mergeEditionSummary(current, document))
      }
      input.onRunIntent?.(null)
      input.setRegenerating(false)
      // #29：跑完必须**清掉这一次跑的期号**并让页面重读一次。期号留着不清，下一次定时/另一个窗口
      // 发起的运行会用上一跑的期号去查进度，查不到 → 界面完全不显示"生成中"（比显示错更难查）。
      input.onSettled?.()
    }
  }
}
