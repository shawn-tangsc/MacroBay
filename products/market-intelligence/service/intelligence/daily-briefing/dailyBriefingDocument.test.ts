import { describe, expect, it } from 'vitest'

import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { AnalysisSummary, Prediction } from '../../../contracts/marketAnalysisContracts'
import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroRatesSnapshotView } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingDocument, selectMacroFloorItem } from './dailyBriefingDocument'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

const asOf = '2026-10-30T00:30:00.000Z'
const windowStart = '2026-10-29T00:30:00.000Z'

const fearGreed: FearGreedSnapshotResult = {
  state: 'available', asOf, score: 48, bucket: 'fear', observedAt: '2026-10-30T00:00:00.000Z'
}
const funding: FundingRateHistoryResult = {
  state: 'available', asOf,
  btc: [
    { observedAt: '2026-10-29T08:00:00.000Z', ratePercent: 0.007945 },
    { observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.008696 }
  ],
  eth: [
    { observedAt: '2026-10-29T08:00:00.000Z', ratePercent: 0.004911 },
    { observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.005932 }
  ]
}
const capital: CapitalConditionsSnapshotResult = {
  state: 'available', asOf,
  etf: {
    state: 'available', schemaVersion: 1, sourceId: '0xrouter', windowEnd: '2026-10-29', verifiedAt: asOf,
    btc: { asset: 'BTC', rows: [{ tradingDate: '2026-10-29', netFlowUsd: 110_300_000, observedAt: '2026-10-29T00:00:00.000Z' }] },
    eth: { asset: 'ETH', rows: [{ tradingDate: '2026-10-29', netFlowUsd: -88_600_000, observedAt: '2026-10-29T00:00:00.000Z' }] }
  },
  coreStablecoins: {
    observedAt: '2026-10-30T00:12:00.000Z', verifiedAt: asOf,
    currentUsd: 253_033_903_673.4, change1dUsd: -843_904_300.6, change1dPercent: -0.3324,
    change7dUsd: -2_075_176_969.6, change7dPercent: -0.8134,
    change30dUsd: -5_877_104_441.1, change30dPercent: -2.2699
  },
  conclusion: 'partial'
}

const newsItem = (overrides: Partial<NewsSentimentItemView>): NewsSentimentItemView => ({
  itemId: 'item', title: 'Title', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS',
  publishedAt: '2026-10-30T00:00:00.000Z', scoredAt: '2026-10-30T00:05:00.000Z',
  polarity: 'bearish', strength: 3, confidence: 78, symbols: ['BTC'], reasonCode: 'news.exploit.v1',
  engine: 'rules', caveats: [], ...overrides
})

const summary: AnalysisSummary = {
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  conclusion: {
    direction: 'bearish',
    summary: 'Stablecoin contraction and ETF redemptions pull bids away.',
    change: 'No new comparable change this round.',
    causalChain: 'Flows fall -> bids thin -> price pressure.',
    conditions: ['Stablecoins keep contracting', 'ETFs do not show sustained inflows'],
    macro: null,
    evidenceStrength: 'Flow evidence is stronger than price evidence.',
    dataGaps: ['No consensus', 'No cross-asset transmission']
  },
  knownFacts: [], transmissionHypotheses: [], marketReaction: [],
  supportingEvidence: [], counterEvidence: [
    { statement: 'BTC ETF took in $110M.', evidenceRefId: 'ev-2' },
    { statement: 'Fear and Greed sits at 48.', evidenceRefId: 'ev-3' }
  ],
  scenarios: [], directions: [
    { horizon: 'short', direction: 'bearish', rationale: 'Flows are still negative.', confidence: 'low', evidenceRefIds: ['ev-1'] },
    { horizon: 'medium', direction: 'bearish', rationale: 'ETF flows confirm.', confidence: 'medium', evidenceRefIds: ['ev-2'] },
    { horizon: 'long', direction: 'bearish', rationale: 'Real yield stays high.', confidence: 'medium', evidenceRefIds: ['ev-3'] }
  ],
  nextCatalysts: [], dataCaveats: ['Funding is not comparable across venues.'],
  evidenceRefs: ['ev-1', 'ev-2', 'ev-3'], createdAt: '2026-10-30T00:00:00.000Z'
}

const predictions: readonly Prediction[] = [{
  id: 'mi-pr-1', schemaVersion: 1, summaryId: 'mi-as-1', asset: 'BTC',
  horizonStart: '2026-10-30T00:00:00.000Z', horizonEnd: '2026-10-31T00:00:00.000Z',
  baseCase: 'BTC leans lower.', conditions: ['ETFs do not turn'], invalidation: 'Stablecoins turn positive and BTC ETFs take in two days.',
  nextCatalyst: null, status: 'pending', verificationDueAt: '2026-10-31T00:00:00.000Z', createdAt: '2026-10-30T00:00:00.000Z'
}]

