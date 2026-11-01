import { describe, expect, it } from 'vitest'

import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from './intelligenceQueryContracts'
import { buildMarketPulseRows, marketPulsePolicy, type MarketPulseInput } from './marketPulse'

const asOf = '2026-10-27T09:50:00.000Z'

const fearGreed = (overrides: Partial<Extract<FearGreedSnapshotResult, { state: 'available' }>> = {}): FearGreedSnapshotResult => ({
  state: 'available',
  asOf,
  score: 48,
  bucket: 'fear',
  observedAt: '2026-10-27T00:00:00.000Z',
  ...overrides
})

const funding = (
  btc: readonly { observedAt: string; ratePercent: number }[],
  eth: readonly { observedAt: string; ratePercent: number }[] = btc
): FundingRateHistoryResult => ({ state: 'available', asOf, btc, eth })

const capital = (overrides: {
  etf?: 'available' | 'unavailable'
  tradingDate?: string
  observedAt?: string
} = {}): CapitalConditionsSnapshotResult => ({
  state: 'available',
  asOf,
  etf: overrides.etf === 'unavailable'
    ? { state: 'unavailable' }
    : {
      state: 'available',
      schemaVersion: 1,
      sourceId: '0xrouter',
      windowEnd: overrides.tradingDate ?? '2026-10-26',
      verifiedAt: '2026-10-27T09:41:37.673Z',
      btc: {
        asset: 'BTC',
        rows: [{
          tradingDate: overrides.tradingDate ?? '2026-10-26',
          netFlowUsd: 110_300_000,
          observedAt: `${overrides.tradingDate ?? '2026-10-26'}T00:00:00.000Z`
        }]
      },
      eth: {
        asset: 'ETH',
        rows: [{
          tradingDate: overrides.tradingDate ?? '2026-10-26',
          netFlowUsd: -88_600_000,
          observedAt: `${overrides.tradingDate ?? '2026-10-26'}T00:00:00.000Z`
        }]
      }
    },
  coreStablecoins: {
    observedAt: overrides.observedAt ?? '2026-10-27T09:24:59.689Z',
    verifiedAt: '2026-10-27T09:41:37.501Z',
    currentUsd: 253_033_903_673.4,
    change1dUsd: -843_904_300.6,
    change1dPercent: -0.3324,
    change7dUsd: -2_075_176_969.6,
    change7dPercent: -0.8134,
    change30dUsd: -5_877_104_441.1,
    change30dPercent: -2.2699
  },
  conclusion: 'partial'
})

const input = (overrides: Partial<MarketPulseInput> = {}): MarketPulseInput => ({
  asOf,
  enabled: { fearGreed: true, funding: true, stablecoin: true, etf: true },
  fearGreed: fearGreed(),
  funding: funding(
    [
      { observedAt: '2026-10-26T08:00:00.000Z', ratePercent: 0.007945 },
      { observedAt: '2026-10-27T08:00:00.000Z', ratePercent: 0.008696 }
    ],
    [
      { observedAt: '2026-10-26T08:00:00.000Z', ratePercent: 0.004911 },
      { observedAt: '2026-10-27T08:00:00.000Z', ratePercent: 0.005932 }
    ]
  ),
  capital: capital(),
  ...overrides
})

