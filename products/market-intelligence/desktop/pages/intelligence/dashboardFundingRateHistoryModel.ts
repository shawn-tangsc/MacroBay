import { fundingRateHistoryPolicy, isCanonicalFundingRateHistoryTime, isFundingRateHistoryRate } from '../../../contracts/intelligenceQueryContracts'
export const FundingRatePaymentDirectionPolicy = {
  resolve: (value: number): DashboardFundingRatePaymentDirection => {
    const normalized = Object.is(value, -0) ? 0 : value
    return normalized > 0 ? 'long-pays-short' : normalized < 0 ? 'short-pays-long' : 'neutral'
  }
} as const

export type DashboardFundingRatePaymentDirection = 'long-pays-short' | 'short-pays-long' | 'neutral'

export const dashboardFundingRateHistoryPresentationPolicy = Object.freeze({
  displayFractionDigits: 4,
  chart: Object.freeze({ series: Object.freeze(['btc', 'eth'] as const), maximumTimestamps: 22, minimumVisibleHeightPercent: 3, maximumHeightPercent: 100 })
})

export type DashboardFundingRateHistoryPoint = Readonly<{ observedAt: string; ratePercent: number; paymentDirection: DashboardFundingRatePaymentDirection }>
export type DashboardFundingRateHistoryState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'available'; btc: readonly DashboardFundingRateHistoryPoint[]; eth: readonly DashboardFundingRateHistoryPoint[] }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>

export function projectDashboardFundingRateHistory(value: unknown, asOf: string): DashboardFundingRateHistoryState {
  try {
    if (!isCanonicalFundingRateHistoryTime(asOf)) return { state: 'unavailable' }
    if (exact(value, ['state', 'asOf', 'btc', 'eth']) && value.state === 'available' && value.asOf === asOf) {
      const btc = projectRows(value.btc, asOf); const eth = projectRows(value.eth, asOf)
      return btc && eth ? { state: 'available', btc, eth } : { state: 'unavailable' }
    }
    if (exact(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === asOf) return { state: 'empty' }
    if (exact(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === fundingRateHistoryPolicy.unavailableFailureCode) return { state: 'unavailable' }
    return { state: 'unavailable' }
  } catch { return { state: 'unavailable' } }
}

export function formatDashboardFundingRateHistoryValue(value: number): string {
  if (!isFundingRateHistoryRate(value)) return ''
  const normalized = Object.is(value, -0) ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(dashboardFundingRateHistoryPresentationPolicy.displayFractionDigits)}%`
}

function projectRows(value: unknown, asOf: string): readonly DashboardFundingRateHistoryPoint[] | undefined {
  if (!Array.isArray(value) || value.length > fundingRateHistoryPolicy.maximumPointsPerAsset) return undefined
  let previous = ''
  const rows: DashboardFundingRateHistoryPoint[] = []
  for (const row of value) {
    if (!exact(row, ['observedAt', 'ratePercent']) || !isCanonicalFundingRateHistoryTime(row.observedAt) || row.observedAt > asOf || row.observedAt <= previous || !isFundingRateHistoryRate(row.ratePercent)) return undefined
    previous = row.observedAt
    const ratePercent = Object.is(row.ratePercent, -0) ? 0 : row.ratePercent
    rows.push(Object.freeze({ observedAt: row.observedAt, ratePercent, paymentDirection: FundingRatePaymentDirectionPolicy.resolve(ratePercent) }))
  }
  return Object.freeze(rows)
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === keys.length && keys.every((key) => Object.prototype.propertyIsEnumerable.call(value, key))
  } catch { return false }
}
