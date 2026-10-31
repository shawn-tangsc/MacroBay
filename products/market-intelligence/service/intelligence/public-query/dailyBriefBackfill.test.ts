import { describe, expect, it, vi } from 'vitest'

import type { CapitalConditionsSnapshotResult, FundingRateHistoryResult } from '../../../contracts/intelligenceQueryContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import {
  backfillDailyBriefFact,
  createDailyBriefBackfillExecutor,
  isDailyBriefBackfillResult,
  type DailyBriefBackfillDeps
} from './dailyBriefBackfill'
import type { EtfHistoryAsOfReading } from './etfHistoryAsOf'
import type { MacroHistoryAsOfReading, MacroHistoryAsOfSeries } from './macroHistoryAsOf'
import type { StablecoinHistoryAsOfResult, StablecoinHistoryAssetPoint } from './stablecoinHistoryAsOf'

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

/** The 08:00 edition's own macro levels — what the stores held at the cutoff. */
const MACRO_AT_CUTOFF: Readonly<Record<MacroHistoryAsOfSeries, Omit<MacroHistoryAsOfReading, 'state' | 'series' | 'asOf'>>> = {
  dxy: {
    seriesId: 'dxy-real', value: 100.2, observedAt: '2026-10-29T23:55:00.000Z',
    method: 'dxy-store-as-of', sourceUrl: 'https://api.realmarketapi.com/api/v1/price'
  },
  gold: {
    seriesId: 'xau-usd', value: 4150.25, observedAt: '2026-10-29T23:50:00.000Z',
    method: 'gold-store-as-of', sourceUrl: 'https://api.realmarketapi.com/api/v1/price'
  },
  us10y: {
    seriesId: 'DGS10', value: 4.15, observedAt: '2026-10-29T00:00:00.000Z', period: '2026-10-29',
    method: 'fred-daily-close-as-of', sourceUrl: 'https://fred.stlouisfed.org/series/DGS10'
  },
  'us10y-real': {
    seriesId: 'DFII10', value: 1.85, observedAt: '2026-10-29T00:00:00.000Z', period: '2026-10-29',
    method: 'fred-daily-close-as-of', sourceUrl: 'https://fred.stlouisfed.org/series/DFII10'
  }
}

/**
 * The stored history as the projection answers it: the cutoff instant gets the 08:00 levels, and any
 * instant after it gets the evening's — so a backfill that read "now" instead of `asOf` would state a
 * number this fixture can tell apart.
 */
function macroLevelAt(input: Readonly<{ series: MacroHistoryAsOfSeries; asOf: string }>): MacroHistoryAsOfReading {
  const level = MACRO_AT_CUTOFF[input.series]
  const afterCutoff = input.asOf > cutoff
  return {
    state: 'available',
    series: input.series,
    asOf: input.asOf,
    ...level,
    ...(afterCutoff ? { value: level.value + 1, observedAt: '2026-10-30T12:55:00.000Z' } : {})
  }
}

/** The async reader the tool takes. */
function macroHistory() {
  return vi.fn(async (input: Readonly<{ series: MacroHistoryAsOfSeries; asOf: string }>) => macroLevelAt(input))
}

/** The synchronous read the public query service exposes. */
function macroHistoryQuery() {
  return vi.fn((input: Readonly<{ series: MacroHistoryAsOfSeries; asOf: string }>) => macroLevelAt(input))
}

