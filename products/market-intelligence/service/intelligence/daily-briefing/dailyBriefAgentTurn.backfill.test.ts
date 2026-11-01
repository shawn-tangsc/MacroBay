import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { collectDataGaps, runDailyBriefAgentTurn, type DailyBriefBackfillExecutor } from './dailyBriefAgentTurn'

const WINDOW_END = '2026-10-30T00:00:00.000Z'

function documentWithGaps(): DailyBriefingDocument {
  const importance = { tier: 'must' as const, source: 'rule' as const, reasonCode: 'gap' as const }
  return {
    schemaVersion: 6,
    policyVersion: 'daily-briefing.v17',
    edition: {
      date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T13:00:00.000Z',
      windowStart: '2026-10-29T00:00:00.000Z', windowEnd: WINDOW_END, timeZone: 'Asia/Shanghai'
    },
    status: {
      readings: [
        { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
        { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
      ],
      readingsAvailable: 4, readingsTotal: 4
    },
    lede: { source: 'template', text: 'Stablecoins keep contracting.', generatedAt: '2026-10-30T13:00:00.000Z' },
    news: {
      items: [{
        itemId: 'n1', title: 'Stablecoin supply keeps shrinking', sourceName: 'CoinDesk RSS',
        publishedAt: '2026-10-29T23:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
      }],
      macro: [{
        eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
        importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
      }],
      notes: {}
    },
    data: {
      market: [
        {
          id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
          state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-29T23:00:00.000Z'
        },
        { id: 'dxy', labelKey: 'dailyBriefing.row.dxy', importance, state: 'unavailable', value: null, change: null, window: 'latest', observedAt: null, reason: 'query-failed' },
        { id: 'gold', labelKey: 'dailyBriefing.row.gold', importance, state: 'unavailable', value: null, change: null, window: 'latest', observedAt: null, reason: 'not-collected' },
        { id: 'us10y', labelKey: 'dailyBriefing.row.us10y', importance, state: 'stale', value: null, change: null, window: 'daily', observedAt: null, reason: 'stale-fallback' },
        { id: 'us10y-real', labelKey: 'dailyBriefing.row.us10yReal', importance, state: 'unavailable', value: null, change: null, window: 'daily', observedAt: null, reason: 'not-collected' }
      ],
      leverage: { state: 'unavailable', btc: {}, eth: {} },
      funds: [
        {
          id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin',
          importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available',
          value: { number: 253_033_903_673.4, format: 'usd' }, change: null, window: '1d', observedAt: '2026-10-29T23:00:00.000Z'
        },
        { id: 'etf-btc', group: 'funds', labelKey: 'dailyBriefing.row.etfBtc', importance, state: 'unavailable', value: null, change: null, window: 'trading-day', observedAt: null, reason: 'etf-unavailable' },
        { id: 'etf-eth', group: 'funds', labelKey: 'dailyBriefing.row.etfEth', importance, state: 'source-disabled', value: null, change: null, window: 'trading-day', observedAt: null },
        { id: 'funding-btc', group: 'funds', labelKey: 'dailyBriefing.row.fundingBtc', importance, state: 'unavailable', value: null, change: null, window: '24h', observedAt: null, reason: 'query-failed' },
        {
          id: 'funding-eth', group: 'funds', labelKey: 'dailyBriefing.row.fundingEth',
          importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available',
          value: { number: 0.005, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-29T23:30:00.000Z'
        }
      ],
      sentiment: {
        fearGreed: null,
        news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
      }
    },
    conclusion: {
      summaryId: 's1', publishedAt: '2026-10-29T23:00:00.000Z', direction: 'bearish', directions: [],
      summary: 'Stablecoin contraction pulls bids away.', conditions: ['Stablecoins keep contracting'],
      invalidations: [], counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
    },
    next: {
      focus: {
        eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
        importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: 'United States', consensus: '4.25%'
      },
      items: []
    },
    citations: [],
    provenance: { summaryId: 's1', readAt: WINDOW_END }
  }
}

function selection(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stage: 'select', focus: 'US.FOMC', news: ['news:n1'], macro: ['macro:US.CPI'], next: [], hidden: [], ...extra
  })
}

function fakeRunner(selections: readonly string[]) {
  const starts: { prompt?: string; displayText?: string; context?: { label: string } }[] = []
  const continues: string[] = []
  let index = 0
  return {
    starts,
    continues,
    runner: {
      start: vi.fn(async (input: { prompt?: string; displayText?: string; context?: { label: string } }) => {
        starts.push(input)
        return { sessionId: 's1', created: true, assistantText: selections[0] ?? selection(), toolInvocations: [] }
      }),
      continue: vi.fn(async (_sessionId: string, text: string) => {
        continues.push(text)
        index += 1
        return { assistantText: selections[index] ?? '{}', toolInvocations: [] }
      }),
      finish: vi.fn(async () => undefined)
    }
  }
}

const pricedFact = Object.freeze({
  state: 'available' as const,
  source: 'etf' as const,
  metric: 'etf-net-flow-btc' as const,
  asOf: WINDOW_END,
  value: 250_000_000,
  unit: 'flow-usd' as const,
  observedAt: '2026-10-29T22:00:00.000Z',
  sourceUrl: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history',
  method: 'etf-current-state-as-of'
})

describe('daily brief data gaps and backfill protocol', () => {
  it('names only the rows that are missing, with a stable source/metric id per row', () => {
    const gaps = collectDataGaps(documentWithGaps())
    expect(gaps.map((gap) => gap.id)).toEqual([
      'dxy:dxy-level',
      'gold:gold-level-usd',
      'treasury:us10y-yield-percent',
      'treasury:us10y-real-yield-percent',
      'etf:etf-net-flow-btc',
      'etf:etf-net-flow-eth',
      'funding:funding-rate-percent-btc',
      'open-interest:open-interest-usd-btc',
      'open-interest:open-interest-usd-eth'
    ])
    expect(gaps.every((gap) => gap.asOf === WINDOW_END)).toBe(true)
    // A source the reader turned off is visible as a gap but must never be requested.
    expect(gaps.find((gap) => gap.id === 'etf:etf-net-flow-eth')).toMatchObject({ state: 'source-disabled', requestable: false })
    expect(gaps.find((gap) => gap.id === 'etf:etf-net-flow-btc')).toMatchObject({ state: 'unavailable', requestable: true })
  })

  it('hands the gaps to selection and returns a backfilled value to the editor', async () => {
    const { starts, continues, runner } = fakeRunner([
      selection({ backfill: [{ source: 'etf', metric: 'etf-net-flow-btc', asOf: WINDOW_END }] })
    ])
    const backfill = vi.fn<DailyBriefBackfillExecutor>(async () => pricedFact)

    await runDailyBriefAgentTurn({ runner, document: documentWithGaps(), locale: 'zh-CN', backfill })

    expect(starts[0]?.prompt).toContain('DATA GAPS (frozen at 2026-10-30T00:00:00.000Z)')
    expect(starts[0]?.prompt).toContain('- etf:etf-net-flow-btc asOf=2026-10-30T00:00:00.000Z')
    expect(backfill).toHaveBeenCalledWith({ source: 'etf', metric: 'etf-net-flow-btc', asOf: WINDOW_END })

    const answer = continues.find((text) => text.startsWith('BACKFILL RESPONSE'))
    expect(answer).toBeDefined()
    expect(answer).toContain('value=250000000')
    expect(answer).toContain('observedAt=2026-10-29T22:00:00.000Z')
    expect(answer).toContain('sourceUrl=https://0xrouter.app/cexdata/etf/bitcoin/flow-history')
    expect(answer).toContain('method=etf-current-state-as-of')
    expect(answer).toContain('not in the frozen DOCUMENT')
  })

  it('keeps the gap when the historical reader cannot answer', async () => {
    const { continues, runner } = fakeRunner([
      selection({ backfill: [{ source: 'treasury', metric: 'us10y-yield-percent', asOf: WINDOW_END }] })
    ])
    const backfill = vi.fn<DailyBriefBackfillExecutor>(async () => Object.freeze({
      state: 'unavailable' as const,
      source: 'treasury',
      metric: 'us10y-yield-percent',
      asOf: WINDOW_END,
      gapCode: 'historical-as-of-unavailable' as const,
      detail: 'FRED daily closes are published as the current rates snapshot only.'
    }))

    await runDailyBriefAgentTurn({ runner, document: documentWithGaps(), locale: 'zh-CN', backfill })

    const answer = continues.find((text) => text.startsWith('BACKFILL RESPONSE'))
    expect(answer).toContain('GAP historical-as-of-unavailable')
    expect(answer).not.toContain('value=')
    // The writing stage still sees the frozen document: the official CPI actual is untouched and no
    // invented yield appears in its facts.
    const writing = continues.find((text) => text.includes('US.CPI'))
    expect(writing).toContain('3.4%')
    expect(writing).not.toContain('GAP historical-as-of-unavailable')
  })

  it('rejects an asOf after the frozen cutoff without calling the reader', async () => {
    const { continues, runner } = fakeRunner([
      selection({ backfill: [{ source: 'etf', metric: 'etf-net-flow-btc', asOf: '2026-10-30T00:00:00.001Z' }] })
    ])
    const backfill = vi.fn<DailyBriefBackfillExecutor>(async () => pricedFact)

    await runDailyBriefAgentTurn({ runner, document: documentWithGaps(), locale: 'zh-CN', backfill })

    expect(backfill).not.toHaveBeenCalled()
    expect(continues.find((text) => text.startsWith('BACKFILL RESPONSE'))).toContain('GAP future-as-of')
  })

  it('answers a named gap when no historian is wired, and never reads around a disabled source', async () => {
    const unwired = fakeRunner([selection({ backfill: [{ source: 'etf', metric: 'etf-net-flow-btc', asOf: WINDOW_END }] })])
    await runDailyBriefAgentTurn({ runner: unwired.runner, document: documentWithGaps(), locale: 'zh-CN' })
    expect(unwired.continues.find((text) => text.startsWith('BACKFILL RESPONSE'))).toContain('GAP backfill-unwired')

    const disabled = fakeRunner([selection({ backfill: [{ source: 'etf', metric: 'etf-net-flow-eth', asOf: WINDOW_END }] })])
    const backfill = vi.fn<DailyBriefBackfillExecutor>(async () => pricedFact)
    await runDailyBriefAgentTurn({ runner: disabled.runner, document: documentWithGaps(), locale: 'zh-CN', backfill })
    expect(backfill).not.toHaveBeenCalled()
    expect(disabled.continues.find((text) => text.startsWith('BACKFILL RESPONSE'))).toContain('GAP source-disabled')
  })

  it('rejects a request for a fact that is not one of the edition\'s gaps', async () => {
    const { continues, runner } = fakeRunner([
      selection({ backfill: [{ source: 'funding', metric: 'funding-rate-percent-eth', asOf: WINDOW_END }] })
    ])
    const backfill = vi.fn<DailyBriefBackfillExecutor>(async () => pricedFact)

    await runDailyBriefAgentTurn({ runner, document: documentWithGaps(), locale: 'en-US', backfill })

    expect(backfill).not.toHaveBeenCalled()
    expect(continues.find((text) => text.startsWith('BACKFILL RESPONSE'))).toContain('GAP not-a-gap')
  })
})
