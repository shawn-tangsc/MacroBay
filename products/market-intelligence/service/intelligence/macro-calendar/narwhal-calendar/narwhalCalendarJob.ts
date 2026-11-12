import type { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'

/**
 * Narwhal 日历的自动作业：**每源一个定义**，与 0xRouter 那三条同一个形态。
 *
 * 两条口径：
 * - **日扫**（间隔 24 小时），窗口是「昨天 + 今天」——首次上线只补最近两天，
 *   不向历史扩张（源没有 2026-10 之前的美国数据，补也补不出来）。
 * - 作业只跑采集与入库；读者可见性由注册表的 `visibility` 决定，本文件不碰。
 */
export const narwhalCalendarJobPolicy = Object.freeze({
  definitionId: 'market-intelligence.refreshNarwhalCalendar.automatic',
  handlerId: 'market-intelligence.refreshNarwhalCalendar',
  audience: 'user' as const,
  intervalMs: 24 * 60 * 60 * 1_000,
  /** 一天两页、每页最多翻 30 页，留足退避时间。 */
  jobTimeoutMs: 10 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 },
  unsuccessfulStates: ['failed'] as const,
  /** 采集窗口：今天与昨天（UTC 日界），单位天。 */
  windowDays: 2
})

export type NarwhalCalendarJobOutcome =
  | Readonly<{ state: 'succeeded'; pages: number; releases: number; firstPublishedCaptured: number; startDate: string; endDate: string }>
  | Readonly<{ state: 'failed'; failureCode: string; pagesRead: number; startDate: string; endDate: string }>

export function createNarwhalCalendarJobHandler(deps: Readonly<{
  runtime: ReturnType<typeof createNarwhalCalendarRuntime>
  now: () => number
  countries?: readonly string[]
}>): (input?: Readonly<{ startDate?: string; endDate?: string }>) => Promise<NarwhalCalendarJobOutcome> {
  return async input => {
    // 作业自己算窗口：不读读者时区、也不读界面状态——「记账用 UTC」。
    const today = new Date(deps.now())
    const endDate = input?.endDate ?? today.toISOString().slice(0, 10)
    const start = new Date(today.getTime() - (narwhalCalendarJobPolicy.windowDays - 1) * 86_400_000)
    const startDate = input?.startDate ?? start.toISOString().slice(0, 10)
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