describe('market pulse rows', () => {
  it('flattens the four readings into six rows, in a stable order', () => {
    const rows = buildMarketPulseRows(input())

    expect(rows.map((row) => row.id)).toEqual([
      'fear-greed', 'funding-btc', 'funding-eth', 'stablecoin', 'etf-btc', 'etf-eth'
    ])
    expect(rows.every((row) => row.state === 'available')).toBe(true)
    expect(rows[0]).toMatchObject({
      labelKey: 'dailyBriefing.row.fearGreed',
      value: { number: 48, format: 'score' },
      window: 'latest',
      observedAt: '2026-10-27T00:00:00.000Z',
      change: null,
      changeReason: 'no-baseline'
    })
    expect(rows[1]).toMatchObject({
      value: { number: 0.008696, format: 'percent' },
      window: '24h',
      change: { unit: 'pp', window: '24h' }
    })
    expect(rows[1]?.change?.value).toBeCloseTo(0.000751, 6)
    expect(rows[2]?.change?.value).toBeCloseTo(0.001021, 6)
    expect(rows[3]).toMatchObject({
      value: { number: 253_033_903_673.4, format: 'usd' },
      change: { value: -0.3324, unit: 'percent', window: '1d' },
      window: '1d'
    })
    expect(rows[4]).toMatchObject({
      value: { number: 110_300_000, format: 'flow-usd' },
      window: 'trading-day',
      change: null
    })
    expect(rows[5]?.value?.number).toBe(-88_600_000)
  })

  it('marks a fear-greed reading stale after 36 hours but keeps the value', () => {
    const rows = buildMarketPulseRows(input({ fearGreed: fearGreed({ observedAt: '2026-10-25T20:00:00.000Z' }) }))
    expect(rows[0]).toMatchObject({ state: 'stale', value: { number: 48, format: 'score' } })
    expect(marketPulsePolicy.fearGreedStaleAfterMs).toBe(36 * 60 * 60 * 1_000)
  })

  it('marks funding stale after 12 hours', () => {
    const rows = buildMarketPulseRows(input({
      funding: funding([{ observedAt: '2026-10-26T20:00:00.000Z', ratePercent: 0.01 }])
    }))
    expect(rows[1]?.state).toBe('stale')
    expect(rows[2]?.state).toBe('stale')
  })

  it('does not fake a 24h funding change when there is no point older than 24h', () => {
    const rows = buildMarketPulseRows(input({
      funding: funding([
        { observedAt: '2026-10-27T00:00:00.000Z', ratePercent: 0.01 },
        { observedAt: '2026-10-27T08:00:00.000Z', ratePercent: 0.008 }
      ])
    }))
    expect(rows[1]?.state).toBe('available')
    expect(rows[1]?.change).toBeNull()
    expect(rows[1]?.changeReason).toBe('insufficient-window')
  })

  it('lets the reader switch win over a stored value', () => {
    const rows = buildMarketPulseRows(input({
      enabled: { fearGreed: false, funding: false, stablecoin: false, etf: false }
    }))
    expect(rows).toHaveLength(6)
    expect(rows.every((row) => row.state === 'source-disabled')).toBe(true)
    expect(rows.every((row) => row.value === null && row.change === null)).toBe(true)
  })

  it('carries the capital gate on the ETF rows instead of blaming the ETF source', () => {
    const rows = buildMarketPulseRows(input({
      capital: { state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' }
    }))
    expect(rows[3]).toMatchObject({ state: 'unavailable', reason: 'query-failed' })
    expect(rows[4]).toMatchObject({ state: 'unavailable', reason: 'capital-gate' })
    expect(rows[5]).toMatchObject({ state: 'unavailable', reason: 'capital-gate' })
  })

  it('keeps an unavailable ETF reading distinct from a disabled ETF source', () => {
    const rows = buildMarketPulseRows(input({ capital: capital({ etf: 'unavailable' }) }))
    expect(rows[4]).toMatchObject({ state: 'unavailable', reason: 'etf-unavailable' })
    const disabled = buildMarketPulseRows(input({
      capital: capital({ etf: 'unavailable' }),
      enabled: { fearGreed: true, funding: true, stablecoin: true, etf: false }
    }))
    expect(disabled[4]).toMatchObject({ state: 'source-disabled' })
    expect(disabled[5]).toMatchObject({ state: 'source-disabled' })
  })

  it('marks an ETF trading-day row stale after 96 hours', () => {
    const rows = buildMarketPulseRows(input({ capital: capital({ tradingDate: '2026-10-22' }) }))
    expect(rows[4]?.state).toBe('stale')
    expect(rows[4]?.value?.number).toBe(110_300_000)
  })

  it('reports empty and failed readings with distinct reasons', () => {
    const rows = buildMarketPulseRows(input({
      fearGreed: { state: 'empty', asOf },
      funding: { state: 'unavailable', failureCode: 'funding-rate-history-query-unavailable' },
      capital: { state: 'empty', asOf }
    }))
    expect(rows[0]).toMatchObject({ state: 'unavailable', reason: 'not-collected' })
    expect(rows[1]).toMatchObject({ state: 'unavailable', reason: 'query-failed' })
    expect(rows[3]).toMatchObject({ state: 'unavailable', reason: 'not-collected' })
    expect(rows[4]).toMatchObject({ state: 'unavailable', reason: 'capital-gate' })
  })

  it('normalizes negative zero rather than showing it as a value', () => {
    const rows = buildMarketPulseRows(input({
      fearGreed: { state: 'available', asOf, score: 0, bucket: 'extreme-fear', observedAt: '2026-10-27T00:00:00.000Z' },
      funding: funding([{ observedAt: '2026-10-27T08:00:00.000Z', ratePercent: -0 }])
    }))
    expect(Object.is(rows[1]?.value?.number, -0)).toBe(false)
    expect(rows[1]?.value?.number).toBe(0)
  })
})
