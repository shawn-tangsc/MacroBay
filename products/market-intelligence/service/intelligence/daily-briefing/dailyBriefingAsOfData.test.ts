import { describe, expect, it } from 'vitest'

import { createCapitalConditionsSnapshotQueryService } from '../capital-conditions/capitalConditionsSnapshotQuery'
import {
  createCapitalConditionsCurrentStateStore,
  createInMemoryCapitalConditionsStateStorage
} from '../capital-conditions/stablecoinCapitalCurrentStateStore'
import { buildEtfCurrentStateWindow } from '../etf/etfCurrentStateWindow'
import { createMacroHistoryAsOfQuery } from '../public-query/macroHistoryAsOf'
import { createEtfCurrentStateStore, createInMemoryEtfCurrentStateStorage } from '../store/etfCurrentStateStore'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import { createDailyBriefingSource, type DailyBriefingSourceDeps } from './dailyBriefingSource'

/**
 * The 10/31 failure, end to end: the edition is frozen at its 08:00 Beijing cutoff (00:00Z) but
 * generated at 21:00 (13:00Z). The conclusion and the backfill already read history as of the
 * cutoff; the data cards read the current snapshot and printed `—`. These tests build the real
 * packet from the real as-of readers and assert the document's data rows.
 */
const CUTOFF = '2026-10-31T00:00:00.000Z'
const DATE = '2026-10-31'
const TIME_ZONE = 'Asia/Shanghai'

type Point = Readonly<{ series: string; atMs: number; value: number }>

function macroStore(points: readonly Point[]) {
  const sorted = [...points].sort((left, right) => left.atMs - right.atMs)
  return {
    latestAt: (seriesId: string, atOrBeforeMs: number) => {
      const latest = sorted.filter((point) => point.series === seriesId && point.atMs <= atOrBeforeMs).at(-1)
      return latest ? { atMs: latest.atMs, value: latest.value } : undefined
    },
    series: (seriesId: string, fromMs: number, toMs: number) =>
      sorted.filter((point) => point.series === seriesId && point.atMs >= fromMs && point.atMs <= toMs)
  }
}

function capitalStore(input: Readonly<{
  history?: readonly Readonly<{ coreCurrentUsd: number; verifiedAt: string }>[]
}>) {
  const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
  return (async () => {
    for (const entry of input.history ?? []) {
      await store.recordSuccess({
        snapshot: {
          coreCurrentUsd: entry.coreCurrentUsd, change1dUsd: 1, change1dPercent: 0.1,
          change7dUsd: 1, change7dPercent: 0.1, change30dUsd: 1, change30dPercent: 0.1
        },
        verifiedAt: entry.verifiedAt
      })
    }
    return store
  })()
}

async function etfStore(input: Readonly<{ rowsObservedAt: string; newestRowObservedAt: string; verifiedAt: string }>) {
  const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
  const dates = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
  const rows = (asset: 'BTC' | 'ETH') => dates.map((tradingDate, index) => ({
    asset, tradingDate, netFlowUsd: asset === 'BTC' ? index + 1 : -(index + 1),
    observedAt: index === dates.length - 1 ? input.newestRowObservedAt : input.rowsObservedAt,
    fetchedAt: input.verifiedAt, source: '0xrouter' as const
  }))
  const built = buildEtfCurrentStateWindow({
    asOf: input.verifiedAt, completeThrough: '2026-10-30', completeDates: dates,
    btc: rows('BTC'), eth: rows('ETH')
  })
  if (built.state !== 'available') throw new Error('test ETF window must be available')
  await store.replace({ window: built.window, verifiedAt: input.verifiedAt })
  return store
}

