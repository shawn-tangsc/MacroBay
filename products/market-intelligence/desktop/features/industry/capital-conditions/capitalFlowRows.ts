/**
 * One day of the flow chart: the stablecoin series plus the two ETF series.
 *
 * **三条线各自可能缺**（用户 2026-11-16：「有一个数据就要显示」）：某一天可能只有稳定币、
 * 也可能只有 ETF 两条之一。缺的那条就是 `undefined`——不是 0（0 是「那天净流是零」），
 * 画的时候跳过它，不画假柱子。
 */
export type FlowChartRow = {
  tradingDate: string
  funds?: number
  btc?: number
  eth?: number
}

/** 这一行三种序列里到底有哪几条（画图、测试都按它走，别再各自判一次）。 */
export const FLOW_SERIES = ['funds', 'btc', 'eth'] as const

/**
 * 横轴的日期序列：**从 asOf 那一天往前数 count 天，每天一格**（用户 2026-11-16：
 * 「不管这一天有没有数据，轴上都要推进到这一天」「今天一个数据都没有，最新的 x 轴也应该是今天」）。
 *
 * 所以横轴是**日历**，不是「有数据的那几天」：没有数据的那天只是一个空格子，柱子不画，
 * 但它Still占一格，日期照常出现在刻度上。日期一律按 asOf 的 **UTC 日**取——流水行的
 * `tradingDate` 就是源自己的 UTC 日，用读者时区去推会整体错一天。
 */
export function recentFlowDates(asOf: string, count: number): readonly string[] {
  // 接受 ISO 瞬时或日串：只取前 10 位，别的部分不参与（日期一律是源的 UTC 日）。
  const day = asOf.slice(0, 10)
  const anchor = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(anchor) || count <= 0) return []
  const dates: string[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(new Date(anchor - offset * 86_400_000).toISOString().slice(0, 10))
  }
  return dates
}

/**
 * The label a reader sees (`10-26`). It is a slice of the source string, never `new Date()`:
 * the day is the source's own UTC day, and a timezone shift would move it.
 */
export function shortFlowDate(tradingDate: string): string {
  return tradingDate.length > 5 ? tradingDate.slice(-5) : tradingDate
}

/** 前一天的 UTC 日串：`2026-11-16` → `2026-11-15`。 */
export function previousFlowDate(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
}
