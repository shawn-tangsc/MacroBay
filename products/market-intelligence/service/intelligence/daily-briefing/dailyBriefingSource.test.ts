import { describe, expect, it, vi } from 'vitest'

import type { AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import { createDailyBriefingSource, type DailyBriefingSourceDeps } from './dailyBriefingSource'


/** Tests keep calling one packet builder; the source itself now reads facts once, then renders. */
/**
 * A5.5 / A5.6：**采集单元是 (截止时刻, 统计窗口)**，与期号、语言无关。
 *
 * 两期同刻同窗口——哪怕语言不同——读的是同一条证据链，只该采一次；窗口不同则是两份不同的数，
 * 各采一次（拿 24h 的读数去当 4h 的报告，数不算错，口径错了）。这两条用例数的是**真实查询调用次数**，
 * 不是"看起来复用"。
 */
describe('one collection per (cutoff, window)', () => {
  const counting = () => {
    const d = deps()
    let reads = 0
    type Snapshot = (input: { asOf: string }) => unknown
    const query = (d.publicQuery as unknown as { queryFearGreedSnapshot: Snapshot }).queryFearGreedSnapshot
    ;(d.publicQuery as unknown as { queryFearGreedSnapshot: Snapshot }).queryFearGreedSnapshot = (input: { asOf: string }) => { reads += 1; return query(input) }
    return { source: createDailyBriefingSource(d), reads: () => reads }
  }

  it('reads once for two editions of the same moment and window', async () => {
    const { source, reads } = counting()
    await source.readFacts({ asOf, windowHours: 24 })
    await source.readFacts({ asOf, windowHours: 24 })
    expect(reads()).toBe(1)
  })

  it('reads twice for the same moment at two windows, instead of reusing one number', async () => {
    const { source, reads } = counting()
    await source.readFacts({ asOf, windowHours: 24 })
    await source.readFacts({ asOf, windowHours: 12 })
    expect(reads()).toBe(2)
  })
})

const makeSource = (deps: Parameters<typeof createDailyBriefingSource>[0]) => {
  const source = createDailyBriefingSource(deps)
  return {
    ...source,
    async buildPacket(input: Readonly<{ asOf: string; windowEnd?: string; windowHours?: number; locale: Parameters<typeof source.renderPacket>[1]; timeZone: string }>) {
      const facts = await source.readFacts({
        asOf: input.asOf,
        ...(input.windowEnd === undefined ? {} : { windowEnd: input.windowEnd }),
        ...(input.windowHours === undefined ? {} : { windowHours: input.windowHours })
      })
      return source.renderPacket(facts, input.locale, input.timeZone)
    }
  }
}

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
  macroHistory?: (input: { series: 'dxy' | 'gold'; asOf: string }) => unknown
  macroRates?: unknown
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
      queryMacroHistoryAsOf: (input: { series: 'dxy' | 'gold'; asOf: string }) => overrides.macroHistory?.(input),
      queryMacroRatesSnapshot: () => overrides.macroRates,
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

describe('the market window ends at the cutoff, not at the read moment', () => {
  // 方向性用例（Chief 2026-11-06 要求）：下午生成一版"截止 08:00"的日报，
  // 任何窗口读的版本截止都不得落在未来——反例就是 11/06 那三版整块跨资产读不到。
  it('asks the cross-asset read with the cutoff as the window end, and never with a future knowledge cutoff', async () => {
    const input = { asOf: '2026-11-05T15:30:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z', windowHours: 24, locale: 'zh-CN' as const, timeZone: 'Asia/Shanghai' }
    const asked: Readonly<{ range: string; asOf: string; knowledgeAt: string }>[] = []
    const base = deps()
    const source = makeSource({
      ...base,
      publicQuery: {
        ...(base.publicQuery as object),
        queryCrossAssetSnapshot: async (queryInput: Readonly<{ range: string; asOf: string; knowledgeAt: string }>) => {
          asked.push(queryInput)
          return undefined
        }
      } as never
    })
    await source.buildPacket(input)
    expect(asked).toHaveLength(1)
    // 窗口末端 = 这一版的统计截止（08:00 本地），不是读数那一刻（15:30Z）。
    expect(asked[0]!.asOf).toBe(input.windowEnd)
    expect(Date.parse(asked[0]!.knowledgeAt)).toBeLessThanOrEqual(Date.parse(input.asOf))
  })
})

describe('daily briefing source', () => {
  it('reads the latest published conclusion, the 24h news, the readings and both calendars', async () => {
    const packet = await makeSource(deps()).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.windowStart).toBe('2026-10-29T00:30:00.000Z')
    expect(packet.windowHours).toBe(24)
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

  it('reads the configured statistical window instead of assuming 24 hours', async () => {
    const wide = await makeSource(deps()).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai', windowHours: 48 })
    expect(wide.windowHours).toBe(48)
    expect(wide.windowStart).toBe('2026-10-28T00:30:00.000Z')

    const narrow = await makeSource(deps()).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai', windowHours: 12 })
    expect(narrow.windowHours).toBe(12)
    expect(narrow.windowStart).toBe('2026-10-29T12:30:00.000Z')
    // The news inside a 12h window survives; the query still asked for its smallest horizon.
    expect(narrow.news.items.map((item) => item.itemId)).toEqual(['n1'])
  })

  it('drops news published before the configured window', async () => {
    const base = deps()
    const news = base.news as unknown as { query: (input: unknown) => Promise<unknown> }
    news.query = async () => ({
      state: 'available', asOf, generatedAt: asOf, window: '24h',
      items: [
        { itemId: 'fresh', title: 'Fresh', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS', publishedAt: '2026-10-30T00:00:00.000Z', scoredAt: asOf, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: [] },
        { itemId: 'stale', title: 'Stale', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS', publishedAt: '2026-10-29T08:00:00.000Z', scoredAt: asOf, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: [] }
      ],
      caveats: []
    })
    const packet = await makeSource(base).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai', windowHours: 12 })
    expect(packet.news.items.map((item) => item.itemId)).toEqual(['fresh'])
  })

  it('reads the world at the run instant, so an actual that arrived after the cutoff is visible', async () => {
    // 用户 2026-11-05 定：读数用运行时刻，窗口仍按截止。这里截止是 08:00（00:00Z），运行是 12:20（04:20Z），
    // 库里 12:20 才回补的实际值必须被这一次读看见。
    const cutoff = '2026-10-31T00:00:00.000Z'
    const readAt = '2026-10-31T04:20:00.000Z'
    const base = deps()
    const publicQuery = base.publicQuery as unknown as { queryMarketCalendarMonth: (input: { month: string; locale: string; asOf: string }) => unknown }
    const askedAsOf: string[] = []
    publicQuery.queryMarketCalendarMonth = (input) => {
      askedAsOf.push(input.asOf)
      return {
        state: 'available', month: input.month, locale: input.locale, asOf: input.asOf, sources: [],
        // 这个源按 as-of 给出它那一刻知道的实际值：读到运行时刻才有值。
        events: [{ ...marketEvent, scheduledAt: '2026-10-30T13:15:00.000Z', providerActual: input.asOf >= readAt ? { displayValue: '86.0' } : null }]
      }
    }
    const packet = await makeSource(base).buildPacket({ asOf: readAt, windowEnd: cutoff, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.calendar.events.find((event) => event.eventKey === 'MC.FOMC')?.actual).toBe('86.0')
    // 值到了，就要真的进正文（这是用户点重跑期待看到的那一栏）。
    const document = buildDailyBriefingDocument({ packet, date: '2026-10-31' })
    expect(document.news.macro.map((item) => item.eventKey)).toContain('MC.FOMC')
    expect(document.news.macro.find((item) => item.eventKey === 'MC.FOMC')?.actual).toBe('86.0')
    // 窗口仍然是截止前 24 小时，没有跟着读数时刻走。
    expect(packet.windowEnd).toBe(cutoff)
    expect(packet.windowStart).toBe('2026-10-30T00:00:00.000Z')
    // 一次读就够：不再有"按事件时刻 +1 小时"的第二问，那条路补不进晚到的回补。
    expect(new Set(askedAsOf)).toEqual(new Set([readAt]))
  })

  it('stops the window at the cutoff even though the read is later', async () => {
    // 边界用例：一条在窗口内、一条在截止之后但在读数时刻之前。后者不属于这一期的"过去 24 小时"。
    const cutoff = '2026-10-31T00:00:00.000Z'
    const readAt = '2026-10-31T04:20:00.000Z'
    const base = deps()
    const publicQuery = base.publicQuery as unknown as { queryMarketCalendarMonth: (input: { month: string; locale: string; asOf: string }) => unknown }
    publicQuery.queryMarketCalendarMonth = (input) => ({
      state: 'available', month: input.month, locale: input.locale, asOf: input.asOf, sources: [],
      events: [
        { ...marketEvent, eventKey: 'IN.WINDOW', scheduledAt: '2026-10-30T13:15:00.000Z', providerActual: { displayValue: '1' } },
        { ...marketEvent, eventKey: 'AFTER.CUTOFF', scheduledAt: '2026-10-31T02:00:00.000Z', providerActual: { displayValue: '2' } }
      ]
    })
    const facts = await makeSource(base).readFacts({ asOf: readAt, windowEnd: cutoff, windowHours: 24 })
    expect(facts.windowStart).toBe('2026-10-30T00:00:00.000Z')
    expect(facts.windowEnd).toBe(cutoff)
    const packet = await makeSource(base).buildPacket({ asOf: readAt, windowEnd: cutoff, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const keys = packet.calendar.events.map((event) => event.eventKey)
    // 事件本身读得到（读的是最新库），但窗口筛选在文档层按截止切。
    expect(keys).toContain('AFTER.CUTOFF')
    const document = buildDailyBriefingDocument({ packet, date: '2026-10-31' })
    expect(document.news.macro.map((item) => item.eventKey)).toEqual(['IN.WINDOW'])
  })

  it('drops news published after the cutoff even when the read is later', async () => {
    const cutoff = '2026-10-31T00:00:00.000Z'
    const readAt = '2026-10-31T04:20:00.000Z'
    const base = deps()
    const news = base.news as unknown as { query: (input: unknown) => Promise<unknown> }
    news.query = async () => ({
      state: 'available', asOf: readAt, generatedAt: readAt, window: '24h',
      items: [
        { itemId: 'in-window', title: 'In', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS', publishedAt: '2026-10-30T20:00:00.000Z', scoredAt: readAt, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: [] },
        { itemId: 'after-cutoff', title: 'After', sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS', publishedAt: '2026-10-31T02:00:00.000Z', scoredAt: readAt, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'x', engine: 'rules', caveats: [] }
      ],
      caveats: []
    })
    const packet = await makeSource(base).buildPacket({ asOf: readAt, windowEnd: cutoff, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(packet.news.items.map((item) => item.itemId)).toEqual(['in-window'])
  })

  it('sends no web search when the second level is not provided (switch off)', async () => {
    // 开关关掉时组装层不给 reader：编排层数到的联网次数必须是 0，而不是"看起来会调"。
    const packet = await makeSource(deps()).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(packet.macroValueCounts?.webCalls).toBe(0)
  })

  it('never searches for an event the calendar re-read answered', async () => {
    const base = deps()
    // 第二次读日历源时才带回实际值：第一级答上，第二级一次都不该发。
    let reads = 0
    ;(base.publicQuery as unknown as { queryMarketCalendarMonth: (input: unknown) => unknown }).queryMarketCalendarMonth = () => {
      reads += 1
      return {
        state: 'available', month: asOf.slice(0, 7), locale: 'zh', asOf, sources: [],
        events: [reads >= 4
          ? { ...marketEvent, scheduledAt: '2026-10-29T12:30:00.000Z', providerActual: { displayValue: '4.00%' } }
          : { ...marketEvent, scheduledAt: '2026-10-29T12:30:00.000Z' }]
      }
    }
    const web = vi.fn(async () => ({ values: [], conflicts: [], calls: 1 }))
    const packet = await makeSource({ ...base, macroWebRead: web })
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(packet.macroValueCounts?.calendarCalls).toBeGreaterThan(0)
    expect(web).not.toHaveBeenCalled()
    expect(packet.macroValueCounts?.webCalls).toBe(0)
  })

  it('falls to the web level only when the re-read could not answer', async () => {
    const base = deps()
    ;(base.publicQuery as unknown as { queryMarketCalendarMonth: (input: unknown) => unknown }).queryMarketCalendarMonth = () => ({
      state: 'available', month: asOf.slice(0, 7), locale: 'zh', asOf, sources: [],
      events: [{ ...marketEvent, scheduledAt: '2026-10-29T12:30:00.000Z' }]
    })
    const web = vi.fn(async (events: readonly { eventKey: string }[]) => ({
      values: events.map((event) => ({ eventKey: event.eventKey, actual: '4.00%', sourceUrl: 'https://example.gov/x', capturedAt: asOf, excerpt: 'actual 4.00%', kind: 'official' as const })),
      conflicts: [],
      calls: events.length
    }))
    const packet = await makeSource({ ...base, macroWebRead: web })
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(web).toHaveBeenCalledTimes(1)
    expect(packet.macroValueCounts?.webCalls).toBe(1)
    expect(packet.calendar.events.find((event) => event.eventKey === 'MC.FOMC')?.actual).toBe('4.00%')
  })

  it('degrades each read to a stated gap instead of failing the packet', async () => {
    const packet = await makeSource(deps({ failReadings: true, failCalendar: true }))
      .buildPacket({ asOf, locale: 'en-US', timeZone: 'UTC' })

    expect(packet.readings.fearGreed).toMatchObject({ state: 'unavailable' })
    expect(packet.calendar).toMatchObject({ state: 'unavailable', events: [] })
    expect(packet.conclusion?.summary.id).toBe('mi-as-1')
    expect(packet.news.state).toBe('available')
  })

  it('treats a clean install as fully disabled, while an unreadable profile store is unknown', async () => {
    const clean = await makeSource(deps({ profiles: [] }))
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'UTC' })
    expect(clean.enabled).toEqual({ fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: false })
    expect(clean.calendar.state).toBe('source-disabled')

    const unknown = await makeSource(deps({ profiles: 'throw' }))
      .buildPacket({ asOf, locale: 'zh-CN', timeZone: 'UTC' })
    expect(unknown.enabled).toEqual({ fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true })
  })

  it('reads the dollar and gold at the 08:00 cutoff instead of the 21:00 current snapshot', async () => {
    const cutoff = '2026-10-30T00:00:00.000Z'
    const packet = await makeSource(deps({
      macroHistory: (input) => input.series === 'dxy'
        ? {
          state: 'available', series: 'dxy', seriesId: 'dxy-synthetic', asOf: input.asOf,
          value: 100.5, observedAt: '2026-10-29T23:45:00.000Z', method: 'dxy-basket-synthesis-as-of',
          sourceUrl: 'https://api.twelvedata.com', synthetic: true, returns: { '24h': 0.25 }
        }
        : {
          state: 'available', series: 'gold', seriesId: 'xau-usd', asOf: input.asOf,
          value: 4_150.25, observedAt: '2026-10-29T23:50:00.000Z', method: 'gold-store-as-of',
          sourceUrl: 'https://api.realmarketapi.com/api/v1/price', returns: { '24h': -1.5 }
        }
    })).buildPacket({ asOf: cutoff, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.market.macroMarket?.asOf).toBe(cutoff)
    expect(packet.market.macroMarket?.readings).toMatchObject([
      { seriesId: 'dxy-synthetic', level: 100.5, synthetic: true, returns: { '24h': 0.25 } },
      { seriesId: 'xau-usd', level: 4_150.25, returns: { '24h': -1.5 } }
    ])
    expect(packet.market.macroMarket?.readings[0]?.atMs).toBe(Date.parse('2026-10-29T23:45:00.000Z'))
  })

  it('does not let a reading observed after the cutoff stand in for the 08:00 edition', async () => {
    // The edition cutoff is 08:00 Beijing (00:00Z); the app was opened at 21:00 the same day. A
    // projection that answers with the later bar is refused rather than published as the cutoff.
    const cutoff = '2026-10-30T00:00:00.000Z'
    const packet = await makeSource(deps({
      macroHistory: (input) => ({
        state: 'available', series: input.series, seriesId: input.series === 'dxy' ? 'dxy-real' : 'xau-usd',
        asOf: input.asOf, value: 4_000, observedAt: '2026-10-30T12:00:00.000Z',
        method: 'store', sourceUrl: 'https://example.com', returns: { '24h': 1 }
      }),
      macroRates: {
        state: 'available', asOf: '2026-10-30T13:00:00.000Z', caveats: ['official-daily-close'],
        readings: [
          { seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 4.1, period: '2026-10-29' },
          { seriesId: 'DFII10', metricKey: 'US_REAL_YIELD_10Y', actual: 1.9, period: '2026-10-30' }
        ]
      }
    })).buildPacket({ asOf: cutoff, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.market.macroMarket).toBeUndefined()
    // FRED's closes are stamped by trading day: D-1's close was known at 08:00, D's was not.
    expect(packet.market.macroRates).toMatchObject({
      state: 'available', asOf: cutoff, readings: [{ seriesId: 'DGS10', period: '2026-10-29' }]
    })
  })

  it('keeps a capital snapshot from after the cutoff out of the packet', async () => {
    const base = deps()
    const publicQuery = base.publicQuery as unknown as { queryCapitalConditionsSnapshot: () => unknown }
    publicQuery.queryCapitalConditionsSnapshot = async () => ({
      state: 'available', asOf: '2026-10-30T13:00:00.000Z', etf: { state: 'unavailable' },
      coreStablecoins: {
        observedAt: '2026-10-30T12:00:00.000Z', verifiedAt: '2026-10-30T13:00:00.000Z',
        currentUsd: 9, change1dUsd: 1, change1dPercent: 0.1,
        change7dUsd: 1, change7dPercent: 0.1, change30dUsd: 1, change30dPercent: 0.1
      },
      conclusion: 'partial'
    })
    const packet = await makeSource(base)
      .buildPacket({ asOf: '2026-10-30T00:00:00.000Z', locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.readings.capital).toEqual({ state: 'empty', asOf: '2026-10-30T00:00:00.000Z' })
  })

  it('keeps the rates block empty instead of showing only post-cutoff closes', async () => {
    const packet = await makeSource(deps({
      macroRates: {
        state: 'available', asOf: '2026-10-30T13:00:00.000Z', caveats: ['official-daily-close'],
        readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 4.2, period: '2026-10-30' }]
      }
    })).buildPacket({ asOf: '2026-10-30T00:00:00.000Z', locale: 'en-US', timeZone: 'Asia/Shanghai' })

    expect(packet.market.macroRates).toMatchObject({ state: 'empty', readings: [] })
  })

  it('collects the window’s analysis and brief conclusions, oldest first, without the current edition', async () => {
    const briefDocument = {
      edition: {
        date: '2026-10-29', locale: 'zh-CN', generatedAt: '2026-10-29T00:30:00.000Z',
        windowStart: '2026-10-28T00:30:00.000Z', windowEnd: '2026-10-29T00:30:00.000Z', timeZone: 'Asia/Shanghai'
      },
      conclusion: {
        direction: 'bullish', summary: 'Liquidity expansion supports bids.', synthesis: 'agent',
        synthesisDetail: { confidence: 'medium', coreTension: 'Price lags flows.', evidenceRefs: ['data:btc'] }
      },
      citations: [{ index: 1, refId: 'ev-9' }],
      provenance: { summaryId: 's1', readAt: '2026-10-29T00:30:00.000Z' }
    }
    const currentDocument = {
      ...briefDocument,
      edition: { ...briefDocument.edition, date: '2026-10-30', windowEnd: '2026-10-30T00:30:00.000Z' },
      conclusion: { ...briefDocument.conclusion, summary: 'Current edition must not feed itself.' }
    }
    const base = deps()
    const packet = await makeSource({
      ...base,
      briefEditions: {
        list: async () => [
          { date: '2026-10-29', locale: 'zh-CN', generatedAt: '2026-10-29T00:30:00.000Z', windowStart: '2026-10-28T00:30:00.000Z', windowEnd: '2026-10-29T00:30:00.000Z', document: briefDocument as never },
          { date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z', windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', document: currentDocument as never }
        ]
      }
    }).buildPacket({ asOf, locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(packet.priorConclusions?.map((item) => item.id)).toEqual([
      'daily-brief:2026-10-29:zh-CN',
      'analysis:mi-as-1'
    ])
    expect(packet.priorConclusions?.[1]).toMatchObject({
      source: 'analysis', direction: 'bearish', confidence: 'unknown', summary: 'Flows pull bids away.'
    })
    expect(packet.priorConclusions?.[0]).toMatchObject({
      source: 'daily-brief', direction: 'bullish', confidence: 'medium', rationale: 'Price lags flows.',
      evidenceRefs: ['data:btc', 'ev-9']
    })
  })
})


describe('one fact read, two languages', () => {
  it('reads the facts once and renders every language from the same snapshot', async () => {
    const base = deps() as never as Record<string, never> & { news: { query: (...args: unknown[]) => Promise<unknown> } }
    let reads = 0
    const original = base.news.query
    base.news = { ...base.news, query: async (...args: unknown[]) => { reads += 1; return original(...args) } } as never
    const source = createDailyBriefingSource(base as never)

    const facts = await source.readFacts({ asOf, windowHours: 24 })
    const chinese = await source.renderPacket(facts, 'zh-CN', 'Asia/Shanghai')
    const english = await source.renderPacket(facts, 'en-US', 'Asia/Shanghai')

    // The machine check the acceptance asks for: the fact readers ran exactly once for two editions.
    expect(reads).toBe(1)
    expect(chinese.windowEnd).toBe(english.windowEnd)
    expect(chinese.news.items.map((item) => item.itemId)).toEqual(english.news.items.map((item) => item.itemId))
    expect([chinese.locale, english.locale]).toEqual(['zh-CN', 'en-US'])
  })
})
