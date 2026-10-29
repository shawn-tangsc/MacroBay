import { describe, expect, it } from 'vitest'

import type { AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import { createDailyBriefingSource, type DailyBriefingSourceDeps } from './dailyBriefingSource'

const asOf = '2026-10-30T00:30:00.000Z'

const summary = {
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  conclusion: {
    direction: 'bearish', summary: 'Flows pull bids away.', change: 'No change.', causalChain: 'Flows -> bids.',
    conditions: [], macro: null, evidenceStrength: null, dataGaps: []
  },
  knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
  scenarios: [], directions: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'],
  createdAt: '2026-10-30T00:00:00.000Z'
} as unknown as AnalysisSummary

const officialEvent = {
  eventKey: 'US.CPI', releaseGroupKey: 'US.CPI', eventFamily: 'inflation', titleKey: 'cpi', countryCode: 'US',
  importance: 'high', periodKey: '2026-09', lifecycleState: 'released', coverage: 'available',
  scheduledDate: '2026-10-29', scheduledAt: undefined, conventionScheduledAt: '2026-10-29T12:30:00.000Z', releaseTimeSource: 'convention-default',
  detectedAt: '2026-10-29T12:31:00.000Z', actual: { displayValue: '3.4%' }, previous: { displayValue: '3.1%' },
  consensus: { displayValue: '3.2%' }
}

const marketEvent = {
  eventKey: 'MC.FOMC', title: 'FOMC rate decision', countryCode: 'US', eventType: 'central-bank-activity',
  importance: 'high', scheduledAt: '2026-11-02T18:00:00.000Z', consensus: { displayValue: '4.00%' },
  providerPrevious: { displayValue: '4.25%' }, providerActual: null, source: '0xRouter',
  sourceObservedAt: '2026-10-30T00:00:00.000Z', coverage: 'observed-unverified'
}

function deps(overrides: {
  profiles?: readonly { sourceId: string; enabled: boolean }[] | 'throw'
  failReadings?: boolean
  failCalendar?: boolean
} = {}): DailyBriefingSourceDeps {
  return {
    repository: {
      listTimeline: () => ({
        items: [{
          id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis',
          status: 'published', occurredAt: '2026-10-30T00:00:00.000Z', summaryRef: 'mi-as-1',
          safeTitle: '分析已发布', safeExcerpt: null, direction: 'bearish', version: 1
        }],
        nextCursor: null
      }),
      getSummary: () => summary,
      listPredictions: () => [],
      getRun: () => ({ snapshotId: 'snap-1' }),
      getSnapshot: () => ({ evidenceRefs: [{ evidenceRefId: 'ev-1', sourceId: 's', sourceLabel: 'Source', itemId: 'n1', occurredAt: null, publishedAt: null, detectedAt: null, computedAt: null, visibleAt: '2026-10-30T00:00:00.000Z', excerptHash: 'h' }] })
    } as never,
    publicQuery: {
      queryFearGreedSnapshot: async () => overrides.failReadings
        ? Promise.reject(new Error('down'))
        : { state: 'available', asOf, score: 48, bucket: 'fear', observedAt: '2026-10-30T00:00:00.000Z' },
      queryFundingRateHistory: async () => ({
        state: 'available', asOf,
        btc: [{ observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.008 }],
        eth: [{ observedAt: '2026-10-30T00:00:00.000Z', ratePercent: 0.005 }]
      }),
      queryCapitalConditionsSnapshot: async () => ({
        state: 'available', asOf, etf: { state: 'unavailable' },
        coreStablecoins: {
          observedAt: '2026-10-30T00:00:00.000Z', verifiedAt: asOf, currentUsd: 1, change1dUsd: 1, change1dPercent: 0.1,
          change7dUsd: 1, change7dPercent: 0.1, change30dUsd: 1, change30dPercent: 0.1
        },
        conclusion: 'partial'
      }),
      queryCrossAssetSnapshot: async () => undefined,
      queryMacroMarketSnapshot: () => undefined,
      queryMacroRatesSnapshot: () => undefined,
      queryMacroEconomicCalendarMonth: async () => overrides.failCalendar
        ? { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
        : { state: 'available', asOf, events: [officialEvent] },
      queryMarketCalendarMonth: () => overrides.failCalendar
        ? { state: 'unavailable', failureCode: 'query-unavailable' }
        : { state: 'available', month: asOf.slice(0, 7), locale: 'zh', asOf, events: [marketEvent], sources: [] }
    } as never,
    news: {
      query: async () => ({
        state: 'available', asOf, generatedAt: asOf, window: '24h',
        items: [{
          itemId: 'n1', title: 'Headline', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS',
          publishedAt: '2026-10-30T00:00:00.000Z', scoredAt: asOf, polarity: 'bearish', strength: 3,
          confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: []
        }],
        caveats: []
      })
    } as never,
    profiles: overrides.profiles === 'throw'
      ? { listProfiles: async () => { throw new Error('no store') } } as never
      : {
        listProfiles: async () => overrides.profiles ?? [
          { sourceId: 'alternative-fear-greed', enabled: true },
          { sourceId: 'binance-futures-positioning', enabled: true },
          { sourceId: 'defillama-stablecoins', enabled: true },
          { sourceId: '0xrouter-aggregate-provider', enabled: true },
          { sourceId: 'macro-calendar-fed', enabled: true }
        ]
      } as never
  }
}

describe('daily briefing source', () => {
  it('reads the latest published conclusion, the 24h news, the readings and both calendars', async () => {
    const packet = await createDailyBriefingSource(deps()).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.windowStart).toBe('2026-10-29T00:30:00.000Z')
    expect(packet.conclusion?.summary.id).toBe('mi-as-1')
    expect(packet.conclusion?.direction).toBe('bearish')
    expect(packet.news.items[0]?.itemId).toBe('n1')
    expect(packet.readings.fearGreed.state).toBe('available')
    expect(packet.calendar.state).toBe('available')
    expect(packet.calendar.events.map((event) => event.eventKey).sort()).toEqual(['MC.FOMC', 'US.CPI'])
    expect(packet.calendar.events.find((event) => event.eventKey === 'US.CPI')).toMatchObject({
      title: 'cpi', titleKey: 'cpi', category: 'economic-indicator', scheduledAt: '2026-10-29T12:30:00.000Z', surprise: { direction: 'beat', unit: 'pp' }
    })
    expect(packet.calendar.events.find((event) => event.eventKey === 'MC.FOMC')).toMatchObject({
      title: 'FOMC rate decision', lifecycleState: 'scheduled'
    })
    expect(packet.enabled).toMatchObject({ fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true })
  })

  it('degrades each read to a stated gap instead of failing the packet', async () => {
    const packet = await createDailyBriefingSource(deps({ failReadings: true, failCalendar: true }))
      .buildPacket({ asOf, locale: 'en-US', timeZone: 'UTC' })

    expect(packet.readings.fearGreed).toMatchObject({ state: 'unavailable' })
    expect(packet.calendar).toMatchObject({ state: 'unavailable', events: [] })
    expect(packet.conclusion?.summary.id).toBe('mi-as-1')
    expect(packet.news.state).toBe('available')
  })

  it('treats a clean install as fully disabled, while an unreadable profile store is unknown', async () => {
    const clean = await createDailyBriefingSource(deps({ profiles: [] }))
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'UTC' })
    expect(clean.enabled).toEqual({ fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: false })
    expect(clean.calendar.state).toBe('source-disabled')

    const unknown = await createDailyBriefingSource(deps({ profiles: 'throw' }))
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'UTC' })
    expect(unknown.enabled).toEqual({ fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true })
  })
})
