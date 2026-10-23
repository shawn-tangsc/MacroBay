// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { intelligenceFundingRateHistoryClient } from './intelligenceFundingRateHistoryClient'

afterEach(() => vi.unstubAllGlobals())

describe('funding history client', () => {
  it('accepts only the exact safe history DTO and invokes no renderer network', async () => {
    const asOf = '2026-09-03T00:00:00.000Z'
    const invoke = vi.fn(async () => ({ state: 'available', asOf, btc: [{ observedAt: asOf, ratePercent: 0.01 }], eth: [{ observedAt: asOf, ratePercent: -0.02 }] }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })
    await expect(intelligenceFundingRateHistoryClient.query({ asOf })).resolves.toMatchObject({ state: 'available' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory, { asOf })
  })

  it('fails closed for malformed or extended DTOs', async () => {
    const asOf = '2026-09-03T00:00:00.000Z'
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => ({ state: 'available', asOf, btc: [], eth: [], secret: true })) } } })
    await expect(intelligenceFundingRateHistoryClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' })
  })
})
