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

/** 一次跑最早留下的痕迹：开工前写下的 attempt 行。 */
export type BriefingAttemptRun = Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
  state: 'running' | 'succeeded' | 'failed'
  /** 这次尝试的发起时刻：没有版次的那一行，第一行的时刻就用它（手动期写「{HH:MM} 发起」）。 */
  startedAt: string
  /**
   * 这一次跑的名义截止时刻（那一版的 `asOf`／窗口右端）。
   *
   * 有版次时身份写在正文里；**没有版次的行**（失败、跑不完）只能从尝试记录取。以前没有这一列，
   * 界面只好拿 `startedAt` 顶上去，于是 09:30 重跑一个 07:00 的期，失败行会被印成「截止 09:30」——
   * 发起时刻被当成了截止。老记录这一列是空的，读出来 `undefined`，投影回退 `startedAt`，
   * 界面写「未记录」，**不拿当前设置回填**。
   */
  nominalAt?: string
  trigger?: string
  windowHours?: number
}>

/**
 * 窗口内的 attempt 行，按日期从早到晚。
 *
 * 列表按**运行**建行：一次跑在开工前就写下 attempt，所以哪怕它还没冻住事实、没来得及建运行记录、
 * 更没有版次，这一行也必须出现（用户 2026-11-06：只要开始跑了就要留在 list 里）。
 */
export type BriefingAttemptRunStore = Readonly<{
  listAttemptRuns?: (from: string, to: string) => Promise<readonly BriefingAttemptRun[]>
}>