function deps(overrides: Partial<DailyBriefBackfillDeps> = {}): DailyBriefBackfillDeps {
  return {
    cutoff,
    capital: vi.fn(async () => capital()),
    funding: vi.fn(async () => funding()),
    openInterest: vi.fn(async () => openInterest()),
    macroHistory: macroHistory(),
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
    expect(d.macroHistory).not.toHaveBeenCalled()
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

  it('answers the dollar, gold and both 10-year yields from stored history at the cutoff', async () => {
    const d = deps()
    const dxy = await backfillDailyBriefFact({ source: 'dxy', metric: 'dxy-level', asOf: cutoff }, d)
    expect(dxy).toEqual({
      state: 'available', source: 'dxy', metric: 'dxy-level', asOf: cutoff, value: 100.2, unit: 'level',
      observedAt: '2026-10-29T23:55:00.000Z', method: 'dxy-store-as-of',
      sourceUrl: 'https://api.realmarketapi.com/api/v1/price'
    })
    expect(isDailyBriefBackfillResult(dxy)).toBe(true)
    await expect(backfillDailyBriefFact({ source: 'gold', metric: 'gold-level-usd', asOf: cutoff }, d))
      .resolves.toMatchObject({ state: 'available', value: 4150.25, unit: 'level', method: 'gold-store-as-of' })
    await expect(backfillDailyBriefFact({ source: 'treasury', metric: 'us10y-yield-percent', asOf: cutoff }, d))
      .resolves.toMatchObject({ state: 'available', value: 4.15, unit: 'percent', observedAt: '2026-10-29T00:00:00.000Z' })
    await expect(backfillDailyBriefFact({ source: 'treasury', metric: 'us10y-real-yield-percent', asOf: cutoff }, d))
      .resolves.toMatchObject({ state: 'available', value: 1.85, unit: 'percent' })
    // The four requests read the store at the requested instant, never at "now".
    expect(d.macroHistory).toHaveBeenCalledWith({ series: 'dxy', asOf: cutoff })
    expect(d.capital).not.toHaveBeenCalled()
  })

  it('answers historical-as-of-unavailable, not the current snapshot, when no stored history exists', async () => {
    // No historical reader in this build at all.
    const unwired = deps({ macroHistory: async () => undefined })
    const missingReader = await backfillDailyBriefFact({ source: 'dxy', metric: 'dxy-level', asOf: cutoff }, unwired)
    expect(missingReader).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in missingReader).toBe(false)

    // A reader that is wired but holds nothing at or before the instant says the same thing.
    const empty = deps({ macroHistory: async (input) => ({
      state: 'unavailable' as const, series: input.series, asOf: input.asOf,
      gapCode: 'historical-as-of-unavailable' as const, detail: 'the store holds no point at or before this instant.'
    }) })
    for (const [source, metric] of [
      ['dxy', 'dxy-level'],
      ['gold', 'gold-level-usd'],
      ['treasury', 'us10y-yield-percent'],
      ['treasury', 'us10y-real-yield-percent']
    ] as const) {
      const result = await backfillDailyBriefFact({ source, metric, asOf: cutoff }, empty)
      expect(result).toMatchObject({ state: 'unavailable', source, metric, gapCode: 'historical-as-of-unavailable' })
      expect('value' in result).toBe(false)
    }
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
      queryOpenInterestHistory: vi.fn(async () => openInterest()),
      queryMacroHistoryAsOf: macroHistoryQuery()
    }
    const execute = createDailyBriefBackfillExecutor({ cutoff, publicQuery, now: () => '2026-10-30T13:00:00.000Z' })
    await expect(execute({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'available' })
    await expect(execute({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: '2026-10-30T00:00:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(publicQuery.queryCapitalConditionsSnapshot).toHaveBeenCalledTimes(1)
    expect(publicQuery.queryCapitalConditionsSnapshot).toHaveBeenCalledWith({ asOf: cutoff, allowStale: true })
  })

  it('fills an 08:00 edition generated at 21:00 with the 08:00 macro level, not the evening one', async () => {
    const publicQuery = {
      queryCapitalConditionsSnapshot: vi.fn(async () => capital()),
      queryFundingRateHistory: vi.fn(async () => funding()),
      queryOpenInterestHistory: vi.fn(async () => openInterest()),
      queryMacroHistoryAsOf: macroHistoryQuery()
    }
    // 08:00 Asia/Shanghai = 00:00Z; 21:00 the same day = 13:00Z.
    const execute = createDailyBriefBackfillExecutor({ cutoff, publicQuery, now: () => '2026-10-30T13:00:00.000Z' })

    const backfilled = await execute({ source: 'dxy', metric: 'dxy-level', asOf: cutoff })
    expect(backfilled).toMatchObject({
      state: 'available', value: 100.2, observedAt: '2026-10-29T23:55:00.000Z'
    })
    expect(publicQuery.queryMacroHistoryAsOf).toHaveBeenCalledWith({ series: 'dxy', asOf: cutoff })

    // Asking for the evening instant is refused by the cutoff, so the market the edition never saw
    // cannot be imported into it — the fixture's evening level (+1) is unreachable through this tool.
    await expect(execute({ source: 'dxy', metric: 'dxy-level', asOf: '2026-10-30T12:55:00.000Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(publicQuery.queryMacroHistoryAsOf).toHaveBeenCalledTimes(1)
  })
})

/** An ETF flow-history answer as the standalone reader returns it. */
function etfHistoryReading(asset: 'btc' | 'eth'): EtfHistoryAsOfReading {
  return Object.freeze({
    state: 'available',
    asset,
    asOf: cutoff,
    value: asset === 'btc' ? 250_000_000 : -30_000_000,
    tradingDate: '2026-10-29',
    observedAt: '2026-10-29T00:00:00.000Z',
    sourceUrl: `https://0xrouter.app/cexdata/etf/${asset === 'btc' ? 'bitcoin' : 'ethereum'}/flow-history`,
    method: 'historical-api'
  })
}

/** A per-asset core-supply answer as the standalone reader returns it. */
function stablecoinHistoryReading(): Extract<StablecoinHistoryAsOfResult, { state: 'available' }> {
  return Object.freeze({
    state: 'available' as const,
    asOf: cutoff,
    value: 251_995_000_000,
    observedAt: '2026-10-30T00:00:00.000Z',
    components: Object.freeze([
      Object.freeze({
        assetId: '1' as const, symbol: 'USDT' as const, value: 180_000_000_000,
        tradingDate: '2026-10-29', observedAt: '2026-10-30T00:00:00.000Z',
        sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1'
      }),
      Object.freeze({
        assetId: '2' as const, symbol: 'USDC' as const, value: 71_995_000_000,
        tradingDate: '2026-10-29', observedAt: '2026-10-30T00:00:00.000Z',
        sourceUrl: 'https://stablecoins.llama.fi/stablecoin/2'
      })
    ]) as readonly [StablecoinHistoryAssetPoint, StablecoinHistoryAssetPoint],
    sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1',
    method: 'historical-api' as const
  })
}

describe('daily brief backfill: core stablecoin from the per-asset series', () => {
  const emptyCapital = async (): Promise<CapitalConditionsSnapshotResult> => Object.freeze({ state: 'empty' as const, asOf: cutoff })

  it('fills the core level only when both per-asset histories answer', async () => {
    const stablecoinHistory = vi.fn(async () => stablecoinHistoryReading())
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: emptyCapital, stablecoinHistory })
    )

    expect(result).toEqual({
      state: 'available',
      source: 'stablecoin',
      metric: 'core-stablecoin-supply-usd',
      asOf: cutoff,
      value: 251_995_000_000,
      unit: 'usd',
      observedAt: '2026-10-30T00:00:00.000Z',
      sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1',
      method: 'historical-api'
    })
    expect(isDailyBriefBackfillResult(result)).toBe(true)
    expect(stablecoinHistory).toHaveBeenCalledWith({ asOf: cutoff })
  })

  it('keeps a stored official point ahead of the public series', async () => {
    const stablecoinHistory = vi.fn(async () => stablecoinHistoryReading())
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ stablecoinHistory })
    )
    expect(result).toMatchObject({
      state: 'available', value: 253_033_903_673.4, method: 'capital-conditions-as-of-snapshot'
    })
    expect(stablecoinHistory).not.toHaveBeenCalled()
  })

  it('keeps the gap when one asset is missing, without a half-core value', async () => {
    const missingUsdc: StablecoinHistoryAsOfResult = Object.freeze({
      state: 'unavailable' as const, asOf: cutoff, gapCode: 'historical-api-unavailable' as const,
      detail: 'the DefiLlama USDC per-asset history request was refused (response-unavailable).'
    })
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: emptyCapital, stablecoinHistory: async () => missingUsdc })
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in result).toBe(false)
    expect(result.state === 'unavailable' ? result.detail : '').toMatch(/USDC/)
  })

  it('does not read around a capital query that answered unavailable', async () => {
    const stablecoinHistory = vi.fn(async () => stablecoinHistoryReading())
    const unavailableQuery = async (): Promise<CapitalConditionsSnapshotResult> =>
      Object.freeze({ state: 'unavailable' as const, failureCode: 'capital-conditions-query-unavailable' as const })
    await expect(backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: unavailableQuery, stablecoinHistory })
    )).resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect(stablecoinHistory).not.toHaveBeenCalled()
  })

  it('validates asOf against the cutoff before asking for either asset', async () => {
    const stablecoinHistory = vi.fn(async () => stablecoinHistoryReading())
    const capitalQuery = vi.fn(emptyCapital)
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: '2026-10-30T00:00:00.001Z' },
      deps({ capital: capitalQuery, stablecoinHistory })
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(stablecoinHistory).not.toHaveBeenCalled()
    expect(capitalQuery).not.toHaveBeenCalled()
  })

  it('turns a throwing history read into a query gap instead of a failed turn', async () => {
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: emptyCapital, stablecoinHistory: async () => { throw new Error('socket closed') } })
    )
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
  })
})

