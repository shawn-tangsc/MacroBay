import { describe, expect, it, vi } from 'vitest'

import type { CapitalConditionsSnapshotResult, FundingRateHistoryResult } from '../../../contracts/intelligenceQueryContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import {
  backfillDailyBriefFact,
  createDailyBriefBackfillExecutor,
  isDailyBriefBackfillResult,
  type DailyBriefBackfillDeps
} from './dailyBriefBackfill'

const cutoff = '2026-10-30T00:00:00.000Z'

function capital(overrides: Partial<Extract<CapitalConditionsSnapshotResult, { state: 'available' }>> = {}): CapitalConditionsSnapshotResult {
  return {
    state: 'available',
    asOf: cutoff,
    etf: {
      state: 'available',
      schemaVersion: 1,
      sourceId: '0xrouter',
      windowEnd: '2026-10-29',
      verifiedAt: '2026-10-29T22:00:00.000Z',
      btc: {
        asset: 'BTC',
        rows: [
          { tradingDate: '2026-10-28', netFlowUsd: -10, observedAt: '2026-10-28T22:00:00.000Z' },
          { tradingDate: '2026-10-29', netFlowUsd: 250_000_000, observedAt: '2026-10-29T22:00:00.000Z' }
        ]
      },
      eth: {
        asset: 'ETH',
        rows: [
          { tradingDate: '2026-10-28', netFlowUsd: 5, observedAt: '2026-10-28T22:00:00.000Z' },
          { tradingDate: '2026-10-29', netFlowUsd: -30_000_000, observedAt: '2026-10-29T22:00:00.000Z' }
        ]
      }
    },
    coreStablecoins: {
      observedAt: '2026-10-29T23:00:00.000Z',
      verifiedAt: '2026-10-29T23:01:00.000Z',
      currentUsd: 253_033_903_673.4,
      change1dUsd: 1,
      change1dPercent: 0.1,
      change7dUsd: 1,
      change7dPercent: 0.1,
      change30dUsd: 1,
      change30dPercent: 0.1
    },
    conclusion: 'partial',
    ...overrides
  }
}

function funding(): FundingRateHistoryResult {
  return {
    state: 'available',
    asOf: cutoff,
    btc: [
      { observedAt: '2026-10-29T16:00:00.000Z', ratePercent: 0.009 },
      { observedAt: '2026-10-29T23:59:59.999Z', ratePercent: 0.01 }
    ],
    eth: [{ observedAt: '2026-10-29T16:00:00.000Z', ratePercent: 0.004 }]
  }
}

function openInterest(): OpenInterestHistoryResult {
  return {
    state: 'available',
    asOf: cutoff,
    window: '24h',
    btc: [{ observedAt: '2026-10-29T23:45:00.000Z', notionalUsd: 1_200_000_000 }],
    eth: [{ observedAt: '2026-10-29T23:45:00.000Z', notionalUsd: 800_000_000 }],
    liquidationHintsState: 'unavailable'
  }
}

function deps(overrides: Partial<DailyBriefBackfillDeps> = {}): DailyBriefBackfillDeps {
  return {
    cutoff,
    capital: vi.fn(async () => capital()),
    funding: vi.fn(async () => funding()),
    openInterest: vi.fn(async () => openInterest()),
    now: () => '2026-10-30T13:00:00.000Z',
    ...overrides
  }
}