async function packetWith(input: Readonly<{
  macroPoints: readonly Point[]
  capital: Awaited<ReturnType<typeof capitalStore>>
  etf?: Awaited<ReturnType<typeof etfStore>>
}>) {
  const capitalQuery = createCapitalConditionsSnapshotQueryService({
    store: input.capital,
    ...(input.etf ? { etfStore: input.etf } : {})
  })
  const macroHistory = createMacroHistoryAsOfQuery({ macroMarket: macroStore(input.macroPoints) })
  const deps: DailyBriefingSourceDeps = {
    repository: {
      listTimeline: () => ({ items: [], nextCursor: null }),
      getSummary: () => undefined,
      listPredictions: () => [],
      getRun: () => undefined,
      getSnapshot: () => undefined
    } as never,
    publicQuery: {
      queryFearGreedSnapshot: async () => ({
        state: 'available', asOf: CUTOFF, score: 30, bucket: 'fear', observedAt: '2026-10-30T00:00:00.000Z'
      }),
      queryFundingRateHistory: async () => ({
        state: 'available', asOf: CUTOFF,
        btc: [{ observedAt: '2026-10-30T20:00:00.000Z', ratePercent: 0.01 }],
        eth: [{ observedAt: '2026-10-30T20:00:00.000Z', ratePercent: -0.004 }]
      }),
      queryCapitalConditionsSnapshot: (query) => capitalQuery.query(query),
      queryOpenInterestHistory: async () => ({ state: 'unavailable' }),
      queryCrossAssetSnapshot: async () => undefined,
      queryMacroHistoryAsOf: (query) => macroHistory.read(query),
      queryMacroRatesSnapshot: () => undefined,
      queryMacroEconomicCalendarMonth: async () => ({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }),
      queryMarketCalendarMonth: () => ({ state: 'unavailable', failureCode: 'query-unavailable' })
    } as never,
    news: { query: async () => ({ state: 'unavailable', asOf: CUTOFF, generatedAt: CUTOFF, window: '24h', items: [], caveats: [] }) } as never,
    profiles: {
      listProfiles: async () => [
        { sourceId: 'alternative-fear-greed', enabled: true },
        { sourceId: 'binance-futures-positioning', enabled: true },
        { sourceId: 'defillama-stablecoins', enabled: true },
        { sourceId: '0xrouter-aggregate-provider', enabled: true }
      ]
    } as never
  }
  return createDailyBriefingSource(deps).buildPacket({ asOf: CUTOFF, locale: 'zh-CN', timeZone: TIME_ZONE })
}

const points: readonly Point[] = [
  { series: 'dxy-real', atMs: Date.parse('2026-10-29T23:30:00.000Z'), value: 103 },
  { series: 'dxy-real', atMs: Date.parse('2026-10-30T23:45:00.000Z'), value: 104 },
  // The 21:00 read: stored, but it describes a market the 08:00 handoff never saw.
  { series: 'dxy-real', atMs: Date.parse('2026-10-31T00:30:00.000Z'), value: 105 },
  { series: 'xau-usd', atMs: Date.parse('2026-10-29T23:30:00.000Z'), value: 4_100 },
  { series: 'xau-usd', atMs: Date.parse('2026-10-30T23:50:00.000Z'), value: 4_150 },
  { series: 'xau-usd', atMs: Date.parse('2026-10-31T00:40:00.000Z'), value: 4_200 }
]

function row(document: ReturnType<typeof buildDailyBriefingDocument>, id: string) {
  return [...document.data.market, ...document.data.funds].find((candidate) => candidate.id === id)
}

