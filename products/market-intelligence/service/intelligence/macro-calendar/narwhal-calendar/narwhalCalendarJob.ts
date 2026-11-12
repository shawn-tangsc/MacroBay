import type { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'

/**
 * Narwhal 日历的自动作业：**每源两条定义**（12 号方案 §2.2 的两段，不能只留一段）。
 *
 * - **tick**（30 分钟）：窗口只有「今天」，负责「刚发布的事件半小时内进当天列表」——
 *   这条同时是「到点提醒」的前提：没有当天行，提醒就没有对象。
 * - **日扫**（24 小时）：窗口是未来 30 天，负责把还没发生的日程铺进来。
 *
 * 少掉 tick 就等于把「发布后可见」降级成「次日可见」，那是时效的实质变化，不能顺带。
 * 作业只跑采集与入库；读者可见性由注册表的 `visibility` 决定，本文件不碰。
 */
export const narwhalCalendarTickPolicy = Object.freeze({
  definitionId: 'market-intelligence.refreshNarwhalCalendarTick.automatic',
  handlerId: 'market-intelligence.refreshNarwhalCalendarTick',
  audience: 'user' as const,
  intervalMs: 30 * 60 * 1_000,
  /** 今天窗口通常一页就够；留足退避。 */
  jobTimeoutMs: 4 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 },
  unsuccessfulStates: ['failed'] as const,
  mode: 'tick' as const,
  /** 窗口天数：今天一天。 */
  windowDays: 1
})

export const narwhalCalendarSweepPolicy = Object.freeze({
  definitionId: 'market-intelligence.refreshNarwhalCalendarSweep.automatic',
  handlerId: 'market-intelligence.refreshNarwhalCalendarSweep',
  audience: 'user' as const,
  intervalMs: 24 * 60 * 60 * 1_000,
  /** 30 天窗口实测 14 页；留足节流与重试时间。 */
  jobTimeoutMs: 10 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 },
  unsuccessfulStates: ['failed'] as const,
  mode: 'sweep' as const,
  /** 窗口天数：今天起 30 天。 */
  windowDays: 30,
  /** 45 天实测已超 20 页，别随手加长。 */
  maximumWindowDays: 30
})

export type NarwhalCalendarJobOutcome =
  | Readonly<{ state: 'succeeded'; pages: number; releases: number; firstPublishedCaptured: number; startDate: string; endDate: string }>
  | Readonly<{ state: 'failed'; failureCode: string; pagesRead: number; startDate: string; endDate: string }>

export function createNarwhalCalendarJobHandler(deps: Readonly<{
  runtime: ReturnType<typeof createNarwhalCalendarRuntime>
  now: () => number
  mode: 'tick' | 'sweep'
  countries?: readonly string[]
}>): (input?: Readonly<{ startDate?: string; endDate?: string }>) => Promise<NarwhalCalendarJobOutcome> {
  const policy = deps.mode === 'tick' ? narwhalCalendarTickPolicy : narwhalCalendarSweepPolicy
  return async input => {
    // 作业自己算窗口：不读读者时区、也不读界面状态——「记账用 UTC」。
    const today = new Date(deps.now())
    const startDate = input?.startDate ?? today.toISOString().slice(0, 10)
    const end = new Date(today.getTime() + (policy.windowDays - 1) * 86_400_000)
    const endDate = input?.endDate ?? end.toISOString().slice(0, 10)
    const result = await deps.runtime.run({ startDate, endDate, countries: deps.countries ?? ['USA'] })
    if (result.collector.state === 'failed') {
      return {
        state: 'failed', failureCode: result.collector.failureCode,
        pagesRead: result.collector.pagesRead, startDate, endDate
      }
    }
    return {
      state: 'succeeded', pages: result.collector.pages, releases: result.collector.releases,
      firstPublishedCaptured: result.firstPublishedCaptured, startDate, endDate
    }
  }
}