const packet = (overrides: Partial<DailyBriefingFactPacket> = {}): DailyBriefingFactPacket => ({
  asOf, windowStart, windowEnd: asOf, windowHours: 24, locale: 'zh-CN', timeZone: 'Asia/Shanghai',
  conclusion: { summary, predictions, occurredAt: '2026-10-30T00:00:00.000Z', evidenceRefs: [
    { evidenceRefId: 'ev-2', sourceId: 'etf', sourceLabel: 'ETF flows', itemId: null, occurredAt: null, publishedAt: '2026-10-28T00:00:00.000Z', detectedAt: null, computedAt: null, visibleAt: '2026-10-28T00:00:00.000Z', excerptHash: 'h2' },
    { evidenceRefId: 'ev-3', sourceId: 'fg', sourceLabel: 'Fear & Greed', itemId: null, occurredAt: null, publishedAt: '2026-10-30T00:00:00.000Z', detectedAt: null, computedAt: null, visibleAt: '2026-10-30T00:00:00.000Z', excerptHash: 'h3' }
  ] },
  news: {
    state: 'available',
    items: [
      newsItem({ itemId: 'n1', title: 'JPMorgan says AI labels no longer win lenders', strength: 3, confidence: 78 }),
      newsItem({ itemId: 'n2', title: 'Ripple wins trust bank approval', polarity: 'bullish', strength: 3, confidence: 85, publishedAt: '2026-10-29T23:00:00.000Z' }),
      newsItem({ itemId: 'n3', title: 'Routine notice', polarity: 'neutral', strength: 1, confidence: 90 })
    ]
  },
  calendar: {
    state: 'available',
    events: [
      {
        eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'high',
        lifecycleState: 'released', category: 'economic-indicator', actual: '3.4%', previous: '3.1%', consensus: '3.2%',
        surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
      },
      {
        eventKey: 'US.FOMC', title: 'FOMC', scheduledAt: '2026-11-02T18:00:00.000Z', importance: 'high',
        lifecycleState: 'scheduled', category: 'central-bank-activity', surprise: { direction: 'consensus-unavailable' }
      }
    ]
  },
  readings: { fearGreed, funding, capital },
  market: {
    crossAsset: {
      analysisEnd: '2026-10-30T00:25:00.000Z',
      closedReturns: {
        btc: { '24h': { state: 'available', value: -1.1 } },
        eth: { '24h': { state: 'available', value: -1.18 } },
        index: { '24h': { state: 'available', value: 0.82 } }
      }
    } as unknown as CrossAssetSnapshot,
    macroMarket: {
      state: 'available',
      readings: [
        { seriesId: 'dxy-real', level: 102.2, atMs: Date.parse('2026-10-30T00:25:00.000Z'), returns: { '24h': 0.43 } },
        { seriesId: 'xau-usd', level: 3996, atMs: Date.parse('2026-10-30T00:25:00.000Z'), returns: { '24h': -0.54 } }
      ]
    } as unknown as NonNullable<NonNullable<DailyBriefingFactPacket['market']>['macroMarket']>,
    macroRates: {
      state: 'available',
      readings: [
        { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, previous: 4.96, period: '2026-10-29' },
        { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 1.8, previous: 1.77, period: '2026-10-29' }
      ]
    } as unknown as MacroRatesSnapshotView
  },
  enabled: { fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true },
  ...overrides
})


const positioning = (btcH24: number, ethH24: number): NonNullable<DailyBriefingFactPacket['positioning']> => ({
  state: 'available', asOf, window: '24h',
  btc: [{ observedAt: asOf, notionalUsd: 1_200_000_000 }],
  eth: [{ observedAt: asOf, notionalUsd: 800_000_000 }],
  change: { btc: { h24Pct: btcH24 }, eth: { h24Pct: ethH24 } }
} as unknown as NonNullable<DailyBriefingFactPacket['positioning']>)

const policyPath = (
  value: number,
  overrides: Readonly<{ meetingDate?: string; outcome?: 'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus' }> = {}
): NonNullable<DailyBriefingFactPacket['policyPath']> => ({
  meetingDate: overrides.meetingDate ?? '2026-12-09',
  daysUntilMeeting: 40,
  hasProjectionMaterials: true,
  phase: { kind: 'normal' },
  probability: { venue: 'polymarket', asOf, outcome: overrides.outcome ?? 'hike-25', value, points: 12 },
  staleness: 'live'
})

