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
  input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; periodTime?: string }>
): readonly DailyBriefingEditionSummary[] {
  const exists = rows.some((row) => row.date === input.date && row.periodId === input.periodId && row.locale === input.locale)
  if (exists) return rows
  return [{
    date: input.date,
    periodId: input.periodId,
    locale: input.locale,
    availableLocales: [input.locale],
    state: 'missing',
    ...(input.periodTime === undefined ? {} : { periodTime: input.periodTime }),
    languages: [{ locale: input.locale, state: 'generating' as const }]
  }, ...rows]
}

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
  /** Read the list again once the run settles: the row must show what just landed. */
  onSettled?: () => void
}>): Readonly<{
  /** Runs one issue now. An optional draft is the manual dialog's three fields. */
  regenerate: (options?: Readonly<{
    locale?: 'zh-CN' | 'en-US'
    /** A one-off manual period's own id; without it the run lands on `default` and overwrites a slot. */
    periodId?: string
    generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
  }>) => Promise<void>
  generateNow: () => void
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

  return {
    async regenerate(options) {
      input.setRegenerating(true)
      input.setRegenerateFailure(null)
      // 先挂一行"生成中"再开始跑：今天还没有任何版次/运行记录时，列表里连挂进度的那一行都没有，
      // 读者只会看到标题在转、步骤一个都不出。这一行是**这一刻的事实**（确实在跑），跑完由服务
      // 返回的结果替换；失败时下一轮重读会把这一行去掉。
      if (input.todayDate !== undefined) input.setEditions((current) => withGeneratingRow(current, {
        date: input.todayDate!,
        periodId: options?.periodId ?? 'default',
        locale: options?.locale ?? input.locale,
        ...(options?.generation?.asOf === undefined ? {} : { periodTime: options.generation.asOf })
      }))
      const document = await run(options)
      // 跑失败/超时也要把这行收回：它是"正在跑"的临时事实，不是一条版次。留着它会变成一行永远
      // "生成中"的幽灵（进程崩过的那次尤其明显）。判据只用"占位行 + 语言正在生成"这两个特征。
      if (!document) input.setEditions((current) => current.filter((row) => !isGeneratingPlaceholder(row)))
      if (document) {
        input.setView({ status: 'ready', document, kind: 'today' })
        // 只替换读到的那一行（日期 + 期号 + 语言）：同一天另一语言的行必须原样留着，
        // 否则两行会变成同一版次，键相同、语言相同，看上去像"选中了两个"。
        input.setEditions((current) => mergeEditionSummary(current, document))
      }
      input.setRegenerating(false)
    },
    generateNow() {
      input.setRegenerateFailure(null)
      input.setRegenerating(true)
      void run()
        .then((document) => {
          if (document) {
            input.setView({ status: 'ready', document, kind: 'today' })
            input.setCurrentPeriodDate?.(document.edition.date)
          }
        })
        .finally(() => {
          input.setRegenerating(false)
          input.onSettled?.()
        })
    }
  }
}
