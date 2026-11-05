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
import { selectMacroAnalysisCandidates } from './dailyBriefingDocumentMacro'
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
  overrides: Readonly<{
    meetingDate?: string
    outcome?: 'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus'
    distribution?: Readonly<Record<'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', number>>
  }> = {}
): NonNullable<DailyBriefingFactPacket['policyPath']> => ({
  meetingDate: overrides.meetingDate ?? '2026-12-09',
  daysUntilMeeting: 40,
  hasProjectionMaterials: true,
  phase: { kind: 'normal' },
  probability: { venue: 'polymarket', asOf, outcome: overrides.outcome ?? 'hike-25', value, points: 12, ...(overrides.distribution ? { distribution: overrides.distribution } : {}) },
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

  it('writes the period identity into the edition at the current schema', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({ asOf: '2026-10-30T00:30:12.345Z', windowEnd: asOf }),
      date: '2026-10-30'
    })

    // schema 14 起宏观事件带自己的 `lifecycleState`（`02` v2.125），当前文档就是 14。
    expect(document.schemaVersion).toBe(14)
    // The id is a name, not the clock: this version's single fixed period.
    expect(document.edition.periodId).toBe('default')
    // The nominal cutoff, not the (later) actual generation moment; ISO milliseconds like generatedAt.
    expect(document.edition.periodTime).toBe(asOf)
    expect(document.edition.generatedAt).toBe('2026-10-30T00:30:12.345Z')
    expect(document.edition.periodTime).toMatch(/\.\d{3}Z$/)
    expect(document.edition.periodKind).toBe('scheduled')
    // The scheduled daily run of this version: never recorded as a catch-up or a retry.
    expect(document.edition.runTrigger).toBe('scheduled')
  })

  it('writes the identity of the run it belongs to, not a literal default period', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        periodId: 'period_x',
        periodTime: '2026-10-30T07:00:00.000Z',
        periodKind: 'manual',
        runTrigger: 'retry'
      }),
      date: '2026-10-30'
    })

    // A non-default period's edition must not be filed under `default`, and a retry must not claim
    // it ran on schedule: both facts travel from the run into the document.
    expect(document.edition).toMatchObject({
      periodId: 'period_x',
      periodTime: '2026-10-30T07:00:00.000Z',
      periodKind: 'manual',
      runTrigger: 'retry'
    })
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

  // `A0.8` 的核心判据：日历过期时写「读不到」，不许写「没有」。夹具照 11-05 那期的真实形状：
  // 截止 07:00，最后一次成功采集在前天 13:27（差约 42 小时）。
  it('says "not readable" — never "nothing" — when the calendar is stale', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        asOf: '2026-10-30T00:30:00.000Z',
        calendar: { state: 'available', events: [] },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-28T06:27:00.000Z', catchUp: { state: 'timeout', timeoutMs: 90_000 } }
      }),
      date: '2026-10-30'
    })
    // 补采超时有自己的一句，不是「采集失败」、更不是「没有」。
    expect(document.news.notes.macroEmpty).toBe('calendar-catch-up-timeout')

    const stale = buildDailyBriefingDocument({
      packet: packet({
        calendar: { state: 'available', events: [] },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-28T06:27:00.000Z', catchUp: { state: 'skipped' } }
      }),
      date: '2026-10-30'
    })
    expect(stale.news.notes.macroEmpty).toBe('calendar-stale')
    expect(stale.news.notes.macroEmptyHours).toBe(42)
    expect(stale.news.notes.macroEmpty).not.toBe('past-24h-no-high-impact-release')

    // 没有读数（旧调用方 / 夹具）：也只能说「读不到」。
    const unread = buildDailyBriefingDocument({
      packet: packet({ calendar: { state: 'available', events: [] } }), date: '2026-10-30'
    })
    expect(unread.news.notes.macroEmpty).toBe('calendar-unavailable')
  })

  it('allows "nothing happened" only when the reading is fresh and the window is empty', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: { state: 'available', events: [] },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-30T00:00:00.000Z', catchUp: { state: 'skipped' } }
      }),
      date: '2026-10-30'
    })

    expect(document.news.notes.macroEmpty).toBe('past-24h-no-high-impact-release')
    expect(document.news.notes.macroEmptyHours).toBeUndefined()
  })

  it('records when the run read the world, and that the window did not move with it', () => {
    // 用户 2026-11-05 定：读数用运行时刻，窗口仍按截止。文档必须同时记住这两个时刻，
    // 否则"这一版读到哪一刻"和"统计到哪一刻"又会被混成一句。
    const document = buildDailyBriefingDocument({
      packet: packet({
        asOf: '2026-10-30T04:20:00.000Z',
        windowStart: '2026-10-29T00:00:00.000Z',
        windowEnd: '2026-10-30T00:00:00.000Z'
      }),
      date: '2026-10-30'
    })
    expect(document.edition.generatedAt).toBe('2026-10-30T04:20:00.000Z')
    // 读数时刻叫 `readAt`，不叫 `dataAsOf`：后者在本仓的旧口径里指统计截止，不许一名两义。
    expect(document.edition.readAt).toBe('2026-10-30T04:20:00.000Z')
    expect(document.edition.dataAsOf).toBeUndefined()
    expect(document.edition.generatedAs).toBe('2026-10-30T04:20:00.000Z')
    // 运行时刻晚于截止 → 这一版是补跑。
    expect(document.edition.isBackfill).toBe(true)
    // 窗口与名义截止都不动。
    expect(document.edition.windowEnd).toBe('2026-10-30T00:00:00.000Z')
    expect(document.edition.periodTime).toBe('2026-10-30T00:00:00.000Z')
  })

  it('does not stamp a punctual run as a backfill', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        asOf: '2026-10-30T00:00:20.000Z',
        windowStart: '2026-10-29T00:00:00.000Z',
        windowEnd: '2026-10-30T00:00:00.000Z'
      }),
      date: '2026-10-30'
    })
    // 准点是"截止后几秒起跑"，不是补跑：多写一个补跑标记会让每一版都多一句说明。
    expect(document.edition.isBackfill).toBeUndefined()
    expect(document.edition.readAt).toBe('2026-10-30T00:00:20.000Z')
  })

  it('keeps high-impact events whose actuals never arrived on the page (A0.12)', () => {
    // 用户 2026-11-05 报的那一版：窗口内 9 条高影响事件，到冻结那一刻一条实际值都没回补。
    // 事件优先：它们照样是候选、照样进正文，缺的只是值那一格；空态那句「没有」根本不该出现。
    const events = Array.from({ length: 9 }, (_, index) => ({
      eventKey: `EV.${index}`,
      title: `Event ${index}`,
      scheduledAt: new Date(Date.parse(windowStart) + (index + 1) * 2 * 3_600_000).toISOString(),
      importance: 'high' as const,
      lifecycleState: 'scheduled' as const,
      category: 'economic-indicator' as const,
      surprise: { direction: 'consensus-unavailable' as const }
    }))
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: { state: 'available', events },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-30T00:00:00.000Z', catchUp: { state: 'skipped' } }
      }),
      date: '2026-10-30'
    })

    // 九条都在候选里（页面按上限取前四条，其余留在候选表备查）。
    expect(document.news.macroCandidates).toHaveLength(9)
    expect(document.news.macro.length).toBeGreaterThan(0)
    // 总数与缺值数一起写：句子念得出"共几条、其中几条没拿到"。
    expect(document.news.notes.macroHighImpactCount).toBe(9)
    // 正文不编数值。
    expect(document.news.macro.every((item) => item.actual === undefined)).toBe(true)
    // 也没有"没有事件"那句话——事件在。
    expect(document.news.notes.macroEmpty).toBeUndefined()
  })

  it('keeps the plain "nothing" sentence when the window really had no high-impact event', () => {
    // 反向：窗口里只有低影响事件时，仍然是"一条高影响都没有"，不许被上一档顶掉。
    const events = [{
      eventKey: 'EV.LOW', title: 'Low', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'medium' as const,
      lifecycleState: 'scheduled' as const, category: 'economic-indicator' as const,
      surprise: { direction: 'consensus-unavailable' as const }
    }]
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: { state: 'available', events },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-30T00:00:00.000Z', catchUp: { state: 'skipped' } }
      }),
      date: '2026-10-30'
    })
    expect(document.news.notes.macroEmpty).toBe('past-24h-no-high-impact-release')
    // 窗口里连高影响事件都没有：总数不写，正文里也没有任何一句话。
    expect(document.news.notes.macroHighImpactCount).toBeUndefined()
  })

  it('keeps a cancelled event on the page and marks it, without inventing a value (A0.12)', () => {
    // 取消的事件照常显示并标「已取消」（`02` v2.125）：那天原定有一场、后来取消了，这是真实的
    // 排期变化，藏起来读者会以为数据漏了。它没有值，所以值格不渲染，也不进分析素材。
    const events = [{
      eventKey: 'EV.CANCELLED', title: 'Cancelled release', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high' as const, lifecycleState: 'cancelled' as const, category: 'economic-indicator' as const,
      surprise: { direction: 'consensus-unavailable' as const }
    }]
    const document = buildDailyBriefingDocument({
      packet: packet({
        calendar: { state: 'available', events },
        calendarFreshness: { state: 'available', lastCollectedAt: '2026-10-30T00:00:00.000Z', catchUp: { state: 'skipped' } }
      }),
      date: '2026-10-30'
    })

    // 行在、标记在、计入条数；「没有已发布的高影响事件」那句不出现（它是事实，不是"没有"）。
    expect(document.news.macro).toHaveLength(1)
    expect(document.news.macro[0]).toMatchObject({ eventKey: 'EV.CANCELLED', lifecycleState: 'cancelled' })
    expect(document.news.macro[0]?.actual).toBeUndefined()
    expect(document.news.notes.macroHighImpactCount).toBe(1)
    expect(document.news.notes.macroEmpty).toBeUndefined()
    // 分析素材里没有它：取消是"不会有了"，不是"我们没拿到"，模型更不该拿它讲故事。
    expect(selectMacroAnalysisCandidates(document.news.macroCandidates ?? [])).toHaveLength(0)
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

  /**
   * The three facts schema 10 added to the document.
   *
   * All three were already in the packet and were dropped by this builder, so none of them is new
   * collection: the policy venue prices five buckets, the open interest read returns a series, and the
   * cross-asset snapshot carries a return curve. What these cases pin is that the edition now keeps
   * them, in the shape the data region draws, and that an edition without them is still a document.
   */
  describe('the stored data behind the drawings', () => {
    it('keeps all five priced buckets beside the lead probability', () => {
      const document = buildDailyBriefingDocument({
        packet: packet({
          policyPath: policyPath(77.5, {
            distribution: { 'no-change': 0.205, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.004, 'cut-50-plus': 0.001 }
          })
        }),
        date: '2026-10-30'
      })

      const distribution = document.data.policyPath?.distribution
      expect(Object.keys(distribution ?? {}).sort()).toEqual(['cut-25', 'cut-50-plus', 'hike-25', 'hike-50-plus', 'no-change'])
      // Normalized to one so the dial's three arcs can be shares of it without a second division.
      expect(Object.values(distribution ?? {}).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6)
      expect(distribution?.['hike-25']).toBeCloseTo(0.775, 6)
      // The lead probability is unchanged: the distribution is beside it, not instead of it.
      expect(document.data.policyPath?.probability).toBe(77.5)

      // A venue that priced only the lead outcome is not given four invented buckets.
      const partial = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(77.5) }), date: '2026-10-30' })
      expect(partial.data.policyPath).not.toHaveProperty('distribution')
      expect(partial.data.policyPath?.probability).toBe(77.5)
    })

    it('never stores a dial share that contradicts the printed probability', () => {
      const outcome = 'hike-25' as const
      const fixture = (distribution: Readonly<Record<typeof outcome | 'no-change' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', number>>) =>
        buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(77.5, { distribution }) }), date: '2026-10-30' })

      // The ordinary case: the venue's five buckets overshoot one by two tenths of a percent. After
      // normalization the lead bucket is 77.35% against a printed 77.5% — one number, not two.
      const overround = fixture({ 'no-change': 0.205, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.005, 'cut-50-plus': 0.002 })
      expect(overround.data.policyPath?.distribution?.[outcome]).toBeCloseTo(0.7735, 3)
      expect(Math.abs((overround.data.policyPath?.distribution?.[outcome] ?? 0) * 100 - 77.5)).toBeLessThanOrEqual(0.5)

      // A payload whose buckets do not add up enough to be trusted with a dial. Normalizing would
      // move the lead bucket to 85.2% while the card prints 77.5% — two odds for one fact — so the
      // distribution is not stored and the card falls back to two segments.
      const inconsistent = fixture({ 'no-change': 0.10, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.01, 'cut-50-plus': 0.01 })
      expect(inconsistent.data.policyPath).not.toHaveProperty('distribution')
      expect(inconsistent.data.policyPath?.probability).toBe(77.5)
      // Dropping it leaves a trace: a two-segment dial in three months must be answerable.
      expect(inconsistent.provenance.dataAudit).toEqual([{ field: 'policyPath.distribution', reason: 'inconsistent-totals' }])
      expect(overround.provenance.dataAudit).toBeUndefined()

      // An unpublished distribution is an absence, not a decision — nothing to audit.
      const absent = buildDailyBriefingDocument({ packet: packet({ policyPath: policyPath(77.5) }), date: '2026-10-30' })
      expect(absent.provenance.dataAudit).toBeUndefined()

      // Whatever survives must satisfy the invariant, checked rather than assumed.
      for (const document of [overround, inconsistent]) {
        const share = document.data.policyPath?.distribution?.[outcome]
        if (share === undefined) continue
        expect(Math.abs(share * 100 - (document.data.policyPath?.probability ?? 0))).toBeLessThanOrEqual(0.5)
      }
    })

    it('keeps each positioning series, thinned, ending on the amount printed beside it', () => {
      // Fifteen-minute buckets across the whole window: the read this edition asked for.
      const readings = (offset: number) => Array.from({ length: 97 }, (_, index) => ({
        observedAt: new Date(Date.parse(windowStart) + index * 900_000).toISOString(),
        notionalUsd: offset + index * 1_000_000
      }))
      const document = buildDailyBriefingDocument({
        packet: packet({
          positioning: {
            state: 'available', asOf, window: '24h',
            btc: readings(7_000_000_000), eth: readings(4_000_000_000),
            change: { btc: { h24Pct: 3.5 }, eth: { h24Pct: -1.2 } }
          } as unknown as NonNullable<DailyBriefingFactPacket['positioning']>
        }),
        date: '2026-10-30'
      })

      const btc = document.data.leverage?.btc
      expect(btc?.series).toHaveLength(24)
      // The card's amount and the end of its line are the same reading.
      expect(btc?.series?.at(-1)?.value).toBe(btc?.openInterestUsd)
      expect(btc?.series?.at(-1)?.at).toBe(readings(0).at(-1)?.observedAt)
      expect(document.data.leverage?.eth.series).toHaveLength(24)

      // A read with a single point keeps the amount and states no series; a failed read is a different
      // state entirely. Folding the two into one absence is what the card cannot tell apart.
      const single = buildDailyBriefingDocument({ packet: packet({ positioning: positioning(3.5, 1.2) }), date: '2026-10-30' })
      expect(single.data.leverage?.state).toBe('available')
      expect(single.data.leverage?.btc.openInterestUsd).toBe(1_200_000_000)
      expect(single.data.leverage?.btc).not.toHaveProperty('series')
    })

    it('states the window amplitude on the three readings with continuous bars, and on nothing else', () => {
      const coverage = { count: 289, expectedCount: 289, complete: true }
      const extremes = { high: 10_800, low: 10_100, anchor: 10_400 }
      const document = buildDailyBriefingDocument({
        packet: packet({
          market: {
            crossAsset: {
              analysisEnd: '2026-10-30T00:25:00.000Z',
              closedReturns: {
                btc: { '24h': { state: 'available', value: 3.8 } },
                eth: { '24h': { state: 'available', value: -1.18 } },
                index: { '24h': { state: 'available', value: 0.82 } }
              },
              indexSource: 'real',
              extremes: { btc: extremes, eth: extremes, index: extremes, dxy: null, gold: null },
              historyCoverage: { btc: coverage, eth: coverage, index: coverage, dxy: coverage, gold: coverage }
            } as unknown as CrossAssetSnapshot,
            macroMarket: packet().market.macroMarket,
            macroRates: packet().market.macroRates
          }
        }),
        date: '2026-10-30'
      })

      // (10 800 − 10 100) / 10 400 × 100, with the close the curve is also divided by.
      expect(document.schemaVersion).toBe(dailyBriefingPolicy.schemaVersion)
      for (const id of ['btc', 'eth', 'index'] as const) {
        expect(document.data.market.find((row) => row.id === id)?.amplitude)
          .toEqual({ percent: 6.73, high: 10_800, low: 10_100, anchor: 10_400 })
      }
      // DXY, gold and the ten-year carry no continuous series: they are not given a field at all, so
      // nothing downstream can show an amplitude for them.
      for (const id of ['dxy', 'gold', 'us10y', 'us10y-real'] as const) {
        const row = document.data.market.find((entry) => entry.id === id)!
        expect(row).not.toHaveProperty('amplitude')
        expect(row).not.toHaveProperty('amplitudeReason')
      }
    })

    it('withholds the Nasdaq amplitude on a proxy day rather than attributing it to the index', () => {
      const coverage = { count: 289, expectedCount: 289, complete: true }
      const extremes = { high: 10_800, low: 10_100, anchor: 10_400 }
      const build = (indexSource: 'real' | 'proxy') => buildDailyBriefingDocument({
        packet: packet({
          market: {
            crossAsset: {
              analysisEnd: '2026-10-30T00:25:00.000Z', indexSource,
              closedReturns: { btc: { '24h': { state: 'available', value: 3.8 } }, eth: { '24h': { state: 'available', value: -1 } }, index: { '24h': { state: 'available', value: 0.8 } } },
              extremes: { btc: extremes, eth: extremes, index: extremes },
              historyCoverage: { btc: coverage, eth: coverage, index: coverage }
            } as unknown as CrossAssetSnapshot,
            macroMarket: packet().market.macroMarket,
            macroRates: packet().market.macroRates
          }
        }),
        date: '2026-10-30'
      })

      // The index leg answered with the tokenised proxy: that amplitude belongs to the proxy, and the
      // row has no marker to carry it beside, so the number is withheld rather than mis-attributed.
      const proxied = build('proxy').data.market.find((row) => row.id === 'index')!
      expect(proxied).not.toHaveProperty('amplitude')
      expect(proxied).not.toHaveProperty('amplitudeReason')
      // BTC and ETH are unaffected: their bars are their own.
      expect(build('proxy').data.market.find((row) => row.id === 'btc')?.amplitude?.percent).toBe(6.73)
      // On a real-index day the row states it.
      expect(build('real').data.market.find((row) => row.id === 'index')?.amplitude?.percent).toBe(6.73)
    })

    it('withholds the amplitude on an incomplete window and says how incomplete', () => {
      const complete = { count: 289, expectedCount: 289, complete: true }
      const partial = { count: 231, expectedCount: 289, complete: false }
      const document = buildDailyBriefingDocument({
        packet: packet({
          market: {
            crossAsset: {
              analysisEnd: '2026-10-30T00:25:00.000Z',
              closedReturns: { btc: { '24h': { state: 'available', value: 3.8 } }, eth: { '24h': { state: 'available', value: -1 } }, index: { '24h': { state: 'available', value: 0.8 } } },
              indexSource: 'real',
              extremes: { btc: { high: 10_800, low: 10_100, anchor: 10_400 }, eth: null, index: null },
              historyCoverage: { btc: partial, eth: complete, index: complete }
            } as unknown as CrossAssetSnapshot,
            macroMarket: packet().market.macroMarket,
            macroRates: packet().market.macroRates
          }
        }),
        date: '2026-10-30'
      })

      const btc = document.data.market.find((row) => row.id === 'btc')!
      // A hole can hide the real high, so the number is withheld rather than understated — and the
      // counts travel with the reason so a later reader can see which window it was.
      expect(btc.amplitude).toBeUndefined()
      expect(btc.amplitudeReason).toBe('partial-bars')
      expect(btc.amplitudeCoverage).toEqual({ count: 231, expectedCount: 289 })
      // Full coverage but no anchored pair: no denominator, no number.
      const eth = document.data.market.find((row) => row.id === 'eth')!
      expect(eth.amplitudeReason).toBe('no-anchor')
    })

    it('keeps the price curve on the two cards that draw one, starting at the window and at zero', () => {
      const curve = Array.from({ length: 289 }, (_, index) => ({
        at: new Date(Date.parse(windowStart) + index * 300_000).toISOString(),
        returnPercent: index / 10
      }))
      const document = buildDailyBriefingDocument({
        packet: packet({
          market: {
            crossAsset: {
              analysisEnd: '2026-10-30T00:25:00.000Z',
              closedReturns: {
                btc: { '24h': { state: 'available', value: 28.8 } },
                eth: { '24h': { state: 'available', value: -1.18 } },
                index: { '24h': { state: 'available', value: 0.82 } }
              },
              curves: { btc: curve, eth: curve, index: curve }
            } as unknown as CrossAssetSnapshot,
            macroMarket: packet().market.macroMarket,
            macroRates: packet().market.macroRates
          }
        }),
        date: '2026-10-30'
      })

      expect(document.schemaVersion).toBe(dailyBriefingPolicy.schemaVersion)
      const btc = document.data.market.find((row) => row.id === 'btc')
      const points = btc?.curve?.[0] ?? []
      expect(btc?.curve).toHaveLength(1)
      expect(points.length).toBeLessThanOrEqual(48)
      expect(points[0]?.at).toBe(windowStart)
      expect(points[0]?.returnPercent).toBeCloseTo(0, 2)
      expect(document.data.market.find((row) => row.id === 'eth')?.curve).toHaveLength(1)
      // The index row has no plot beside it, so it is not given a line nobody draws.
      expect(document.data.market.find((row) => row.id === 'index')).not.toHaveProperty('curve')

      // Schemas 9 and older simply have no such field; reading one is not an error.
      const legacy = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })
      expect(legacy.data.market.find((row) => row.id === 'btc')?.curveReason).toBe('no-snapshot')
    })
  })
})

