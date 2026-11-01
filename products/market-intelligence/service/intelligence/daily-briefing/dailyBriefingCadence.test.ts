import { describe, expect, it } from 'vitest'

import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { MacroRatesSnapshotView } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { buildBriefingReadingRows, rowCadence } from './dailyBriefingMarketRows'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

// Monday 2026-11-02T00:30Z: Sunday evening in New York, so Friday's session is the newest close.
const mondayAsOf = '2026-11-02T00:30:00.000Z'

const fearGreed = (observedAt: string, score = 48): FearGreedSnapshotResult => ({
  state: 'available', asOf: mondayAsOf, score, bucket: 'fear', observedAt
})

const funding: FundingRateHistoryResult = {
  state: 'available', asOf: mondayAsOf,
  btc: [
    { observedAt: '2026-11-01T00:00:00.000Z', ratePercent: 0.0079 },
    { observedAt: '2026-11-02T00:00:00.000Z', ratePercent: 0.0087 }
  ],
  eth: [
    { observedAt: '2026-11-01T00:00:00.000Z', ratePercent: 0.0049 },
    { observedAt: '2026-11-02T00:00:00.000Z', ratePercent: 0.0059 }
  ]
}

const capital = (tradingDate: string): CapitalConditionsSnapshotResult => ({
  state: 'available', asOf: mondayAsOf,
  etf: {
    state: 'available', schemaVersion: 1, sourceId: '0xrouter', windowEnd: tradingDate, verifiedAt: mondayAsOf,
    btc: { asset: 'BTC', rows: [{ tradingDate, netFlowUsd: 110_300_000, observedAt: `${tradingDate}T00:00:00.000Z` }] },
    eth: { asset: 'ETH', rows: [{ tradingDate, netFlowUsd: -88_600_000, observedAt: `${tradingDate}T00:00:00.000Z` }] }
  },
  coreStablecoins: {
    observedAt: '2026-11-02T00:12:00.000Z', verifiedAt: mondayAsOf,
    currentUsd: 253_033_903_673.4, change1dUsd: -843_904_300.6, change1dPercent: -0.3324,
    change7dUsd: -2_075_176_969.6, change7dPercent: -0.8134,
    change30dUsd: -5_877_104_441.1, change30dPercent: -2.2699
  },
  conclusion: 'partial'
})

type PacketInput = Readonly<{
  asOf?: string
  fearGreed?: FearGreedSnapshotResult
  capital?: CapitalConditionsSnapshotResult
  dxyAt?: string
  rates?: MacroRatesSnapshotView | undefined
}>

const packet = (input: PacketInput = {}): DailyBriefingFactPacket => {
  const asOf = input.asOf ?? mondayAsOf
  return {
    asOf,
    windowStart: new Date(Date.parse(asOf) - 24 * 60 * 60 * 1_000).toISOString(),
    windowEnd: asOf,
    windowHours: 24,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    conclusion: null,
    news: { state: 'empty', items: [] },
    calendar: { state: 'available', events: [] },
    readings: {
      fearGreed: input.fearGreed ?? fearGreed('2026-11-02T00:00:00.000Z'),
      funding,
      capital: input.capital ?? capital('2026-10-30')
    },
    market: {
      crossAsset: {
        analysisEnd: asOf,
        closedReturns: {
          btc: { '24h': { state: 'available', value: -1.1 } },
          eth: { '24h': { state: 'available', value: -1.18 } },
          index: { '24h': { state: 'available', value: 0.82 } }
        }
      } as unknown as CrossAssetSnapshot,
      macroMarket: {
        state: 'available',
        readings: [
          { seriesId: 'dxy-real', level: 102.2, atMs: Date.parse(input.dxyAt ?? '2026-10-30T21:00:00.000Z'), returns: { '24h': 0.43 } },
          { seriesId: 'xau-usd', level: 3996, atMs: Date.parse(input.dxyAt ?? '2026-10-30T21:00:00.000Z'), returns: { '24h': -0.54 } }
        ]
      } as unknown as MacroMarketSnapshotView,
      macroRates: input.rates ?? {
        state: 'available',
        readings: [
          { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, previous: 4.96, period: '2026-10-30' },
          { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 1.8, previous: 1.77, period: '2026-10-30' }
        ]
      } as unknown as MacroRatesSnapshotView
    },
    enabled: { fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true }
  }
}

