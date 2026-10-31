import { describe, expect, it } from 'vitest'

import { productText } from '../desktop/shared/i18n/productText'
import type { DailyBriefingDocument } from './dailyBriefing'
import { dailyBriefingToMarkdown } from './dailyBriefingMarkdown'

const labels = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const document = (overrides: Partial<DailyBriefingDocument> = {}): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: 'CPI 超预期 · Ripple 获批', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'JPMorgan says AI labels no longer win lenders', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', titleKey: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    funds: [{
      id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' },
      state: 'available', value: { number: 253_033_903_673.4, format: 'usd' }, change: { value: -0.33, unit: 'percent', window: '1d' },
      window: '1d', observedAt: '2026-10-30T00:12:00.000Z'
    }],
    sentiment: {
      fearGreed: { id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 48, format: 'score' }, change: null, window: 'latest', observedAt: null },
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 2 }, itemCount: 3 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.',
    translation: '稳定币收缩把买盘推走。',
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [{ statement: 'BTC ETF took in $110M.', citations: [1] }],
    topSignal: null, dataGaps: ['No consensus'], caveats: ['Funding is venue-specific.']
  },
  next: { items: [{ eventKey: 'US.FOMC', title: 'fomc', titleKey: 'fomc', at: '2026-11-02T18:00:00.000Z', importance: 'high', category: 'central-bank-activity' }] },
  citations: [{ index: 1, refId: 'ev-1', sourceLabel: 'DefiLlama', observedAt: '2026-10-30T00:00:00.000Z', statement: '稳定币收缩' }],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' },
  ...overrides
})

const options = {
  labels,
  locale: 'zh-CN' as const,
  direction: (term: string) => term,
  eventTitle: (item: Readonly<{ title: string }>) => item.title,
  formatTime: (value: string) => value.slice(0, 16)
}

describe('daily briefing markdown', () => {
  it('exports a text edition with rows, conclusion and citations', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)
    expect(markdown).toContain('# 每日简报 — 2026-10-30')
    expect(markdown).toContain('## 过去 24 小时要闻')
    expect(markdown).toContain('JPMorgan says AI labels no longer win lenders')
    expect(markdown).toContain('## 一天的数据')
    expect(markdown).toContain('### 重点')
    expect(markdown).toContain('稳定币')
    expect(markdown).toContain('## 结论')
    expect(markdown).toContain('稳定币收缩把买盘推走。')
    expect(markdown).toContain('Stablecoin contraction pulls bids away.')
    expect(markdown).toContain('什么会推翻它')
    expect(markdown).toContain('[1]')
    expect(markdown).toContain('## 接下来 7 日关注')
    expect(markdown).toContain('fomc')
    expect(markdown).toContain('证据')
    expect(markdown).toContain('DefiLlama')
    expect(markdown).toContain('稳定币收缩')
    expect(markdown).not.toContain('<svg')
    expect(markdown).not.toContain('<div')
  })

  it('states an empty edition instead of leaving blank sections', () => {
    const empty = document({
      status: { readings: [
        { id: 'fear-greed', state: 'unavailable' }, { id: 'funding', state: 'unavailable' },
        { id: 'capital', state: 'unavailable' }, { id: 'calendar', state: 'source-disabled' }
      ], readingsAvailable: 0, readingsTotal: 4 },
      lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
      news: { items: [], macro: [], notes: { newsEmpty: 'news-source-disabled', macroEmpty: 'calendar-source-disabled' } },
      data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'source-disabled' } } },
      conclusion: null,
      next: { items: [], note: 'calendar-source-disabled' }
    })
    const markdown = dailyBriefingToMarkdown(empty, options)
    expect(markdown).toContain('四个读数都读不到')
    expect(markdown).not.toContain('## 过去 24 小时要闻')
    expect(markdown).not.toContain('## 结论')
    expect(markdown).not.toContain('## 接下来 7 日关注')
  })

  it('renders only the data rows the editor kept', () => {
    const base = document()
    const markdown = dailyBriefingToMarkdown({
      ...base,
      data: {
        ...base.data,
        market: [
          ...base.data.market,
          {
            id: 'dxy' as const, labelKey: 'dailyBriefing.row.dxy',
            importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
            materiality: { material: true as const, reasonCode: 'fx-move' as const },
            visibility: 'hidden' as const, visibilityReason: 'not-selected',
            state: 'available' as const, value: { number: 0.43, format: 'percent' as const },
            change: null, window: '24h' as const, observedAt: '2026-10-30T00:25:00.000Z'
          }
        ],
        funds: base.data.funds.map((row) => ({
          ...row,
          visibility: 'hidden' as const,
          visibilityReason: 'no-material-change'
        }))
      }
    }, options)
    expect(markdown).toContain('BTC')
    expect(markdown).not.toContain('美元')
    expect(markdown).not.toContain('稳定币:')
  })

  it('escapes markdown punctuation in titles', () => {
    const markdown = dailyBriefingToMarkdown(document({
      news: {
        items: [{ itemId: 'n1', title: 'A *star* [link]', sourceName: 'S', publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'neutral', strength: 1, confidence: 50, symbols: ['BTC'] }],
        macro: [], notes: {}
      }
    }), options)
    expect(markdown).toContain('A \\*star\\* \\[link\\]')
  })
})
