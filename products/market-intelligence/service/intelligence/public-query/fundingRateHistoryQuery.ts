import { fundingRateHistoryPolicy, isCanonicalFundingRateHistoryTime, isFundingRateHistoryRate, type FundingRateHistoryResult } from '../../../contracts/intelligenceQueryContracts'
import type { FundingRateHistoryStore } from '../store/fundingRateHistoryStore'

export async function queryFundingRateHistoryAsync(input: { asOf: string; store: Pick<FundingRateHistoryStore, 'read'> }): Promise<FundingRateHistoryResult> {
  if (!isCanonicalFundingRateHistoryTime(input.asOf)) return unavailable()
  try {
    const result = await input.store.read({ asOf: input.asOf })
    if (result.state === 'unavailable') return unavailable()
    if (result.state === 'empty') return { state: 'empty', asOf: input.asOf }
    const btc = sanitizeRows(result.btc)
    const eth = sanitizeRows(result.eth)
    if (!btc || !eth) return unavailable()
    const output: FundingRateHistoryResult = { state: 'available', asOf: input.asOf, btc, eth }
    return utf8Bytes(output) <= fundingRateHistoryPolicy.maximumDtoBytes ? output : unavailable()
  } catch { return unavailable() }
}

function sanitizeRows(rows: readonly { observedAt: string; ratePercent: number }[]): readonly { observedAt: string; ratePercent: number }[] | undefined {
  if (!Array.isArray(rows) || rows.length > fundingRateHistoryPolicy.maximumPointsPerAsset) return undefined
  let previous = ''
  return rows.every((row) => {
    if (!row || !isCanonicalFundingRateHistoryTime(row.observedAt) || !isFundingRateHistoryRate(row.ratePercent) || row.observedAt <= previous) return false
    previous = row.observedAt
    return true
  }) ? rows.map((row) => Object.freeze({ observedAt: row.observedAt, ratePercent: Object.is(row.ratePercent, -0) ? 0 : row.ratePercent })) : undefined
}

function utf8Bytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

function unavailable(): Extract<FundingRateHistoryResult, { state: 'unavailable' }> { return { state: 'unavailable', failureCode: fundingRateHistoryPolicy.unavailableFailureCode } }
