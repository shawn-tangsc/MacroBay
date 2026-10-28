import { describe, expect, it } from 'vitest'

import {
  dashboardCapitalConditionsPresentationPolicy,
  projectDashboardCapitalConditionsSnapshot
} from './capitalConditionsModel'

const asOf = '2026-08-18T08:00:00.000Z'

describe('dashboard capital conditions model', () => {
  it('projects the validated core observation time with only compact safe facts', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available',
      asOf,
      etf: { state: 'unavailable' },
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z',
        currentUsd: 254_900_000_000, change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323,
        change30dUsd: -500_000_000, change30dPercent: -0.21
      },
      usdStablecoinSupplyUsd: 307_300_000_000,
      conclusion: 'partial'
    }, asOf)

    expect(result).toEqual({
      state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: '2026-08-18T07:00:00.000Z',
      currentUsd: '$254.9B', change1dUsd: '+$82.4M', change1dPercent: '+0.03%', change7dUsd: '+$82.4M', change7dPercent: '+0.03%',
      change30dUsd: '-$500M', change30dPercent: '-0.21%', usdStablecoinSupplyUsd: '$307.3B'
    })
    expect(JSON.stringify(result)).not.toMatch(/verifiedAt|https?:|source|raw|error|failure/i)
  })

  it('projects complete five- and twenty-day cumulative sums from the same validated rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '+$381', complete: true }
    ])
    expect(result.etf.eth.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '-$381', complete: true }
    ])
  })

  it('marks the twenty-day window incomplete when the local window only holds twelve rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(12),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
    ])
    expect(result.etf.eth.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
    ])
  })

  it('does not fabricate cumulative windows when the ETF snapshot is unavailable', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', etf: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('cumulative')
  })

  it('merges only common persisted capital, BTC, and ETH dates into three-series chart rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01, dailyFlows: stablecoinRows() }
    }, asOf)

    expect(result).toMatchObject({
      state: 'available',
      etf: {
        state: 'available',
        btc: { asset: 'BTC', latestNetFlowUsd: '+$30', observedAt: '2026-08-18T07:00:00.000Z' },
        eth: { asset: 'ETH', latestNetFlowUsd: '-$30', observedAt: '2026-08-18T07:00:00.000Z' }
      }
    })
    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.rows).toHaveLength(30)
    expect(result.etf.eth.rows).toHaveLength(30)
    expect(result.etf.btc.rows.at(-2)).toMatchObject({ direction: 'zero', magnitudePercent: 0 })
    expect(result.flowHistory?.rows[0]).toEqual({ tradingDate: '2026-08-11', funds: -23, btc: 24, eth: -24 })
    expect(result.flowHistory?.rows).toHaveLength(7)
  })

  it('does not fabricate chart dates when persisted daily capital history is missing or does not share five dates', () => {
    const snapshot = etfSnapshot()
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: snapshot,
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0,
        dailyFlows: stablecoinRows().slice(0, 4)
      }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', etf: { state: 'available' } })
    if (result.state !== 'available') throw new Error('expected safe state')
    expect(result.flowHistory).toBeUndefined()
  })

  it('keeps a malformed ETF DTO unavailable without affecting verified stablecoin facts', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial',
      etf: { ...etfSnapshot(), btc: { ...etfSnapshot().btc, asset: 'ETH' } },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', currentUsd: '$254.9B', etf: 'unavailable' })
  })

  it('keeps a complete zero-flow ETF window available for explicit zero-axis bars', () => {
    const snapshot = etfSnapshot()
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial',
      etf: {
        ...snapshot,
        btc: { ...snapshot.btc, rows: snapshot.btc.rows.map((row) => ({ ...row, netFlowUsd: 0 })) },
        eth: { ...snapshot.eth, rows: snapshot.eth.rows.map((row) => ({ ...row, netFlowUsd: 0 })) }
      },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    expect(result).toMatchObject({
      state: 'available',
      etf: { state: 'available', btc: { latestNetFlowUsd: '$0' }, eth: { latestNetFlowUsd: '$0' } }
    })
    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected zero-flow ETF presentation')
    expect(result.etf.btc.rows.every((row) => row.direction === 'zero' && row.magnitudePercent === 0)).toBe(true)
  })

  it.each([
    [{ state: 'empty', asOf }, { state: 'empty' }],
    [{ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.POSITIVE_INFINITY, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.MAX_VALUE, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: '2026-08-18T07:00:00Z', verifiedAt: asOf, currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }]
  ])('fails closed for unsafe safe-query variants', (input, expected) => {
    expect(projectDashboardCapitalConditionsSnapshot(input, asOf)).toEqual(expected)
  })

  it('projects negative zero signed facts as ordinary unsigned zero', () => {
    expect(projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, etf: { state: 'unavailable' }, conclusion: 'partial',
      coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: 1, change1dUsd: -0, change1dPercent: -0, change7dUsd: -0, change7dPercent: -0, change30dUsd: -0, change30dPercent: -0 }
    }, asOf)).toEqual({
      state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: asOf, currentUsd: '$1',
      change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%'
    })
  })

  it('owns the accepted compact number policy without using it for conclusion logic', () => {
    expect(dashboardCapitalConditionsPresentationPolicy).toMatchObject({
      usd: {
        maximumFractionDigits: 1,
        compactUnits: [
          { suffix: 'B', threshold: 1_000_000_000 },
          { suffix: 'M', threshold: 1_000_000 },
          { suffix: 'K', threshold: 1_000 }
        ]
      },
      percent: { fractionDigits: 2, includePositiveSign: true }
    })
  })

  it.each([
    [999, '$999'],
    [1_000, '$1K'],
    [1_000_000, '$1M'],
    [1_000_000_000, '$1B']
  ])('keeps the named compact-unit boundary for %d USD', (currentUsd, expected) => {
    expect(projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, etf: { state: 'unavailable' }, conclusion: 'partial',
      coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)).toMatchObject({ state: 'available', currentUsd: expected })
  })
})

function etfSnapshot(length = 30) {
  const dates = Array.from({ length }, (_, index) => new Date(Date.parse('2026-07-19T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const observedAt = '2026-08-18T07:00:00.000Z'
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter' as const, windowEnd: dates.at(-1)!, verifiedAt: observedAt,
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 28 ? 0 : index + 1, observedAt })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 28 ? 0 : -(index + 1), observedAt })) }
  }
}

function stablecoinRows() {
  const dates = Array.from({ length: 30 }, (_, index) => new Date(Date.parse('2026-07-19T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  return dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 0 ? 100 : -index }))
}
