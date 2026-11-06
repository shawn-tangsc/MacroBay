import type { BriefingGenerationTrace, DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type {
  DailyBriefingAttemptsResult,
  DailyBriefingStorageState,
  DailyBriefingStore
} from './dailyBriefingService'

/**
 * The read-only half of the briefing service: one edition, its attempts, and where the store stands.
 *
 * Kept out of the service because none of it decides anything — it asks the store and turns the
 * answer into the shape the page reads, including the difference between "no attempts" (an empty
 * list) and "the attempts could not be read" (its own failure code, never an empty list).
 */
/**
 * 读一版的结果。
 *
 * `unavailable` 是"这一期没有版次，但它今天跑过而且失败了"：码与**那一次尝试自己的**步骤一起交回。
 * 以前这里只有 `missing`，于是点开失败的那一行读到的是"没有内容"，原因和步骤全丢在右侧记录里
 * （用户 2026-11-06：点失败的项应该能看到对应的 step 和失败原因）。
 */
export type DailyBriefingGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unavailable'; failureCode: string; generationTrace?: BriefingGenerationTrace }>

export function createDailyBriefingReads(deps: Readonly<{ store: DailyBriefingStore }>): Readonly<{
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingGetResult>
  listAttempts: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingAttemptsResult>
  getStorageState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
}> {
  return Object.freeze({
    async get(input) {
      const periodId = input.periodId ?? 'default'
      const row = await deps.store.get(input.date, input.locale, periodId).catch(() => undefined)
      if (row) return { state: 'available', document: row.document }
      // 没有版次：这一期今天跑过、而且最后一次失败了，就把那次的码与步骤交出去。从没跑过的期仍是
      // `missing`——"没内容"和"跑失败了"对读者是两件事，不能都折成一句"没有"。
      const attempts = await deps.store.listAttempts?.(input.date, input.locale, periodId).catch(() => undefined)
      const last = attempts?.[0]
      if (last?.state !== 'failed') return { state: 'missing' }
      const generationTrace = await deps.store.getAttempt?.(input.date, input.locale, periodId).catch(() => undefined)
      return {
        state: 'unavailable',
        // 没有记下码的老尝试：用已有的通用码，不新造一个只有代码没有句子的码。
        failureCode: last.failureCode ?? 'build-failed',
        ...(generationTrace ? { generationTrace } : {})
      }
    },
    async listAttempts(input) {
      if (!deps.store.listAttempts) return { state: 'unavailable', failureCode: 'attempts-unreadable' }
      try {
        return { state: 'available', attempts: await deps.store.listAttempts(input.date, input.locale, input.periodId) }
      } catch {
        return { state: 'unavailable', failureCode: 'attempts-unreadable' }
      }
    },
    getStorageState() {
      return deps.store.upgradeState?.() ?? { state: 'ready' }
    },
    async retryUpgrade() {
      return (await deps.store.retryUpgrade?.()) ?? { state: 'ready' }
    }
  })
}
