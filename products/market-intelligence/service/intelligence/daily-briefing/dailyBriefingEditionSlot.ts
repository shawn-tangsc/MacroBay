import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * 「这个 (日期, 截止时刻, 语言) 槽位被哪一期占着」——存版次的地方要回答的那一问。
 *
 * 槽的身份就是这三样（用户 2026-11-06：同一个时间、同一个窗口同一个语言生成了两份简报）。
 * 期号不进键：它是那一版的属性，不是它的身份；窗口也不进键，窗口不同照样算同一槽。
 */
export type BriefingEditionSlotStore = Readonly<{
  /** 旧表没有 `period_id` 列时返回 `undefined`（那一代一天一语言只有一版，没有可比的身份）。 */
  editionAtCutoff?: (
    date: string,
    locale: DailyBriefingLocale,
    cutoff: string
  ) => Promise<Readonly<{ periodId: string }> | undefined>
}>

/**
 * 这一跑该写进哪一期：槽里已经有别的期，就写进它，不另插一行。
 *
 * "再点一次就是新的一期"因此不再成立——那正是这次重复的来源，交易型测试要求以后也不再出现
 * 同一刻同一语言的两行。调用方拿到期号后照旧走 upsert，于是旧内容被替换、列表仍只有一行。
 */
export async function briefingEditionSlotPeriodId(
  store: BriefingEditionSlotStore,
  input: Readonly<{ date: string; locale: DailyBriefingLocale; asOf: string; periodId: string }>
): Promise<string> {
  const occupant = await store.editionAtCutoff?.(input.date, input.locale, input.asOf).catch(() => undefined)
  return occupant === undefined ? input.periodId : occupant.periodId
}
