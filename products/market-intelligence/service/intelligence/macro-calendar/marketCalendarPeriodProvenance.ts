/**
 * **哪些来源的统计期是源自己给的**（Chief 2026-11-24 拍板，R38 PRD §3.1）。
 *
 * 背景：0xrouter 的行只有发布时刻（`scheduled_date/at` + `indicator_id`），统计期是
 * `zeroXRouterCanonicalIdentity` 用「发布时刻 + 声明规则 + 标题解析」**推**出来的；
 * narwhal 与官方源的行带着源自己的统计期。两边的「同一期」因此不是同一件事——
 * 拿它们比「两家数不一样」，等于替源断言「这两行说的是同一期」。
 *
 * 所以这件事**由来源回答**，不逐行存 `periodDerivation` 列：这张表是数据，不是散在代码里的 if。
 * 将来某个源补上期次，就往这里加一行（或改一行），判定不动。
 *
 * 三条边界：
 * 1. **不取「只限官方来源之间」**：那会把 narwhal × 官方这组**可判**的比对一起丢掉，
 *    而这组正是最该比的一对。
 * 2. **未登记的来源按「不知道它给不给期次」处理** → 不判冲突。宁可少数，不许拿推出来的期次
 *    冒充源给的事实。
 * 3. 「不可比（来源没有给统计期）」**不是「没有冲突」**：两者在计数与日志里必须分开，否则
 *    又是把「拿不到」写成「没有」。
 */

/** 期次是源给的（`source`），还是我们按发布时刻推的（`derived`）。 */
export type CalendarPeriodProvenance = 'source' | 'derived'

export const calendarPeriodProvenance: readonly Readonly<{
  providerId: string
  period: CalendarPeriodProvenance
  basis: string
}>[] = Object.freeze([
  {
    providerId: '0xrouter',
    period: 'derived',
    basis: '观测行只有发布时刻；统计期由发布时刻 + 声明规则 + 标题推得（zeroXRouterCanonicalIdentity）'
  },
  {
    providerId: 'macro-calendar-bea',
    period: 'source',
    basis: '官方发布自带统计期（BEA 发布族的期次字段）'
  },
  {
    providerId: 'macro-calendar-bls',
    period: 'source',
    basis: '官方发布自带统计期（BLS 排期与发布都带参考期）'
  },
  {
    providerId: 'macro-calendar-fed',
    period: 'source',
    basis: 'FOMC 的期次就是决议当天（源自己给的会议日）'
  },
  {
    providerId: 'macro-calendar-official-replay',
    period: 'source',
    basis: '官方历史回放，期次随官方快照一起给出'
  },
  {
    providerId: 'narwhal',
    period: 'source',
    basis: '采集行自带统计月（measure 观测的参考期由源给出）'
  }
])

/**
 * 这些来源的期次能否互相比对：**每一个来源都必须是「期次由源给出」**。
 * 未登记的来源不算可判——不知道它给不给期次，就不拿它当「同期」。
 */
export function periodsComparableAcrossSources(providerIds: readonly string[]): boolean {
  return providerIds.every((providerId) =>
    calendarPeriodProvenance.some((row) => row.providerId === providerId && row.period === 'source'))
}