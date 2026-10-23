import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { fundingRateHistoryPolicy, isCanonicalFundingRateHistoryTime, isFundingRateHistoryRate, type FundingRateHistoryResult } from '../../../contracts/intelligenceQueryContracts'

export const intelligenceFundingRateHistoryClient = {
  async query(input: { asOf: string }): Promise<FundingRateHistoryResult> {
    try {
      if (!isCanonicalFundingRateHistoryTime(input.asOf)) return unavailable()
      const value = await window.platform?.products?.invoke('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory, input)
      if (isExact(value, ['state', 'asOf', 'btc', 'eth']) && value.state === 'available' && value.asOf === input.asOf) {
        const btc = rows(value.btc); const eth = rows(value.eth)
        if (btc && eth) return { state: 'available', asOf: input.asOf, btc, eth }
      }
      if (isExact(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return { state: 'empty', asOf: input.asOf }
      if (isExact(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === fundingRateHistoryPolicy.unavailableFailureCode) return unavailable()
      return unavailable()
    } catch { return unavailable() }
  }
}

function rows(value: unknown): readonly { observedAt: string; ratePercent: number }[] | undefined {
  if (!Array.isArray(value) || value.length > fundingRateHistoryPolicy.maximumPointsPerAsset) return undefined
  let previous = ''
  return value.every((row) => isExact(row, ['observedAt', 'ratePercent']) && isCanonicalFundingRateHistoryTime(row.observedAt) && isFundingRateHistoryRate(row.ratePercent) && row.observedAt > previous && (previous = row.observedAt) === row.observedAt)
    ? value.map((row) => Object.freeze({ observedAt: row.observedAt as string, ratePercent: Object.is(row.ratePercent, -0) ? 0 : row.ratePercent as number })) : undefined
}

function isExact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === keys.length && keys.every((key) => Object.prototype.propertyIsEnumerable.call(value, key))
  } catch { return false }
}

function unavailable(): Extract<FundingRateHistoryResult, { state: 'unavailable' }> { return { state: 'unavailable', failureCode: fundingRateHistoryPolicy.unavailableFailureCode } }
