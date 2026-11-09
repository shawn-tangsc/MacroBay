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

/**
 * Why one leg's history is not drawable. Two different facts, two different sentences:
 * the read returned no rows (`series-missing`), or it returned rows that broke their contract
 * (`value-invalid`). Neither is "zero" — a zero rate is a value and is drawn.
 */
export type DashboardFundingRateHistoryMissingReason = 'series-missing' | 'value-invalid'

export type DashboardFundingRateHistoryState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'available'; btc: readonly DashboardFundingRateHistoryPoint[]; eth: readonly DashboardFundingRateHistoryPoint[] }>
  /**
   * One leg has points and the other does not: the drawable leg keeps its chart line, the other is
   * named as unknown with its own reason. A missing leg must not take the present one down.
   */
  | Readonly<{

    state: 'partial'
    btc?: readonly DashboardFundingRateHistoryPoint[]
    eth?: readonly DashboardFundingRateHistoryPoint[]
    missing: Readonly<{ btc?: DashboardFundingRateHistoryMissingReason; eth?: DashboardFundingRateHistoryMissingReason }>
  }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>

export function projectDashboardFundingRateHistory(value: unknown, asOf: string): DashboardFundingRateHistoryState {
  try {
    if (!isCanonicalFundingRateHistoryTime(asOf)) return { state: 'unavailable' }
    if (exact(value, ['state', 'asOf', 'btc', 'eth']) && value.state === 'available' && value.asOf === asOf) {
      // A leg with no rows and a leg whose rows failed their contract are both "unknown", never
      // "zero"; the leg that did project keeps its points either way.
      const btcRows = projectRows(value.btc, asOf); const ethRows = projectRows(value.eth, asOf)
      const btc = btcRows && btcRows.length > 0 ? btcRows : undefined
      const eth = ethRows && ethRows.length > 0 ? ethRows : undefined
      const missing: { btc?: DashboardFundingRateHistoryMissingReason; eth?: DashboardFundingRateHistoryMissingReason } = {}
      if (!btc) missing.btc = Array.isArray(value.btc) && value.btc.length > 0 ? 'value-invalid' : 'series-missing'
      if (!eth) missing.eth = Array.isArray(value.eth) && value.eth.length > 0 ? 'value-invalid' : 'series-missing'
      if (btc && eth) return { state: 'available', btc, eth }
      if (btc || eth) return { state: 'partial', ...(btc ? { btc } : {}), ...(eth ? { eth } : {}), missing }
      return { state: 'unavailable' }
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
