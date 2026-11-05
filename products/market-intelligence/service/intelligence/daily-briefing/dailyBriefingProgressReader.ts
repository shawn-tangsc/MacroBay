import type {
  BriefingGenerationProgress,
  DailyBriefingLocale,
  DailyBriefingProgressResult
} from '../../../contracts/dailyBriefing'
import type { DailyBriefingGeneration } from './dailyBriefingService'
import { briefingWindow } from './dailyBriefingWindow'

/**
 * 「现在有没有一期在跑」：只读运行中的活快照，不去读存储。
 *
 * 单独一处是因为它和列表、和生成都不共用任何状态判断；放在服务里会让一段 200 行的生成流程再长
 * 七行，谁也不该为了回答这一句话去读那一整段。
 */
/**
 * 这一期此刻在跑哪一份进度。
 *
 * **不能按 `default` 期号去查**：手动生成自带一次性期号（`0aeb942`），进度写在 `date:<那次的期号>:locale`
 * 下；照默认期号查会永远查不到，界面上就只剩一行「正在重新生成…」、一个步骤都不显示。
 * 所以要按 `(日期, 语言)` 在活快照里找——同一 (日期, 语言) 同时只可能有一跑，后写入的为准。
 */
export function liveProgressFor(
  progress: ReadonlyMap<string, BriefingGenerationProgress>,
  date: string,
  locale: DailyBriefingLocale
): BriefingGenerationProgress | undefined {
  let found: BriefingGenerationProgress | undefined
  for (const [key, value] of progress) {
    if (key.startsWith(`${date}:`) && key.endsWith(`:${locale}`)) found = value
  }
  return found
}

export function createBriefingProgressReader(deps: Readonly<{
  now: () => string
  readGeneration: () => Promise<DailyBriefingGeneration>
  /** The key of one edition's live progress, from the run journal. */
  progressOf: (date: string, locale: DailyBriefingLocale) => BriefingGenerationProgress | undefined
}>): (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingProgressResult> {
  return async (input) => {
    const window = briefingWindow(deps.now(), input.timeZone, await deps.readGeneration())
    // A schedule the reader has not set a valid hour for cannot say which edition is running.
    if (!window) return { state: 'idle' }
    const running = deps.progressOf(window.date, input.locale)
    return running === undefined ? { state: 'idle' } : { state: 'running', progress: running }
  }
}
