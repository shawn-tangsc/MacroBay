import type { MacroEconomicCalendarImportance } from '../../../contracts/macro/economicCalendarQueryContracts'

/**
 * **同一次发布的几行合成一条**（R44 技术方案 §4.3）。
 *
 * 为什么需要：日历的事件是**逐指标行**给的——一次 CPI 会带出「CPI 年率 / 核心 CPI 年率 …」
 * 好几条。提醒按行去重（`calendar-upcoming:{eventKey}:{scheduledAt}`），于是一次发布连响四声。
 *
 * 三条边界：
 * 1. **聚合不是重算**：它只在**已存的档**上取最大，判据仍是同一张 `(辖区, 族) → 档` 表；
 *    这里不调判定函数，也不看标题。
 * 2. **同一发布怎么认**：官方修订行自带发布组（`releaseGroupKey`）；市场行从指标码查发布组
 *    那张表（`marketCalendarReleaseGroupByMetricKey`，同一份 57 组）。都没有发布组的行按
 *    `(国家, 族, 时刻)` 聚合——族仍取指标码第二段。
 * 3. **没有时刻的行不并**：不知道是不是同一场，就别把它们合成一条。宁多响一次，不丢一场。
 */

/** 一条参与聚合的行只要这几样；别的字段原样留在代表行上。 */
export type CalendarReleaseRow = Readonly<{
  countryCode?: string | null
  /** 官方修订行的发布组（`us-cpi` / `US.BEA.GDP.2026-Q3.ADVANCE` …）。 */
  releaseGroupKey?: string
  /** 指标码（市场行的 `eventNameKey` 就是它；`US.CPI.NSA.YOY`）。 */
  metricKey?: string
  scheduledAt?: string
  /** 我们判的档；没有＝未分级。 */
  importance?: MacroEconomicCalendarImportance
}>

const tierRank: Readonly<Record<MacroEconomicCalendarImportance, number>> = Object.freeze({
  high: 3, medium: 2, low: 1
})

/**
 * 一次发布的组键；凑不出来返回 `undefined`（这些行各自成条，不合并）。
 *
 * 优先级：源/表给的发布组 → 指标码查发布组 → `国家|族|时刻`。**时刻进键**：同一发布在不同
 * 排期是两场（改期后两条都该响）。
 */
export function calendarReleaseKeyOf(row: CalendarReleaseRow, releaseGroupOf: (metricKey: string) => string | undefined): string | undefined {
  const scheduledAt = (row.scheduledAt ?? '').trim()
  if (scheduledAt === '') return undefined
  const metricKey = (row.metricKey ?? '').trim()
  const group = (row.releaseGroupKey ?? '').trim() !== ''
    ? row.releaseGroupKey!.trim()
    : metricKey === '' ? undefined : releaseGroupOf(metricKey)
  if (group !== undefined && group !== '') return `${group}|${scheduledAt}`
  // 没有发布组的行：国家 + 族（码第二段）+ 时刻。没有码就没有族，不合并。
  const family = metricKey.split('.')[1]
  if (family === undefined || family === '') return undefined
  return `${(row.countryCode ?? '').trim()}|${family}|${scheduledAt}`
}

/** 组内取最高档；一条有档的都没有 → `undefined`（未分级不进任何已勾档位）。 */
export function highestCalendarImportance(
  values: readonly (MacroEconomicCalendarImportance | undefined)[]
): MacroEconomicCalendarImportance | undefined {
  let best: MacroEconomicCalendarImportance | undefined
  for (const value of values) {
    if (value === undefined) continue
    if (best === undefined || tierRank[value] > tierRank[best]) best = value
  }
  return best
}

const rankOf = (value: MacroEconomicCalendarImportance | undefined): number =>
  value === undefined ? 0 : tierRank[value]

/**
 * 把同一 (发布组, 时刻) 的行并成一条：**代表取组内档最高的那一行**（标题跟着档走，读者不会
 * 看到「核心 CPI」配「高」而代表行是未分级的那种错位），档取组内最高。
 *
 * 没有键的行原样保留（档也原样保留）；顺序按**首次出现**，不按档重排——提醒是逐条发，
 * 顺序不影响读者，重排只会让同一份数据两次跑出不同结果。
 */
export function collapseCalendarReleases<T extends CalendarReleaseRow>(
  rows: readonly T[],
  releaseGroupOf: (metricKey: string) => string | undefined
): readonly Readonly<{ row: T; importance?: MacroEconomicCalendarImportance }>[] {
  const groups = new Map<string, T[]>()
  const order: string[] = []
  rows.forEach((row, index) => {
    const key = calendarReleaseKeyOf(row, releaseGroupOf) ?? `\u0000${index}`
    const members = groups.get(key)
    if (members === undefined) { groups.set(key, [row]); order.push(key); return }
    members.push(row)
  })
  return order.map((key) => {
    const members = groups.get(key)!
    const representative = [...members].sort((left, right) =>
      rankOf(right.importance) - rankOf(left.importance))[0]!
    const importance = highestCalendarImportance(members.map((member) => member.importance))
    return { row: representative, ...(importance === undefined ? {} : { importance }) }
  })
}