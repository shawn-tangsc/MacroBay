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

/**
 * 默认采集的国家。**先四个，不铺全量**：美国一国约 62 次/天，已占免费额度（5,000/月）的 37%，
 * 每加一个国家按页数近似线性增加。德国、英国、日本是日历里出现最多的非美国国家；
 * 跑满一天记下请求次数/页数/剩余额度，再决定继续扩还是收。
 */
export const narwhalCalendarCountries = Object.freeze(['USA', 'DEU', 'GBR', 'JPN'] as const)

export type NarwhalCalendarJobOutcome =
  | Readonly<{ state: 'succeeded'; pages: number; releases: number; firstPublishedCaptured: number; startDate: string; endDate: string }>
  | Readonly<{ state: 'failed'; failureCode: string; pagesRead: number; startDate: string; endDate: string }>
  /** 被门口挡下：源还锁着、或读者把它关了。**不静默**——带原因返回，方便对账「为什么这轮没采」。 */
  | Readonly<{ state: 'skipped'; reason: 'source-pending' | 'reader-disabled' | 'gate-missing'; startDate: string; endDate: string }>

/** 这一轮到底该不该采：源的可见性与读者开关。两条都必须满足，缺一条就不采。 */
export type NarwhalCalendarSourceGate = () => Promise<Readonly<{ visibility: string; enabled: boolean }> | undefined>

export function createNarwhalCalendarJobHandler(deps: Readonly<{
  runtime: ReturnType<typeof createNarwhalCalendarRuntime>
  now: () => number
  mode: 'tick' | 'sweep'
  countries?: readonly string[]
  /**
   * 采集前的门：**读者没打开、或源还锁着（`visibility: 'pending'`），一个请求都不发**。
   *
   * 之前只看「有凭据 + 内建启用」，结果读者在设置里看到「待接入」、开关锁着，数据却在进库。
   * 读者的开关与可见性必须是硬门；挡下时返回 `skipped` 并带原因，不许静默空转。
   */
  readSourceGate?: NarwhalCalendarSourceGate
}>): (input?: Readonly<{ startDate?: string; endDate?: string }>) => Promise<NarwhalCalendarJobOutcome> {
  const policy = deps.mode === 'tick' ? narwhalCalendarTickPolicy : narwhalCalendarSweepPolicy
  return async input => {
    // 作业自己算窗口：不读读者时区、也不读界面状态——「记账用 UTC」。
    const today = new Date(deps.now())
    const startDate = input?.startDate ?? today.toISOString().slice(0, 10)
    const end = new Date(today.getTime() + (policy.windowDays - 1) * 86_400_000)
    const endDate = input?.endDate ?? end.toISOString().slice(0, 10)
    // **fail-closed**：门没注入也不采。生产装配漏接一次，读者的开关就被静默忽略、照样采，
    // 而且没有任何报错——这正是这一轮要防的「看起来正常、其实不听话」。测试宿主要采数据，
    // 就在测试里显式注入一个「全开」的门；生产靠默认放行不正常。
    if (deps.readSourceGate === undefined) return { state: 'skipped', reason: 'gate-missing', startDate, endDate }
    const gate = await deps.readSourceGate().catch(() => undefined)
    const reason = gate === undefined ? 'gate-missing'
      : gate.visibility === 'pending' || gate.visibility === 'hidden' ? 'source-pending'
      : gate.enabled ? undefined : 'reader-disabled'
    if (reason !== undefined) return { state: 'skipped', reason, startDate, endDate }
    const result = await deps.runtime.run({ startDate, endDate, countries: deps.countries ?? narwhalCalendarCountries })
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