describe('the level behind the percentage', () => {
  it('records the close the window ended on, and which leg answered the index', () => {
    const document = buildDailyBriefingDocument({
      packet: packet({
        market: {
          crossAsset: {
            analysisEnd: '2026-10-30T00:25:00.000Z',
            indexSource: 'proxy',
            closedReturns: {
              btc: { '24h': { state: 'available', value: 3.8 } },
              eth: { '24h': { state: 'available', value: -1 } },
              index: { '24h': { state: 'available', value: 0.8 } }
            },
            lastClosed: {
              btc: { at: '2026-10-30T00:20:00.000Z', close: '110432.1' },
              eth: { at: '2026-10-30T00:20:00.000Z', close: '3840.55' },
              index: { at: '2026-10-30T00:20:00.000Z', close: '21348.7' }
            }
          } as unknown as CrossAssetSnapshot,
          macroMarket: packet().market.macroMarket,
          macroRates: packet().market.macroRates
        }
      }),
      date: '2026-10-30'
    })

    // A percentage without its base says nothing: the level travels with it, and its instant.
    expect(document.data.market.find((row) => row.id === 'btc')?.close).toEqual({ value: 110432.1, at: '2026-10-30T00:20:00.000Z' })
    expect(document.data.market.find((row) => row.id === 'eth')?.close?.value).toBe(3840.55)
    // The index row states which leg answered, so a proxy's move is never read as the index's.
    expect(document.data.market.find((row) => row.id === 'index')?.indexSource).toBe('proxy')
    // A macro row is not a cross-asset leg: it carries neither field.
    expect(document.data.market.find((row) => row.id === 'dxy')).not.toHaveProperty('close')
    expect(document.data.market.find((row) => row.id === 'dxy')).not.toHaveProperty('indexSource')
    // No closed bar at the cutoff is an absence, never a zero level.
    const noBar = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })
    expect(noBar.data.market.find((row) => row.id === 'btc')).not.toHaveProperty('close')
  })
})
