/**
 * ETF cumulative net flow over the latest N trading rows.
 *
 * The source returns one row per completed trading day. This helper deliberately
 * re-normalizes the order instead of trusting it: rows are sorted by `tradingDate`
 * first, so an out-of-order array still yields the same windows. A duplicate
 * `tradingDate` is ambiguous (which revision wins?) and fails closed to `undefined`
 * instead of silently merging. Windows are counted in **rows**, never calendar days:
 * a Friday-to-Monday weekend gap still counts as two trading days.
 *
 * A short window is never padded, extrapolated, or back-filled. `coveredDays` is the
 * number of rows actually summed, and `complete` is true only when that equals
 * `windowDays`.
 */
export const etfCumulativeFlowPolicy = {
  windows: [5, 20],
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export type EtfCumulativeFlowWindow = Readonly<{
  windowDays: number
  coveredDays: number
  netFlowUsd: number
  complete: boolean
}>

type FlowRow = Readonly<{ tradingDate: string; netFlowUsd: number }>

export function computeEtfCumulativeFlow(rows: unknown): readonly EtfCumulativeFlowWindow[] | undefined {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    const normalized: FlowRow[] = []
    for (const row of rows) {
      if (!isFlowRow(row)) return undefined
      normalized.push({ tradingDate: row.tradingDate, netFlowUsd: row.netFlowUsd })
    }
    normalized.sort((left, right) => left.tradingDate < right.tradingDate ? -1 : left.tradingDate > right.tradingDate ? 1 : 0)
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index]!.tradingDate === normalized[index - 1]!.tradingDate) return undefined
    }
    const windows: EtfCumulativeFlowWindow[] = []
    for (const windowDays of etfCumulativeFlowPolicy.windows) {
      const covered = normalized.slice(-windowDays)
      const total = covered.reduce((sum, row) => sum + row.netFlowUsd, 0)
      if (!Number.isFinite(total)) return undefined
      windows.push(Object.freeze({
        windowDays,
        coveredDays: covered.length,
        netFlowUsd: Object.is(total, -0) ? 0 : total,
        complete: covered.length === windowDays
      }))
    }
    return Object.freeze(windows)
  } catch {
    return undefined
  }
}

function isFlowRow(value: unknown): value is FlowRow {
  if (!isPlainRecord(value)) return false
  return isTradingDate(value.tradingDate) &&
    typeof value.netFlowUsd === 'number' && Number.isFinite(value.netFlowUsd) && !Object.is(value.netFlowUsd, -0)
}

function isTradingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !etfCumulativeFlowPolicy.tradingDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}
