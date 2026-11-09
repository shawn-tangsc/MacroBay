import { describe, expect, it } from 'vitest'
import { formatDashboardFundingRateHistoryValue, projectDashboardFundingRateHistory } from './dashboardFundingRateHistoryModel'

const asOf = '2026-09-03T12:00:00.000Z'

describe('dashboard funding history model', () => {
  it('projects positive, negative, and zero history points with their text direction', () => {
    expect(projectDashboardFundingRateHistory({ state: 'available', asOf, btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0.01 }, { observedAt: '2026-09-03T08:00:00.000Z', ratePercent: 0 }], eth: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: -0.01 }] }, asOf)).toMatchObject({ state: 'available', btc: [{ paymentDirection: 'long-pays-short' }, { paymentDirection: 'neutral' }], eth: [{ paymentDirection: 'short-pays-long' }] })
    expect(formatDashboardFundingRateHistoryValue(-0)).toBe('0.0000%')
  })

  it('draws the leg that has values and names the other as unknown with its own reason', () => {
    // One unreadable leg must not take the other down: the points that are there are still drawable.
    const partial = projectDashboardFundingRateHistory({
      state: 'available', asOf,
      btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0.01 }],
      eth: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: Number.NaN }]
    }, asOf)
    expect(partial).toMatchObject({ state: 'partial', missing: { eth: 'value-invalid' }, btc: [{ ratePercent: 0.01 }] })
    expect(partial).not.toHaveProperty('eth')

    // No rows at all is a different reason from rows that failed their contract.
    const absent = projectDashboardFundingRateHistory({
      state: 'available', asOf,
      btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0 }],
      eth: []
    }, asOf)
    expect(absent).toMatchObject({ state: 'partial', missing: { eth: 'series-missing' }, btc: [{ ratePercent: 0 }] })

    // Both unreadable stays the block-level error: there is nothing to draw.
    expect(projectDashboardFundingRateHistory({
      state: 'available', asOf, btc: [], eth: []
    }, asOf)).toEqual({ state: 'unavailable' })
  })

  it('fails closed for extended, future, and out-of-order safe DTO impostors', () => {
    expect(projectDashboardFundingRateHistory({ state: 'available', asOf, btc: [], eth: [], sourceUrl: 'secret' }, asOf)).toEqual({ state: 'unavailable' })
    expect(projectDashboardFundingRateHistory({ state: 'available', asOf, btc: [{ observedAt: '2026-09-03T12:00:00.001Z', ratePercent: 0 }], eth: [] }, asOf)).toEqual({ state: 'unavailable' })
  })
})
