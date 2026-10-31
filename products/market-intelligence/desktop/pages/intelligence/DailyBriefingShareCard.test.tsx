// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'

const text = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
const zhText = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const CJK = /[\u4e00-\u9fff]/

const briefing = (): DailyBriefingDocument => ({
  schemaVersion: 6,
  policyVersion: 'daily-briefing.v17',
  edition: {
    date: '2026-10-30', locale: 'en-US', generatedAt: '2026-10-30T00:30:00.000Z',
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
    items: [],
    macro: [{
      eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-10-30T00:00:00.000Z',
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
    funds: [],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 2, bullish: 1, mixed: 0, neutral: 1 }, itemCount: 4 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.',
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
  },
  next: {
    items: [],
    focus: {
      eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
      importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: '美国'
    }
  },
  citations: [
    { index: 1, refId: 'macro-calendar:US.CPI', observedAt: '2026-10-30T00:00:00.000Z' },
    { index: 2, refId: 'news:n1', observedAt: '2026-10-30T00:00:00.000Z' },
    { index: 3, refId: 'ev-1' }
  ],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

const renderWith = async (
  doc: DailyBriefingDocument,
  copy: typeof text,
  locale: 'zh-CN' | 'en-US'
): Promise<HTMLDivElement> => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const formatTime = (value: string): string => value.slice(0, 16).replace('T', ' ')
  await act(async () => root!.render(createElement(DailyBriefingShareCard, { document: doc, text: copy, locale, formatTime })))
  return host
}

const render = (doc: DailyBriefingDocument = briefing()): Promise<HTMLDivElement> => renderWith(doc, text, 'en-US')

const withFocus = (overrides: Partial<NonNullable<DailyBriefingDocument['next']['focus']>>): DailyBriefingDocument => {
  const base = briefing()
  return { ...base, next: { ...base.next, focus: { ...base.next.focus!, ...overrides } } }
}

describe('daily brief share card in English', () => {
  it('names the leverage, rate path and news count in English', async () => {
    const rendered = await render()
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.sections.leverage)
    expect(poster).toContain(text.sections.policyPath)
    expect(poster).toContain(text.sections.marketImplied)
    expect(poster).toContain(text.sections.rangeUnavailable)
    expect(poster).toContain(text.policyOutcomes['hike-25'])
    expect(poster).toContain('4 items:')
    expect(poster).not.toContain('条：')
  })

  it('names the citation sources and the next event country without Chinese', async () => {
    const rendered = await render()
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.citationSources.macroCalendar)
    expect(poster).toContain(text.citationSources.news)
    expect(poster).toContain(text.citationSources.analysis)
    expect(poster).toContain('United States')
    expect(poster).not.toContain('宏观日历')
    expect(poster).not.toContain('分析证据')
    expect(poster).not.toContain('美国')
    expect(poster).not.toMatch(CJK)
  })

  it('renders only the data rows the editor kept', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        market: [
          ...base.data.market,
          {
            id: 'index' as const, labelKey: 'dailyBriefing.row.index',
            importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
            materiality: { material: true as const, reasonCode: 'index-move' as const },
            visibility: 'hidden' as const, visibilityReason: 'not-selected',
            state: 'available' as const, value: { number: 1.42, format: 'percent' as const },
            change: null, window: '24h' as const, observedAt: '2026-10-30T00:25:00.000Z'
          }
        ],
        leverage: base.data.leverage ? { ...base.data.leverage, visibility: 'hidden' as const, visibilityReason: 'no-material-change' } : undefined,
        policyPath: base.data.policyPath ? { ...base.data.policyPath, visibility: 'hidden' as const, visibilityReason: 'no-material-change' } : undefined
      }
    })
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.rows.btc)
    expect(poster).not.toContain(text.rows.index)
    expect(poster).not.toContain(text.sections.leverage)
    expect(poster).not.toContain(text.sections.policyPath)
  })

  it('leads stablecoins and fear and greed with the change, not the level', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        funds: [{
          id: 'stablecoin', group: 'funds' as const, labelKey: 'dailyBriefing.row.stablecoin',
          importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
          state: 'available' as const, value: { number: 253_033_903_673.4, format: 'usd' as const },
          change: { value: -0.33, unit: 'percent' as const, window: '1d' as const },
          auxiliaryChanges: [
            { value: -843_904_300.6, unit: 'usd' as const, window: '1d' as const },
            { value: -0.8134, unit: 'percent' as const, window: '7d' as const },
            { value: -2.2699, unit: 'percent' as const, window: '30d' as const }
          ],
          window: '1d' as const, observedAt: '2026-10-30T00:12:00.000Z'
        }],
        sentiment: {
          ...base.data.sentiment,
          fearGreed: {
            id: 'fear-greed', group: 'sentiment' as const, labelKey: 'dailyBriefing.row.fearGreed',
            importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
            state: 'available' as const, value: { number: 28, format: 'score' as const },
            change: { value: -2, unit: 'points' as const, window: '1d' as const },
            window: 'latest' as const, observedAt: '2026-10-30T00:00:00.000Z'
          }
        }
      }
    })
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    expect(poster).toContain('1d -0.33%')
    expect(poster).toContain('1d -2 pts')
    // The level is the caption, and the longer windows stay visible behind the day move.
    expect(poster).toContain('Total 253B USD')
    expect(poster).toContain('7d -0.81%')
    expect(poster).toContain('Current 28')
  })

  it('prints the missing baseline instead of a zero change', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        funds: [{
          id: 'stablecoin', group: 'funds' as const, labelKey: 'dailyBriefing.row.stablecoin',
          importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
          state: 'available' as const, value: { number: 253_033_903_673.4, format: 'usd' as const },
          change: null, changeReason: 'no-baseline' as const,
          window: '1d' as const, observedAt: '2026-10-30T00:12:00.000Z'
        }],
        sentiment: {
          ...base.data.sentiment,
          fearGreed: {
            id: 'fear-greed', group: 'sentiment' as const, labelKey: 'dailyBriefing.row.fearGreed',
            importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
            state: 'available' as const, value: { number: 30, format: 'score' as const },
            change: null, changeReason: 'no-baseline' as const,
            window: 'latest' as const, observedAt: '2026-10-30T00:00:00.000Z'
          }
        }
      }
    })
    const numbers = rendered.querySelector('.mi-brief-poster__numbers')!.textContent ?? ''

    // A change-led row with no baseline is left out of the poster rather than printed as a level or
    // a fabricated flat move; the document itself keeps `no-baseline` for the reader's audit.
    expect(numbers).not.toContain(text.rows.stablecoin)
    expect(numbers).not.toContain(text.rows.fearGreed)
    expect(numbers).not.toContain('Total 253B USD')
    expect(numbers).not.toContain('0.00%')
  })

  it('separates the invalidation label with the locale separator', async () => {
    const rendered = await render()
    expect(rendered.textContent).toContain(`${text.conclusion.invalidation}: Stablecoins turn positive.`)
  })

  it('puts the three watch conditions on one row with the baseline in the middle', async () => {
    const rendered = await render(withFocus({
      consensus: '3.2%',
      previous: '3.1%',
      watch: [
        { condition: 'higher than expected', implication: 'Rates rise, BTC falls.' },
        { condition: 'lower than expected', implication: 'Rates fall, BTC rallies.' },
        { condition: 'inline with consensus', implication: 'The range holds.' }
      ]
    }))
    const grid = rendered.querySelector('.mi-brief-poster__next-watch-grid')
    const cards = [...rendered.querySelectorAll('[data-watch-kind]')]

    expect(grid?.getAttribute('data-watch-count')).toBe('3')
    expect(cards).toHaveLength(3)
    expect(cards.every((card) => card.parentElement === grid)).toBe(true)
    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'inline', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent))
      .toEqual(['Lower than expected', 'In line with consensus', 'Higher than expected'])
  })

  it('localizes the inline condition in Chinese instead of leaking the AI phrase', async () => {
    const rendered = await renderWith(withFocus({
      consensus: '3.2%',
      previous: '29',
      watch: [
        { condition: 'higher than expected', implication: '利率上行，BTC 承压。' },
        { condition: 'inline with consensus', implication: '区间维持。' },
        { condition: 'lower than expected', implication: '利率下行，BTC 反弹。' }
      ]
    }), zhText, 'zh-CN')
    const cards = [...rendered.querySelectorAll('[data-watch-kind]')]
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'inline', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent))
      .toEqual(['低于预期', '符合预期', '高于预期'])
    expect(poster).toContain('符合预期')
    expect(poster).not.toContain('Inline with consensus')
  })

  it('never prints an unrecognized English watch condition', async () => {
    const rendered = await render(withFocus({
      watch: [{ condition: 'markets reprice around the print', implication: 'Spreads widen.' }]
    }))
    const card = rendered.querySelector('[data-watch-kind]')!

    expect(card.getAttribute('data-watch-kind')).toBe('other')
    expect(card.textContent).toContain(text.next.watchOther)
    expect(card.textContent).not.toContain('markets reprice')
  })

  it('keeps a watch condition that is already localized', async () => {
    const rendered = await renderWith(withFocus({
      watch: [{ condition: '波动放大但方向不明', implication: '等待收盘确认。' }]
    }), zhText, 'zh-CN')

    expect(rendered.textContent).toContain('波动放大但方向不明')
  })

  it('carries expected and previous into the event header instead of a trailing line', async () => {
    const rendered = await render(withFocus({ consensus: '3.2%', previous: '29' }))
    const meta = rendered.querySelector('.mi-brief-poster__next-meta')!.textContent

    expect(meta).toBe('High impact · United States · Consensus 3.2% · Previous 29')
    expect(rendered.querySelector('.mi-brief-poster__next-values')).toBeNull()
    expect((rendered.querySelector('.mi-brief-poster')!.textContent?.match(/Previous 29/g) ?? [])).toHaveLength(1)
  })

  it('shows a lone previous in the event header', async () => {
    const rendered = await renderWith(withFocus({ previous: '29', consensus: undefined }), zhText, 'zh-CN')
    const meta = rendered.querySelector('.mi-brief-poster__next-meta')!.textContent

    expect(meta).toBe('高影响 · 美国 · 前值 29')
    expect(rendered.querySelector('.mi-brief-poster__next-values')).toBeNull()
  })
})
