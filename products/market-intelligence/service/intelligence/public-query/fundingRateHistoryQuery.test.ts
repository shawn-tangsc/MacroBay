import { describe, expect, it } from 'vitest'
import { queryFundingRateHistoryAsync } from './fundingRateHistoryQuery'

describe('funding rate history query', () => {
  it('filters future rows, returns ascending latest 22 points and keeps assets independent', async () => {
    const result = await queryFundingRateHistoryAsync({
      asOf: '2026-09-03T00:00:00.010Z',
      store: { read: async () => ({ state: 'available' as const, btc: [{ observedAt: '2026-09-02T00:00:00.000Z', ratePercent: 0.01 }, { observedAt: '2026-09-02T01:00:00.000Z', ratePercent: 0.02 }], eth: [] }) }
    })
    expect(result).toMatchObject({ state: 'available', eth: [] })
    if (result.state === 'available') expect(result.btc).toHaveLength(2)
  })

  it('fails closed for malformed persisted rows and invalid as-of', async () => {
    await expect(queryFundingRateHistoryAsync({ asOf: 'bad', store: { read: async () => ({ state: 'empty' as const }) } })).resolves.toEqual({ state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' })
    await expect(queryFundingRateHistoryAsync({ asOf: '2026-09-03T00:00:00.000Z', store: { read: async () => ({ state: 'available' as const, btc: [{ observedAt: 'bad', ratePercent: 1 }], eth: [] }) } })).resolves.toEqual({ state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' })
  })
})