describe('daily briefing document data as-of rows', () => {
  it('fills stablecoin, ETF, DXY and gold from history at the cutoff, never from the current snapshot', async () => {
    const capital = await capitalStore({
      history: [
        { coreCurrentUsd: 300, verifiedAt: '2026-10-30T23:00:00.000Z' },
        { coreCurrentUsd: 900, verifiedAt: '2026-10-31T11:00:00.000Z' }
      ]
    })
    const etf = await etfStore({
      rowsObservedAt: '2026-10-30T23:00:00.000Z', newestRowObservedAt: '2026-10-31T11:00:00.000Z',
      verifiedAt: '2026-10-31T11:00:00.000Z'
    })
    const packet = await packetWith({ macroPoints: points, capital, etf })
    const document = buildDailyBriefingDocument({ packet, date: DATE })

    expect(packet.asOf).toBe(CUTOFF)
    // The current 21:00 values (105 / 4200 / 900 / the 10-30 ETF row) never reach the document.
    expect(row(document, 'dxy')).toMatchObject({
      state: 'available', observedAt: '2026-10-30T23:45:00.000Z',
      value: { number: (104 / 103 - 1) * 100, format: 'percent' }
    })
    expect(row(document, 'gold')).toMatchObject({
      state: 'available', observedAt: '2026-10-30T23:50:00.000Z',
      value: { number: (4_150 / 4_100 - 1) * 100, format: 'percent' }
    })
    expect(row(document, 'stablecoin')).toMatchObject({
      state: 'available', observedAt: '2026-10-30T23:00:00.000Z', value: { number: 300, format: 'usd' }
    })
    expect(row(document, 'etf-btc')).toMatchObject({
      state: 'available', observedAt: '2026-10-30T23:00:00.000Z', value: { number: 5, format: 'flow-usd' }
    })
    // Every card the failure printed as `—` now carries a value.
    for (const id of ['dxy', 'gold', 'stablecoin', 'etf-btc', 'etf-eth']) {
      expect(row(document, id)?.value, id).not.toBeNull()
    }
  })

  it('keeps the gap when history holds nothing at or before the cutoff', async () => {
    const capital = await capitalStore({ history: [{ coreCurrentUsd: 900, verifiedAt: '2026-10-31T11:00:00.000Z' }] })
    const packet = await packetWith({
      macroPoints: points.filter((point) => point.atMs > Date.parse(CUTOFF)),
      capital
    })
    const document = buildDailyBriefingDocument({ packet, date: DATE })

    expect(packet.market.macroMarket).toBeUndefined()
    expect(row(document, 'dxy')).toMatchObject({ state: 'unavailable', value: null })
    expect(row(document, 'gold')).toMatchObject({ state: 'unavailable', value: null })
    expect(row(document, 'stablecoin')).toMatchObject({ state: 'unavailable', value: null, reason: 'not-collected' })
    expect(row(document, 'etf-btc')).toMatchObject({ state: 'unavailable', value: null, reason: 'capital-gate' })
  })

  it('labels a synthesised dollar as synthetic and still dates it by the cutoff', async () => {
    const syntheticPoints: readonly Point[] = [
      { series: 'dxy-synthetic', atMs: Date.parse('2026-10-29T23:00:00.000Z'), value: 100 },
      { series: 'dxy-synthetic', atMs: Date.parse('2026-10-30T23:45:00.000Z'), value: 100.5 },
      { series: 'xau-usd', atMs: Date.parse('2026-10-29T23:30:00.000Z'), value: 4_100 },
      { series: 'xau-usd', atMs: Date.parse('2026-10-30T23:50:00.000Z'), value: 4_150 }
    ]
    const packet = await packetWith({
      macroPoints: syntheticPoints,
      capital: await capitalStore({ history: [{ coreCurrentUsd: 300, verifiedAt: '2026-10-30T23:00:00.000Z' }] })
    })
    const document = buildDailyBriefingDocument({ packet, date: DATE })

    expect(packet.market.macroMarket?.readings.find((reading) => reading.seriesId === 'dxy-synthetic'))
      .toMatchObject({ synthetic: true, level: 100.5 })
    expect(row(document, 'dxy')).toMatchObject({
      labelKey: 'dailyBriefing.row.dxySynthetic',
      observedAt: '2026-10-30T23:45:00.000Z',
      value: { number: (100.5 / 100 - 1) * 100, format: 'percent' }
    })
  })
})