const scheduledEvent = (overrides: Readonly<{
  eventKey: string
  title: string
  scheduledAt: string
  category?: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  countryCode?: string
  countryName?: string
}>) => ({
  eventKey: overrides.eventKey,
  title: overrides.title,
  scheduledAt: overrides.scheduledAt,
  importance: 'high' as const,
  lifecycleState: 'scheduled' as const,
  category: overrides.category ?? 'economic-indicator' as const,
  ...(overrides.countryCode ? { countryCode: overrides.countryCode } : {}),
  ...(overrides.countryName ? { countryName: overrides.countryName } : {}),
  surprise: { direction: 'consensus-unavailable' as const }
})

describe('daily briefing document', () => {
  it('builds the six readings, market rows, news, macro, next and conclusion', () => {
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })

    expect(document.edition).toMatchObject({ date: '2026-10-30', locale: 'zh-CN', windowStart, windowHours: 24 })
    expect(document.status).toMatchObject({ readingsAvailable: 4, readingsTotal: 4 })
    expect(document.data.funds).toHaveLength(5)
    // Available readings are candidates, not floor rows: the editor decides what the day needs.
    expect(document.data.funds.every((row) => row.importance.tier === 'support')).toBe(true)
    expect(document.data.funds.find((row) => row.id === 'etf-btc')?.materiality).toMatchObject({ material: true, reasonCode: 'etf-flow' })
    expect(document.data.funds.find((row) => row.id === 'stablecoin')?.materiality).toMatchObject({ material: false })
    expect(document.data.funds.find((row) => row.id === 'stablecoin')?.visibility).toBe('shown')
    expect(document.data.sentiment.fearGreed?.importance.tier).toBe('support')
    expect(document.data.sentiment.fearGreed?.materiality).toMatchObject({ material: false })
    expect(document.data.market).toHaveLength(7)
    expect(document.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
    expect(document.data.market.find((row) => row.id === 'btc')?.visibility).toBe('shown')
    expect(document.data.market.find((row) => row.id === 'index')?.materiality).toMatchObject({ material: false })
    expect(document.data.market.find((row) => row.id === 'index')?.visibility).toBe('shown')
    expect(document.data.market.find((row) => row.id === 'us10y')?.importance.tier).toBe('support')
    expect(document.data.market.find((row) => row.id === 'us10y')?.materiality).toMatchObject({ material: false })
    expect(document.data.market.find((row) => row.id === 'us10y')?.change).toMatchObject({ unit: 'bp', value: 4 })
    expect(document.data.market.find((row) => row.id === 'us10y-real')).toMatchObject({ value: { number: 1.8, format: 'yield' } })

    expect(document.news.items.map((item) => item.itemId)).toEqual(['n2', 'n1'])
    expect(document.news.macro.map((item) => item.eventKey)).toEqual(['US.CPI'])
    expect(document.next.focus?.eventKey).toBe('US.FOMC')
    expect(document.news.items[0]).toMatchObject({ polarity: 'bullish' })
    expect(document.news.items[0]).not.toHaveProperty('translatedTitle')
    expect(document.news.notes.macroEmpty).toBeUndefined()

    expect(document.conclusion?.topSignal).toMatchObject({
      horizon: 'medium', direction: 'bearish', confidence: 'medium', citations: [1]
    })
    expect(document.conclusion?.counterEvidence[0]?.citations).toEqual([1])
    expect(document.conclusion?.counterEvidence[1]?.citations).toEqual([2])
    expect(document.citations.map((entry) => entry.refId)).toEqual(['ev-2', 'ev-3'])
    expect(document.citations[0]).toMatchObject({ sourceLabel: 'ETF flows', observedAt: '2026-10-28T00:00:00.000Z', statement: 'ETF flows confirm.' })
    expect(document.conclusion?.invalidations).toHaveLength(1)
    expect(document.lede.source).toBe('template')
    expect(document.lede.text).toBe('')
  })

  it('keeps a released high-impact event without consensus in the macro list', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: {
          state: 'available',
          events: [{
            eventKey: 'US.PPI', title: 'ppi', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'high',
            lifecycleState: 'released', category: 'economic-indicator', actual: '0.4%', previous: '0.2%',
            surprise: { direction: 'consensus-unavailable' }
          }]
        }
      }),
      date: '2026-10-30'
    })

    // No consensus must not remove or downgrade the release: it stays a high-impact macro fact the
    // limits section can report as a consensus gap.
    expect(document.news.macro).toHaveLength(1)
    expect(document.news.macro[0]).toMatchObject({ eventKey: 'US.PPI', importance: 'high', actual: '0.4%', previous: '0.2%' })
    expect(document.news.macro[0]?.consensus).toBeUndefined()
    expect(document.news.macro[0]?.surprise.direction).toBe('consensus-unavailable')
    expect(document.news.macro[0]?.visibility).toBeUndefined()
  })

  it('caps the 24h macro list at four and keeps the key floor event first', () => {
    const events = Array.from({ length: 6 }, (_, index) => ({
      eventKey: `US.EVENT_${index}`, title: `event ${index}`, scheduledAt: `2026-10-29T${String(12 + index).padStart(2, '0')}:30:00.000Z`,
      importance: 'high' as const, lifecycleState: 'released' as const, category: 'economic-indicator' as const,
      actual: `${index + 1}.0%`, previous: `${index}.0%`, consensus: `${index + 0.5}%`,
      surprise: { direction: 'beat' as const, value: index === 5 ? 1 : 0.1, unit: 'pp' as const }
    }))
    const document = buildDailyBriefingDocument({
      packet: packet({ calendar: { state: 'available', events } }),
      date: '2026-10-30'
    })

    expect(document.news.macroCandidates).toHaveLength(6)
    expect(document.news.macro).toHaveLength(4)
    expect(document.news.macro[0]?.eventKey).toBe('US.EVENT_5')
  })

  it('records the packet window that generation actually read', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        windowStart: '2026-10-28T00:30:00.000Z',
        windowEnd: asOf,
        windowHours: 48
      }),
      date: '2026-10-30'
    })

    expect(document.schemaVersion).toBe(dailyBriefingPolicy.schemaVersion)
    expect(document.edition).toMatchObject({
      windowStart: '2026-10-28T00:30:00.000Z',
      windowEnd: asOf,
      windowHours: 48
    })
  })

  it('compares the edition with the previous day', () => {
    const previous = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-29' })
    const previousAltered = {
      ...previous,
      edition: { ...previous.edition, date: '2026-10-29' },
      conclusion: previous.conclusion ? { ...previous.conclusion, direction: 'bullish' as const } : null,
      data: {
        ...previous.data,
        funds: previous.data.funds.map((row) => row.id === 'stablecoin' && row.value
          ? { ...row, value: { ...row.value, number: row.value.number + 100_000_000 } }
          : row)
      }
    }
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30', previous: previousAltered })
    expect(document.comparison).toMatchObject({ previousDate: '2026-10-29', directionChanged: true, previousDirection: 'bullish' })
    expect(document.comparison?.stablecoinDelta).toBe(-100_000_000)
  })

  it('leads the stablecoin row with its 1d change and keeps the longer windows behind it', () => {
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })
    const stablecoin = document.data.funds.find((row) => row.id === 'stablecoin')

    // The level stays in `value` for the caption; the headline is the move, not the quarter-trillion.
    expect(stablecoin?.value).toMatchObject({ number: 253_033_903_673.4, format: 'usd' })
    expect(stablecoin?.change).toMatchObject({ value: -0.3324, unit: 'percent', window: '1d' })
    expect(stablecoin?.auxiliaryChanges).toEqual([
      { value: -843_904_300.6, unit: 'usd', window: '1d' },
      { value: -0.8134, unit: 'percent', window: '7d' },
      { value: -2.2699, unit: 'percent', window: '30d' }
    ])
  })

  it('reads fear and greed as a point change against the previous publication', () => {
    const score = (value: number, observedAt: string): FearGreedSnapshotResult => ({
      state: 'available', asOf, score: value, bucket: 'fear', observedAt
    })
    const readings = (value: number, observedAt: string): DailyBriefingFactPacket['readings'] =>
      ({ fearGreed: score(value, observedAt), funding, capital })
    const previous = buildDailyBriefingDocument({
      packet: packet({ readings: readings(30, '2026-10-29T00:00:00.000Z') }),
      date: '2026-10-29'
    })
    const document = buildDailyBriefingDocument({
      packet: packet({ readings: readings(28, '2026-10-30T00:00:00.000Z') }),
      date: '2026-10-30',
      previous
    })

    // The window names the release cadence, not a day: the baseline is the previous publication.
    expect(document.data.sentiment.fearGreed?.change).toMatchObject({ value: -2, unit: 'points', window: 'publication-day' })
    expect(document.data.sentiment.fearGreed?.changeReason).toBeUndefined()
    expect(document.data.sentiment.fearGreed?.baselineAt).toBe('2026-10-29T00:00:00.000Z')
    expect(document.data.sentiment.fearGreed?.value).toMatchObject({ number: 28, format: 'score' })
  })

  it('keeps the last publication as the baseline when a day has no edition', () => {
    const score = (value: number, observedAt: string): FearGreedSnapshotResult => ({
      state: 'available', asOf, score: value, bucket: 'fear', observedAt
    })
    const readings = (value: number, observedAt: string): DailyBriefingFactPacket['readings'] =>
      ({ fearGreed: score(value, observedAt), funding, capital })
    // Sunday's edition was never generated: Friday's publication is still the last real value.
    const friday = buildDailyBriefingDocument({
      packet: packet({ readings: readings(30, '2026-10-30T00:00:00.000Z') }),
      date: '2026-10-30'
    })
    const document = buildDailyBriefingDocument({
      packet: packet({ readings: readings(34, '2026-11-02T00:00:00.000Z') }),
      date: '2026-11-02',
      previous: friday
    })

    expect(document.data.sentiment.fearGreed?.change).toMatchObject({ value: 4, unit: 'points', window: 'publication-day' })
    expect(document.data.sentiment.fearGreed?.baselineAt).toBe('2026-10-30T00:00:00.000Z')
  })

  it('states a missing baseline instead of inventing a zero change', () => {
    const withoutPrevious = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })
    expect(withoutPrevious.data.sentiment.fearGreed?.change).toBeNull()
    expect(withoutPrevious.data.sentiment.fearGreed?.changeReason).toBe('no-baseline')

    // An edition that read the same publication is not a second value: subtracting it would print a
    // zero that means "no new release" instead of "the index did not move".
    const samePublication = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-27' })
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30', previous: samePublication })
    expect(document.data.sentiment.fearGreed?.change).toBeNull()
    expect(document.data.sentiment.fearGreed?.changeReason).toBe('no-baseline')
  })

  it('includes a high-impact event on the seventh local day', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        asOf: '2026-10-29T18:03:00.000Z', windowStart: '2026-10-28T18:03:00.000Z', windowEnd: '2026-10-29T18:03:00.000Z',
        calendar: {
          state: 'available',
          events: [{
            eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M10', title: 'nonfarm-payrolls', titleKey: 'nonfarm-payrolls',
            countryCode: 'US', countryName: 'United States', consensus: '29',
            scheduledAt: '2026-11-06T12:30:00.000Z', importance: 'high', lifecycleState: 'scheduled',
            category: 'economic-indicator', surprise: { direction: 'consensus-unavailable' }
          }]
        }
      }),
      date: '2026-10-30'
    })
    expect(document.next.focus).toMatchObject({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M10', countryCode: 'US', countryName: 'United States', consensus: '29' })
  })

  it('says where each stale row came from: snapshot, series return, series level, published', () => {
    // Every row that is not today's exact reading has to be able to say which reading it is; a row
    // that says nothing is the one a reader trusts as live.
    const stalePacket = packet({
      market: {
        crossAsset: {
          analysisEnd: '2026-10-27T00:00:00.000Z',
          closedReturns: { btc: { '24h': { state: 'available', value: -1.1 } } }
        } as unknown as CrossAssetSnapshot,
        macroMarket: {
          state: 'available',
          readings: [
            // Old enough to be stale, with a computed 24h move.
            { seriesId: 'dxy-real', level: 102.2, atMs: Date.parse('2026-10-20T00:25:00.000Z'), returns: { '24h': 0.43 } },
            // Old and no move at all: only the level survives.
            { seriesId: 'xau-usd', level: 3996, atMs: Date.parse('2026-10-20T00:25:00.000Z') }
          ]
        } as unknown as NonNullable<NonNullable<DailyBriefingFactPacket['market']>['macroMarket']>,
        macroRates: {
          state: 'available',
          readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, period: '2026-10-14' }]
        } as unknown as MacroRatesSnapshotView
      },
    })
    const document = buildDailyBriefingDocument({ packet: stalePacket, date: '2026-10-30' })
    const row = (id: string) => document.data.market.find((entry) => entry.id === id)

    expect(row('btc')).toMatchObject({ state: 'stale', valueBasis: 'snapshot' })
    expect(row('dxy')).toMatchObject({ state: 'stale', valueBasis: 'series-return' })
    expect(row('gold')).toMatchObject({ state: 'stale', valueBasis: 'series-level' })
    expect(row('us10y')).toMatchObject({ state: 'stale', valueBasis: 'published' })
  })

  it('uses a persisted curve or last close when the exact 24h pair is missing', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        market: {
          crossAsset: {
            analysisEnd: '2026-10-30T00:25:00.000Z',
            closedReturns: { btc: { '24h': { state: 'unavailable', reason: 'missing' } }, eth: { '24h': { state: 'unavailable', reason: 'missing' } } },
            curves: { btc: [{ at: '2026-10-30T00:25:00.000Z', returnPercent: -0.43 }], eth: [{ at: '2026-10-30T00:25:00.000Z', returnPercent: -1.21 }] },
            lastClosed: { btc: { at: '2026-10-30T00:25:00.000Z', close: '80688' }, eth: { at: '2026-10-30T00:25:00.000Z', close: '2327.67' } }
          } as never
        }
      }),
      date: '2026-10-30'
    })
    expect(document.data.market.find((row) => row.id === 'btc')).toMatchObject({ state: 'stale', reason: 'stale-fallback', value: { number: -0.43, format: 'percent' }, valueBasis: 'curve' })
    expect(document.data.market.find((row) => row.id === 'eth')).toMatchObject({ state: 'stale', value: { number: -1.21, format: 'percent' }, valueBasis: 'curve' })
  })

  it('keeps all same-release candidates for the agent to choose', () => {
    const event = (eventKey: string, titleKey: string) => ({
      eventKey, title: titleKey, titleKey, scheduledAt: '2026-11-06T12:30:00.000Z', importance: 'high' as const,
      lifecycleState: 'scheduled' as const, category: 'economic-indicator' as const,
      countryCode: 'US', countryName: 'United States', consensus: '29', surprise: { direction: 'consensus-unavailable' as const }
    })
    const document = buildDailyBriefingDocument({
      packet: packet({
        asOf: '2026-10-29T18:03:00.000Z', windowStart: '2026-10-28T18:03:00.000Z', windowEnd: '2026-10-29T18:03:00.000Z',
        calendar: { state: 'available', events: [event('US.AHE', 'average-hourly-earnings'), event('US.NFP', 'nonfarm-payrolls')] }
      }),
      date: '2026-10-30'
    })
    expect(document.next.candidates?.map((item) => item.eventKey)).toEqual(['US.AHE', 'US.NFP'])
  })

  it('gives every next candidate a crypto transmission role and ranks policy over regional growth', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: {
          state: 'available',
          events: [
            scheduledEvent({ eventKey: 'US.FOMC', title: 'FOMC rate decision', scheduledAt: '2026-11-02T18:00:00.000Z', category: 'central-bank-activity' }),
            scheduledEvent({ eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-11-03T12:30:00.000Z' }),
            scheduledEvent({ eventKey: 'US.NONFARM_PAYROLLS', title: 'Nonfarm payrolls', scheduledAt: '2026-11-06T12:30:00.000Z' }),
            scheduledEvent({ eventKey: 'US.10Y_AUCTION', title: '10-year Treasury auction', scheduledAt: '2026-11-04T17:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'US.SPOT_BITCOIN_ETF', title: 'Spot Bitcoin ETF decision', scheduledAt: '2026-11-05T20:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'US.SEC_CRYPTO_RULE', title: 'SEC crypto rule', scheduledAt: '2026-11-05T21:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'US.STABLECOIN_BILL', title: 'Stablecoin regulation bill', scheduledAt: '2026-11-04T15:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'GLOBAL.EXCHANGE_HACK', title: 'Major exchange hack', scheduledAt: '2026-11-03T08:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'CN.NBS_PMI', title: 'China NBS Manufacturing PMI', scheduledAt: '2026-10-31T01:00:00.000Z', countryCode: 'CN', countryName: 'China' }),
            scheduledEvent({ eventKey: 'GLOBAL.OPEC_MEETING', title: 'OPEC+ meeting', scheduledAt: '2026-11-01T10:00:00.000Z', category: 'financial-event' })
          ]
        }
      }),
      date: '2026-10-30'
    })
    const role = (eventKey: string) => document.next.candidates?.find((item) => item.eventKey === eventKey)?.relevance
    const score = (eventKey: string) => role(eventKey)?.score ?? 0

    expect(role('US.FOMC')?.role).toBe('rate-policy')
    expect(role('US.CPI')?.role).toBe('inflation')
    expect(role('US.NONFARM_PAYROLLS')?.role).toBe('labor')
    expect(role('US.10Y_AUCTION')?.role).toBe('liquidity')
    expect(role('US.SPOT_BITCOIN_ETF')?.role).toBe('etf')
    expect(role('US.SEC_CRYPTO_RULE')?.role).toBe('regulation')
    expect(role('US.STABLECOIN_BILL')?.role).toBe('stablecoin')
    expect(role('GLOBAL.EXCHANGE_HACK')?.role).toBe('exchange-risk')
    expect(role('CN.NBS_PMI')?.role).toBe('asia-risk')
    expect(role('GLOBAL.OPEC_MEETING')?.role).toBe('commodity')
    // Policy, inflation, labor, auctions, ETF, regulation and stablecoins all outrank the regional
    // spillovers; the earliest event (China PMI) is not the focus.
    for (const key of ['US.FOMC', 'US.CPI', 'US.NONFARM_PAYROLLS', 'US.10Y_AUCTION', 'US.SPOT_BITCOIN_ETF', 'US.SEC_CRYPTO_RULE', 'US.STABLECOIN_BILL']) {
      expect(score(key), key).toBeGreaterThan(score('CN.NBS_PMI'))
      expect(score(key), key).toBeGreaterThan(score('GLOBAL.OPEC_MEETING'))
    }
    expect(score('US.FOMC')).toBeGreaterThan(score('US.CPI'))
    expect(score('US.CPI')).toBeGreaterThan(score('US.NONFARM_PAYROLLS'))
    expect(document.next.focus?.eventKey).toBe('US.FOMC')
  })

  it('keeps the most relevant event as focus when a regional event is earlier', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: {
          state: 'available',
          events: [
            scheduledEvent({ eventKey: 'CN.NBS_PMI', title: 'China NBS Manufacturing PMI', scheduledAt: '2026-10-31T01:00:00.000Z', countryCode: 'CN', countryName: 'China' }),
            scheduledEvent({ eventKey: 'US.FOMC', title: 'FOMC', scheduledAt: '2026-11-02T18:00:00.000Z', category: 'central-bank-activity' })
          ]
        }
      }),
      date: '2026-10-30'
    })

    expect(document.next.focus?.eventKey).toBe('US.FOMC')
    expect(document.next.candidates?.map((item) => item.eventKey)).toEqual(['US.FOMC', 'CN.NBS_PMI'])
    expect(document.next.items.map((item) => item.eventKey)).toEqual(['CN.NBS_PMI'])
  })

  it('takes the nearest event when two candidates share a relevance score', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: {
          state: 'available',
          events: [
            scheduledEvent({ eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-11-03T12:30:00.000Z' }),
            scheduledEvent({ eventKey: 'US.CORE_CPI', title: 'Core CPI', scheduledAt: '2026-11-02T12:30:00.000Z' })
          ]
        }
      }),
      date: '2026-10-30'
    })

    expect(document.next.candidates?.map((item) => item.eventKey)).toEqual(['US.CORE_CPI', 'US.CPI'])
    expect(document.next.focus?.eventKey).toBe('US.CORE_CPI')
  })

  it('caps the focus plus the next list at four events, ordered by relevance then time', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: {
          state: 'available',
          events: [
            scheduledEvent({ eventKey: 'CN.NBS_PMI', title: 'China NBS Manufacturing PMI', scheduledAt: '2026-10-31T01:00:00.000Z', countryCode: 'CN', countryName: 'China' }),
            scheduledEvent({ eventKey: 'GLOBAL.OPEC_MEETING', title: 'OPEC+ meeting', scheduledAt: '2026-11-01T10:00:00.000Z', category: 'financial-event' }),
            scheduledEvent({ eventKey: 'US.FOMC', title: 'FOMC', scheduledAt: '2026-11-02T18:00:00.000Z', category: 'central-bank-activity' }),
            scheduledEvent({ eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-11-03T12:30:00.000Z' }),
            scheduledEvent({ eventKey: 'US.NONFARM_PAYROLLS', title: 'Nonfarm payrolls', scheduledAt: '2026-11-06T12:30:00.000Z' })
          ]
        }
      }),
      date: '2026-10-30'
    })

    expect(document.next.focus?.eventKey).toBe('US.FOMC')
    expect(document.next.items.map((item) => item.eventKey)).toEqual(['US.CPI', 'US.NONFARM_PAYROLLS', 'CN.NBS_PMI'])
    expect([document.next.focus, ...document.next.items]).toHaveLength(4)
    expect(document.next.candidates?.map((item) => item.eventKey)).toContain('GLOBAL.OPEC_MEETING')
  })

  it('keeps a readable document when the market sources are absent', () => {
    const document = buildDailyBriefingDocument({ packet: packet({ market: {} }), date: '2026-10-30' })
    expect(document.data.market).toHaveLength(7)
    expect(document.data.market.find((row) => row.id === 'btc')).toMatchObject({
      state: 'unavailable', reason: 'query-failed'
    })
    expect(document.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
    expect(document.status.readingsAvailable).toBe(4)
  })

  it('writes explicit empty notes instead of blank sections', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        conclusion: null,
        news: { state: 'empty', items: [] },
        calendar: { state: 'source-disabled', events: [] }
      }),
      date: '2026-10-30'
    })
    expect(document.conclusion).toBeNull()
    expect(document.news.notes).toEqual({
      newsEmpty: 'no-directional-news',
      macroEmpty: 'calendar-source-disabled'
    })
    expect(document.next.note).toBe('calendar-source-disabled')
    expect(document.data.sentiment.news).toMatchObject({ state: 'empty', itemCount: 0 })
  })

  it('does not let stale or unavailable readings look available', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        readings: {
          fearGreed: { ...fearGreed, observedAt: '2026-10-28T00:00:00.000Z' },
          funding: { state: 'empty', asOf },
          capital: { state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' }
        }
      }),
      date: '2026-10-30'
    })
    expect(document.status.readings[0]?.state).toBe('stale')
    expect(document.status.readings[1]?.state).toBe('unavailable')
    expect(document.status.readings[2]?.state).toBe('unavailable')
    expect(document.status.readingsAvailable).toBe(1)
  })


  it('admits leverage only when open interest or funding moved past the threshold', () => {
    const flat = buildDailyBriefingDocument({ packet: packet({ positioning: positioning(1.2, 0.4) }), date: '2026-10-30' })
    expect(flat.data.leverage?.materiality).toMatchObject({ material: false, reasonCode: 'no-material-change' })
    // A quiet block is still shown: the threshold decides emphasis, not presence.
    expect(flat.data.leverage?.visibility).toBe('shown')

    const moved = buildDailyBriefingDocument({ packet: packet({ positioning: positioning(12.4, -8.1) }), date: '2026-10-30' })
    expect(moved.data.leverage?.materiality).toMatchObject({ material: true, reasonCode: 'open-interest-shift' })
    expect(moved.data.leverage?.visibility).toBe('shown')

    const extremeFunding = buildDailyBriefingDocument({
      packet: packet({
        positioning: positioning(0.4, 0.5),
        readings: {
          fearGreed: fearGreed,
          capital,
          funding: {
            state: 'available', asOf,
            btc: [{ observedAt: '2026-10-29T08:00:00.000Z', ratePercent: 0.008 }, { observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.061 }],
            eth: [{ observedAt: '2026-10-29T08:00:00.000Z', ratePercent: 0.006 }, { observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.058 }]
          }
        }
      }),
      date: '2026-10-30'
    })
    expect(extremeFunding.data.leverage?.materiality).toMatchObject({ material: true, reasonCode: 'funding-extreme' })
  })

  it('admits the rate path only on a probability shift, an imminent meeting or a changed outcome', () => {
    const unchanged = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(60) }), date: '2026-10-30' })
    expect(unchanged.data.policyPath?.materiality).toMatchObject({ material: false })
    expect(unchanged.data.policyPath?.visibility).toBe('shown')

    const previous = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(45) }), date: '2026-10-29' })
    const shifted = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(76) }), date: '2026-10-30', previous })
    expect(shifted.data.policyPath?.probabilityChangePp).toBe(31)
    expect(shifted.data.policyPath?.materiality).toMatchObject({ material: true, reasonCode: 'policy-probability-shift' })

    const imminent = buildDailyBriefingDocument({
      packet: packet({ policyPath: policyPath(60, { meetingDate: '2026-11-03' }) }),
      date: '2026-10-30'
    })
    expect(imminent.data.policyPath?.materiality).toMatchObject({ material: true, reasonCode: 'policy-meeting-imminent' })

    const previousOutcome = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(60, { outcome: 'hike-25' }) }), date: '2026-10-29' })
    const changedOutcome = buildDailyBriefingDocument({
      packet: packet({ policyPath: policyPath(60, { outcome: 'no-change' }) }),
      date: '2026-10-30',
      previous: previousOutcome
    })
    expect(changedOutcome.data.policyPath?.materiality).toMatchObject({ material: true, reasonCode: 'policy-path-change' })
  })

  it('floors the largest surprise, then the latest release, among high-impact events', () => {
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })
    const cpi = document.news.macro[0]!
    expect(selectMacroFloorItem([])).toBeUndefined()
    expect(selectMacroFloorItem([{ ...cpi, importance: 'medium' }])).toBeUndefined()
    const largerOlder = { ...cpi, eventKey: 'US.OLDER', scheduledAt: '2026-10-29T10:00:00.000Z', surprise: { direction: 'miss' as const, value: 0.6, unit: 'pp' as const } }
    const smallerNewer = { ...cpi, eventKey: 'US.NEWER', scheduledAt: '2026-10-29T18:00:00.000Z', surprise: { direction: 'beat' as const, value: 0.1, unit: 'pp' as const } }
    const latest = { ...cpi, eventKey: 'US.LATEST', scheduledAt: '2026-10-29T20:00:00.000Z', surprise: { direction: 'beat' as const, value: 0.1, unit: 'pp' as const } }
    expect(selectMacroFloorItem([smallerNewer, largerOlder])?.eventKey).toBe('US.OLDER')
    expect(selectMacroFloorItem([smallerNewer, latest])?.eventKey).toBe('US.LATEST')
  })
})
