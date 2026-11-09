import { describe, expect, it } from 'vitest'

import { formatLeg, projectDashboardDivergence } from './dashboardDivergenceModel'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()

const dto = {
  state: 'available' as const,
  asOf,
  escalated: false,
  rows: [{
    pairId: 'liquidity-leverage' as const,
    direction: 'bearish' as const,
    legs: [
      { id: 'stablecoin' as const, value: -1.21, unit: 'percent' as const, observedAt: at(2) },
      { id: 'open-interest' as const, value: 3.4, unit: 'percent' as const, observedAt: at(1) },
      { id: 'funding' as const, value: -0.0032, unit: 'percent-per-8h' as const, observedAt: at(1) }
    ]
  }],
  withheld: [{ pairId: 'flows-price' as const, reason: 'window-mismatch' as const, leg: 'etf' as const, observedAt: '2026-10-29T21:00:00.000Z' }]
}

describe('divergence view model', () => {
  it('formats each leg so the card can print it without knowing units', () => {
    const view = projectDashboardDivergence(dto, asOf)
    if (view.state !== 'available') throw new Error('expected rows')
    expect(view.rows[0]!.legs.map(leg => leg.text)).toEqual(['−1.21%', '+3.40%', '−0.0032% / 8h'])
  })

  it('keeps the instant a withheld leg stopped, so the card can name the day', () => {
    const view = projectDashboardDivergence(dto, asOf)
    // `withheld` only exists on the two settled branches of the union; the DTO above is `available`.
    if (view.state !== 'available') throw new Error('expected rows')
    expect(view.withheld).toEqual([{ pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf', observedAt: '2026-10-29T21:00:00.000Z' }])
  })

  it('refuses a DTO answered for a different instant', () => {
    expect(projectDashboardDivergence(dto, '2026-10-30T13:00:00.000Z')).toEqual({ state: 'unavailable', reason: 'query-failed', missing: [] })
  })

  it('reads a dollar flow in millions and a sentiment label as its own word', () => {
    expect(formatLeg({ id: 'etf', value: -150e6, unit: 'usd', observedAt: at(1) })).toBe('−$150M')
    // A share, not a change: no sign, no plus.
    expect(formatLeg({ id: 'sentiment', value: 72, unit: 'percent', observedAt: at(1) })).toBe('72%')
  })
})