describe('daily briefing observation cadence', () => {
  it('names a cadence for every row, and covers only the three cadences', () => {
    expect(Object.values(rowCadence)).toEqual(expect.arrayContaining(['24h', 'trading-day', 'publication-day']))
    expect(new Set(Object.values(rowCadence))).toEqual(new Set(['24h', 'trading-day', 'publication-day']))
    expect(rowCadence['us10y']).toBe('trading-day')
    expect(rowCadence['etf-btc']).toBe('trading-day')
    expect(rowCadence.btc).toBe('24h')
    expect(rowCadence['fear-greed']).toBe('publication-day')
  })

  it('takes Friday close as the Monday baseline for the dollar, gold and the ten-year', () => {
    const rows = buildBriefingReadingRows(packet())
    const tenYear = rows.market.find((row) => row.id === 'us10y')
    const dollar = rows.market.find((row) => row.id === 'dxy')
    const gold = rows.market.find((row) => row.id === 'gold')

    // Friday's close is the previous session: a 56-hour-old observation is not stale.
    expect(dollar).toMatchObject({ state: 'available', cadence: 'trading-day', window: 'trading-day', value: { number: 0.43 } })
    expect(gold).toMatchObject({ state: 'available', cadence: 'trading-day', value: { number: -0.54 } })
    expect(tenYear).toMatchObject({
      state: 'available',
      cadence: 'trading-day',
      change: { value: 4, unit: 'bp', window: 'trading-day' },
      baselineAt: '2026-10-29T00:00:00.000Z'
    })
  })

  it('keeps a trading-day row readable through a market holiday', () => {
    // Martin Luther King Jr. Day: Monday 2026-01-19 has no session, so Friday 01-16 is the newest close.
    const asOf = '2026-01-19T14:00:00.000Z'
    const rows = buildBriefingReadingRows(packet({
      asOf,
      dxyAt: '2026-01-16T21:00:00.000Z',
      fearGreed: fearGreed('2026-01-19T00:00:00.000Z'),
      rates: {
        state: 'available',
        readings: [
          { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, previous: 4.96, period: '2026-01-16' }
        ]
      } as unknown as MacroRatesSnapshotView
    }))
    expect(rows.market.find((row) => row.id === 'dxy')).toMatchObject({ state: 'available' })
    expect(rows.market.find((row) => row.id === 'us10y')).toMatchObject({
      state: 'available',
      baselineAt: '2026-01-15T00:00:00.000Z'
    })
  })

  it('gaps a trading-day row only when sessions that should have printed are missing', () => {
    // A week of missing closes is a gap, not a weekend.
    const rows = buildBriefingReadingRows(packet({
      asOf: '2026-01-23T00:30:00.000Z',
      rates: {
        state: 'available',
        readings: [
          { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, previous: 4.96, period: '2026-01-14' }
        ]
      } as unknown as MacroRatesSnapshotView
    }))
    expect(rows.market.find((row) => row.id === 'us10y')).toMatchObject({ state: 'stale', reason: 'stale-fallback' })
  })

  it('trusts the session calendar over the ETF wall-clock stale flag', () => {
    // Thursday's flow read on Monday is one session behind, not four days stale.
    const readable = buildBriefingReadingRows(packet({ capital: capital('2026-10-29') }))
    expect(readable.funds.find((row) => row.id === 'etf-btc')).toMatchObject({ state: 'available', cadence: 'trading-day' })

    // The same antique read a week later is a real gap.
    const missing = buildBriefingReadingRows(packet({
      asOf: '2026-11-09T00:30:00.000Z',
      capital: capital('2026-10-29'),
      fearGreed: fearGreed('2026-11-09T00:00:00.000Z')
    }))
    expect(missing.funds.find((row) => row.id === 'etf-btc')).toMatchObject({ state: 'stale' })
  })

  it('rolls a 24h window over the weekend for the 24/7 rows', () => {
    const rows = buildBriefingReadingRows(packet())
    expect(rows.market.find((row) => row.id === 'btc')).toMatchObject({ state: 'available', cadence: '24h', window: '24h' })
    expect(rows.funds.find((row) => row.id === 'funding-btc')).toMatchObject({
      cadence: '24h',
      change: { unit: 'pp', window: '24h' }
    })
    expect(rows.funds.find((row) => row.id === 'stablecoin')).toMatchObject({
      cadence: '24h',
      change: { unit: 'percent', window: '1d' }
    })
  })

  it('measures fear and greed against the previous publication, whatever day it was', () => {
    const rows = buildBriefingReadingRows(
      packet({ fearGreed: fearGreed('2026-11-02T00:00:00.000Z', 34) }),
      { score: 30, publishedAt: '2026-10-30T00:00:00.000Z' }
    )
    expect(rows.fearGreed).toMatchObject({
      cadence: 'publication-day',
      change: { value: 4, unit: 'points', window: 'publication-day' },
      baselineAt: '2026-10-30T00:00:00.000Z'
    })
  })

  it('states no-baseline instead of zero when there is no earlier publication or close', () => {
    const withoutPrevious = buildBriefingReadingRows(packet({ fearGreed: fearGreed('2026-11-02T00:00:00.000Z', 34) }))
    expect(withoutPrevious.fearGreed?.change).toBeNull()
    expect(withoutPrevious.fearGreed?.changeReason).toBe('no-baseline')

    // The ten-year without FRED's prior close has no baseline either — never a flat zero.
    const ratesWithoutPrevious = buildBriefingReadingRows(packet({
      rates: {
        state: 'available',
        readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, period: '2026-10-30' }]
      } as unknown as MacroRatesSnapshotView
    }))
    expect(ratesWithoutPrevious.market.find((row) => row.id === 'us10y')).toMatchObject({
      change: null,
      changeReason: 'no-baseline'
    })
  })
})