describe('daily brief backfill: public history when the store holds nothing', () => {
  const emptyCapital = async (): Promise<CapitalConditionsSnapshotResult> => Object.freeze({ state: 'empty' as const, asOf: cutoff })

  it('keeps the core stablecoin gap instead of substituting the wider aggregate series', async () => {
    const result = await backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: emptyCapital })
    )
    expect(result).toMatchObject({
      state: 'unavailable',
      source: 'stablecoin',
      metric: 'core-stablecoin-supply-usd',
      asOf: cutoff,
      gapCode: 'historical-api-unavailable'
    })
    expect('value' in result).toBe(false)
    // The gap names the reason: no same-metric per-asset history is wired, and the core level is
    // never rebuilt from a wider series.
    expect(result.state === 'unavailable' ? result.detail : '').toMatch(/per-asset|core/i)
  })

  it('asks the public history for exactly the requested ETF asset', async () => {
    const etfHistory = vi.fn(async (request: Readonly<{ asset: 'btc' | 'eth'; asOf: string }>) => etfHistoryReading(request.asset))
    const btc = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff },
      deps({ capital: emptyCapital, etfHistory })
    )
    const eth = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-eth', asOf: cutoff },
      deps({ capital: emptyCapital, etfHistory })
    )
    expect(btc).toEqual({
      state: 'available',
      source: 'etf',
      metric: 'etf-net-flow-btc',
      asOf: cutoff,
      value: 250_000_000,
      unit: 'flow-usd',
      observedAt: '2026-10-29T00:00:00.000Z',
      sourceUrl: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history',
      method: 'historical-api'
    })
    expect(isDailyBriefBackfillResult(btc)).toBe(true)
    expect(eth).toMatchObject({ state: 'available', value: -30_000_000, method: 'historical-api' })
    expect(etfHistory).toHaveBeenCalledWith({ asset: 'btc', asOf: cutoff })
    expect(etfHistory).toHaveBeenCalledWith({ asset: 'eth', asOf: cutoff })
  })

  it('keeps a stored ETF row ahead of the public history', async () => {
    const etfHistory = vi.fn(async (request: Readonly<{ asset: 'btc' | 'eth' }>) => etfHistoryReading(request.asset))
    const result = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff },
      deps({ etfHistory })
    )
    expect(result).toMatchObject({ state: 'available', value: 250_000_000, method: 'etf-current-state-as-of' })
    expect(etfHistory).not.toHaveBeenCalled()
  })

  it('does not read around a capital query that answered unavailable', async () => {
    const etfHistory = vi.fn(async (request: Readonly<{ asset: 'btc' | 'eth' }>) => etfHistoryReading(request.asset))
    const unavailableQuery = async (): Promise<CapitalConditionsSnapshotResult> =>
      Object.freeze({ state: 'unavailable' as const, failureCode: 'capital-conditions-query-unavailable' as const })
    await expect(backfillDailyBriefFact(
      { source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: cutoff },
      deps({ capital: unavailableQuery })
    )).resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    await expect(backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff },
      deps({ capital: unavailableQuery, etfHistory })
    )).resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect(etfHistory).not.toHaveBeenCalled()
  })

  it('names the gap when the public history holds no row at or before the instant', async () => {
    const etfHistory = async (request: Readonly<{ asset: 'btc' | 'eth' }>) => Object.freeze({
      state: 'unavailable' as const, asset: request.asset, asOf: cutoff, gapCode: 'historical-as-of-unavailable' as const,
      detail: 'the ETF flow history holds no trading day that had ended by this instant.'
    })
    const etf = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-eth', asOf: cutoff },
      deps({ capital: emptyCapital, etfHistory })
    )
    expect(etf).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in etf).toBe(false)
  })

  it('answers historical-api-unavailable when no public interface is wired', async () => {
    const etf = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff },
      deps({ capital: emptyCapital })
    )
    expect(etf).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in etf).toBe(false)
  })

  it('never fabricates a value when the public history request fails', async () => {
    const throwing = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-btc', asOf: cutoff },
      deps({ capital: emptyCapital, etfHistory: async () => { throw new Error('network down') } })
    )
    expect(throwing).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect('value' in throwing).toBe(false)

    const refused = await backfillDailyBriefFact(
      { source: 'etf', metric: 'etf-net-flow-eth', asOf: cutoff },
      deps({
        capital: emptyCapital,
        etfHistory: async () => Object.freeze({
          state: 'unavailable' as const, asset: 'eth', asOf: cutoff, gapCode: 'query-unavailable' as const,
          detail: 'the ETF flow-history request was refused.'
        })
      })
    )
    expect(refused).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect('value' in refused).toBe(false)
  })

  it('validates the instant against the cutoff before any public request', async () => {
    const etfHistory = vi.fn(async (request: Readonly<{ asset: 'btc' | 'eth' }>) => etfHistoryReading(request.asset))
    const capitalQuery = vi.fn(emptyCapital)
    const d = deps({ capital: capitalQuery, etfHistory })
    const future = '2026-10-30T00:00:00.001Z'
    await expect(backfillDailyBriefFact({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf: future }, d))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    await expect(backfillDailyBriefFact({ source: 'etf', metric: 'etf-net-flow-btc', asOf: future }, d))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(etfHistory).not.toHaveBeenCalled()
    expect(capitalQuery).not.toHaveBeenCalled()
  })
})
