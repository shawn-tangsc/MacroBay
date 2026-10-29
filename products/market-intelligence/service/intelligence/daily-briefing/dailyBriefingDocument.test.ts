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
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
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
  asOf, windowStart, windowEnd: asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai',
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
    } as unknown as MacroMarketSnapshotView,
    macroRates: {
      state: 'available',
      readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5, previous: 4.96, period: '2026-10-29' }]
    } as unknown as MacroRatesSnapshotView
  },
  enabled: { fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true },
  ...overrides
})

describe('daily briefing document', () => {
  it('builds the six readings, market rows, news, macro, next and conclusion', () => {
    const document = buildDailyBriefingDocument({ packet: packet(), date: '2026-10-30' })

    expect(document.edition).toMatchObject({ date: '2026-10-30', locale: 'zh-CN', windowStart })
    expect(document.status).toMatchObject({ readingsAvailable: 4, readingsTotal: 4 })
    expect(document.data.funds).toHaveLength(5)
    expect(document.data.funds.every((row) => row.importance.tier === 'must')).toBe(true)
    expect(document.data.sentiment.fearGreed?.importance.tier).toBe('must')
    expect(document.data.market).toHaveLength(6)
    expect(document.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
    expect(document.data.market.find((row) => row.id === 'us10y')?.importance.tier).toBe('support')
    expect(document.data.market.find((row) => row.id === 'us10y')?.change).toMatchObject({ unit: 'bp', value: 4 })

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
    expect(document.lede.text).toContain('CPI')
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
    expect(document.data.market.find((row) => row.id === 'btc')).toMatchObject({ state: 'stale', reason: 'stale-fallback', value: { number: -0.43, format: 'percent' } })
    expect(document.data.market.find((row) => row.id === 'eth')).toMatchObject({ state: 'stale', value: { number: -1.21, format: 'percent' } })
  })

  it('keeps a readable document when the market sources are absent', () => {
    const document = buildDailyBriefingDocument({ packet: packet({ market: {} }), date: '2026-10-30' })
    expect(document.data.market).toHaveLength(6)
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
})
