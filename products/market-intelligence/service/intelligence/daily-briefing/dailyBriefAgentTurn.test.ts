import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { DailyBriefTurnAbortedError, runDailyBriefAgentTurn } from './dailyBriefAgentTurn'

const CJK = /[\u4e00-\u9fff]/

const document = (locale: DailyBriefingLocale): DailyBriefingDocument => ({
  schemaVersion: 6,
  policyVersion: 'daily-briefing.v17',
  edition: {
    date: '2026-10-30', locale, generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: 'Stablecoins keep contracting.', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'Stablecoin supply keeps shrinking', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    policyPath: { state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 76, observedAt: '2026-10-30T02:10:00.000Z' },
    leverage: { state: 'available', btc: { openInterestUsd: 1_200_000_000, change24hPct: -1.2 }, eth: { openInterestUsd: 800_000_000, change24hPct: 0.4 } },
    funds: [{
      id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin',
      importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available',
      value: { number: 253_033_903_673.4, format: 'usd' }, change: null, window: '1d', observedAt: '2026-10-30T00:12:00.000Z'
    }],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.', conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
  },
  next: {
    focus: {
      eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
      importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: 'United States', consensus: '4.25%'
    },
    items: []
  },
  citations: [],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

function fakeRunner() {
  const starts: { displayText?: string; context?: { label: string } }[] = []
  const continues: string[] = []
  return {
    starts,
    continues,
    runner: {
      start: vi.fn(async (input: { displayText?: string; context?: { label: string } }) => {
        starts.push(input)
        return {
          sessionId: 's1',
          created: true,
          assistantText: JSON.stringify({ stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [], requests: [{ factId: 'macro:US.CPI', fields: ['actual', 'translation'] }] }),
          toolInvocations: []
        }
      }),
      continue: vi.fn(async (_sessionId: string, text: string) => {
        continues.push(text)
        return { assistantText: '{}', toolInvocations: [] }
      }),
      finish: vi.fn(async () => undefined)
    }
  }
}

describe('daily brief agent turn copy', () => {
  it('does not open another agent round once the generation is aborted', async () => {
    const { continues, runner } = fakeRunner()
    const controller = new AbortController()
    const start = runner.start
    runner.start = vi.fn(async (input: { displayText?: string; context?: { label: string } }) => {
      const result = await start(input)
      controller.abort()
      return result
    })

    await expect(runDailyBriefAgentTurn({ runner, document: document('en-US'), locale: 'en-US', signal: controller.signal }))
      .rejects.toBeInstanceOf(DailyBriefTurnAbortedError)
    expect(continues).toHaveLength(0)
    expect(runner.finish).not.toHaveBeenCalled()
  })

  it('writes the first task, the fact card and the field answers in English for en-US', async () => {
    const { starts, continues, runner } = fakeRunner()
    await runDailyBriefAgentTurn({ runner, document: document('en-US'), locale: 'en-US' })
    expect(starts[0]?.context?.label).toBe('Daily brief facts')
    expect(starts[0]?.displayText).toContain('Task 1/2')
    expect(starts[0]?.displayText).toContain('Macro candidates 1')
    expect(starts[0]?.displayText).not.toMatch(CJK)
    const field = continues.find((text) => text.startsWith('FIELD RESPONSE'))
    expect(field).toContain('actual=3.4%')
    expect(field).toContain('translation=not collected')
    expect(field).not.toMatch(CJK)
  })

  it('keeps the Chinese session copy for zh-CN', async () => {
    const { starts, continues, runner } = fakeRunner()
    await runDailyBriefAgentTurn({ runner, document: document('zh-CN'), locale: 'zh-CN' })
    expect(starts[0]?.context?.label).toBe('日报输入事实')
    expect(starts[0]?.displayText).toContain('任务 1/2')
    expect(starts[0]?.displayText).toContain('宏观候选 1')
    const field = continues.find((text) => text.startsWith('FIELD RESPONSE'))
    expect(field).toContain('actual=3.4%')
    expect(field).toContain('translation=未收录')
  })
})
