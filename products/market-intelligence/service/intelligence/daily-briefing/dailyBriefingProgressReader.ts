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
