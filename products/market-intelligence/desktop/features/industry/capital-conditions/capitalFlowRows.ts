/** One day of the flow chart: the stablecoin series plus the two ETF series, already aligned. */
export type FlowChartRow = { tradingDate: string; funds: number; btc: number; eth: number }

/**
 * The one place the chart window is cut.
 *
 * The projection already hands over an aligned series; this cut makes "the days the chart is
 * showing" a named thing so the bar-top labels and the daily table cannot each slice their own
 * window and drift apart.
 */
export function selectVisibleFlowRows(
  rows: readonly FlowChartRow[],
  visibleRows: number
): readonly FlowChartRow[] {
  const count = Math.max(0, Math.min(visibleRows, rows.length))
  return count === rows.length ? rows : rows.slice(rows.length - count)
}

/**
 * The label a reader sees (`10-26`). It is a slice of the source string, never `new Date()`:
 * the day is the source's own UTC day, and a timezone shift would move it.
 */
export function shortFlowDate(tradingDate: string): string {
  return tradingDate.length > 5 ? tradingDate.slice(-5) : tradingDate
}