describe('daily brief backfill', () => {
  it('rejects an asOf after the cutoff before touching any store', async () => {
    const d = deps()
    const result = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: '2026-10-30T00:00:00.001Z' },
      d
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(d.capital).not.toHaveBeenCalled()
    expect(d.funding).not.toHaveBeenCalled()
    expect(d.openInterest).not.toHaveBeenCalled()
  })

  it('returns the stablecoin level as it stood at the cutoff, with its observation time and method', async () => {
    const result = await backfillDailyBriefFact({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff }, deps())
    expect(result).toEqual({
      state: 'available',
      source: 'stablecoin',
      metric: 'core-stablecoin-supply-usd',
      asOf: cutoff,
      value: 253_033_903_673.4,
      unit: 'usd',
      observedAt: '2026-10-29T23:00:00.000Z',
      sourceUrl: 'https://stablecoins.llama.fi/stablecoins',
      method: 'capital-conditions-as-of-snapshot'
    })
    expect(isDailyBriefBackfillResult(result)).toBe(true)
  })

  it('picks only ETF rows observed at or before the instant', async () => {
    const result = await backfillDailyBriefFact({ source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff }, deps())
    expect(result).toMatchObject({ state: 'available', value: 250_000_000, observedAt: '2026-10-29T22:00:00.000Z' })

    const early = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: '2026-10-29T21:00:00.000Z' },
      deps()
    )
    expect(early).toMatchObject({ state: 'available', value: -10, observedAt: '2026-10-28T22:00:00.000Z' })
  })

  it('reads funding and open interest at the requested instant', async () => {
    await expect(backfillDailyBriefFact({ source: 'funding', metric: 'funding-rate-percent-btc', asOf: cutoff }, deps()))
      .resolves.toMatchObject({ state: 'available', value: 0.01, observedAt: '2026-10-29T23:59:59.999Z', unit: 'percent' })
    await expect(backfillDailyBriefFact({ source: 'open-interest', metric: 'open-interest-usd-eth', asOf: cutoff }, deps()))
      .resolves.toMatchObject({ state: 'available', value: 800_000_000, observedAt: '2026-10-29T23:45:00.000Z', unit: 'usd' })
  })

  it('answers a named gap, without inventing a number, for metrics with no as-of read path', async () => {
    const d = deps()
    for (const [source, metric] of [
      ['dxy', 'dxy-level'],
      ['gold', 'gold-level-usd'],
      ['treasury', 'us10y-yield-percent'],
      ['treasury', 'us10y-real-yield-percent']
    ] as const) {
      const result = await backfillDailyBriefFact({ source, metric, asOf: cutoff }, d)
      expect(result).toMatchObject({ state: 'unavailable', source, metric, gapCode: 'historical-as-of-unavailable' })
      expect('value' in result).toBe(false)
    }
    expect(d.capital).not.toHaveBeenCalled()
  })

  it('refuses an observation newer than the requested instant', async () => {
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: '2026-10-29T22:30:00.000Z' },
      deps()
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'not-visible-as-of' })
  })

  it('rejects an unknown metric and an unreadable asOf', async () => {
    await expect(backfillDailyBriefFact({ source: 'dxy', metric: 'dxy-close', asOf: cutoff }, deps()))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'unknown-metric' })
    await expect(backfillDailyBriefFact({ source: 'etf', metric: 'etf-net-flow-btc', asOf: '2026-10-30' }, deps()))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'invalid-as-of' })
  })

  it('turns a throwing store read into a query gap instead of a failed turn', async () => {
    const result = await backfillDailyBriefFact(
      { source: 'funding', metric: 'funding-rate-percent-eth', asOf: cutoff },
      deps({ funding: async () => { throw new Error('store down') } })
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
  })

  it('binds the executor to the edition cutoff so a later call cannot read the future', async () => {
    const publicQuery = {
      queryCapitalConditionsSnapshot: vi.fn(async () => capital()),
      queryFundingRateHistory: vi.fn(async () => funding()),
      queryOpenInterestHistory: vi.fn(async () => openInterest())
    }
    const execute = createDailyBriefBackfillExecutor({ cutoff, publicQuery, now: () => '2026-10-30T13:00:00.000Z' })
    await expect(execute({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'available' })
    await expect(execute({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: '2026-10-30T00:00:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(publicQuery.queryCapitalConditionsSnapshot).toHaveBeenCalledTimes(1)
    expect(publicQuery.queryCapitalConditionsSnapshot).toHaveBeenCalledWith({ asOf: cutoff, allowStale: true })
  })
})
