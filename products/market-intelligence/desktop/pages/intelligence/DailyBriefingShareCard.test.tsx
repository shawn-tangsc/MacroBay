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

  it('marks a fallback reading as a fallback on the poster', async () => {
    // The poster is what gets shared: a row that fell back to the curve's last point carried the
    // same colour and precision as a live reading, so the reader could not tell them apart.
    const base = briefing()
    const staleDoc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: base.data.market.map((row) => row.id === 'btc' ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const } : row)
      }
    }
    const rendered = await render(staleDoc)
    const chip = rendered.querySelector('.mi-brief-poster__stale')
    expect(chip?.textContent).toBe(text.staleMarker)

    const live = await render(briefing())
    expect(live.querySelector('.mi-brief-poster__stale')).toBeNull()
  })

  it('says where a curve fallback came from, not just that it is stale', async () => {
    // "Fallback" alone leaves the reader guessing whether it is the exact 24h pair; the chip carries
    // the window and the source, and the exported copy says the same thing.
    const base = briefing()
    const doc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: base.data.market.map((row) => row.id === 'btc'
          ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: 'curve' as const }
          : row)
      }
    }
    const rendered = await render(doc)
    expect(rendered.querySelector('.mi-brief-poster__stale')?.textContent).toBe(text.staleBasis.curve)
    expect(text.staleBasis.curve).toContain('24h')
  })

  it('names every fallback source, not just the two curve ones', async () => {
    // The three new bases (snapshot, series return, series level, published) used to fall back to the
    // generic chip, which told the reader a number was old but not what it was.
    const base = briefing()
    const cases: readonly [NonNullable<DailyBriefingDocument['data']['market'][number]['valueBasis']>, string][] = [
      ['snapshot', text.staleBasis.snapshot],
      ['series-return', text.staleBasis.seriesReturn],
      ['series-level', text.staleBasis.seriesLevel],
      ['published', text.staleBasis.published]
    ]
    for (const [basis, phrase] of cases) {
      const doc: DailyBriefingDocument = {
        ...base,
        data: {
          ...base.data,
          market: base.data.market.map((row) => row.id === 'btc'
            ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: basis }
            : row)
        }
      }
      const rendered = await render(doc)
      expect(rendered.querySelector('.mi-brief-poster__stale')?.textContent).toBe(phrase)
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
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

  const withForecast = (overrides: Partial<NonNullable<NonNullable<DailyBriefingDocument['conclusion']>['synthesisDetail']>> = {}): DailyBriefingDocument => {
    const base = briefing()
    return {
      ...base,
      conclusion: {
        ...base.conclusion!,
        synthesis: 'agent',
        synthesisDetail: {
          direction: 'bearish',
          confidence: 'medium',
          summary: base.conclusion!.summary,
          outlook: '未来 1-3 日基准情形偏空：BTC 弱于 ETH。',
          conditions: ['ETF 流出维持在 -6.43 亿美元附近'],
          counterEvidence: ['若 ETF 连续两日净流入 6.43 亿美元且 BTC 收复 1.10% 跌幅，则判断失效'],
          watch: ['ETF 净流出 -6.43 亿美元是否收窄', 'BTC 资金费率 0.00% 是否转负'],
          regimeChange: '方向由持平转为偏空',
          confirmed: ['CPI 3.4% 高于预期后 BTC 反弹停止'],
          refuted: [],
          coreTension: 'CPI 3.4% 高于预期，但 BTC 只跌 1.10%',
          whatWouldChange: 'BTC 收复 1.10% 跌幅且 ETF 转为净流入',
          evidenceRefs: ['data:btc'],
          ...overrides
        }
      }
    }
  }

  it('renders the forecast the conclusion lands on, once each', async () => {
    const rendered = await render(withForecast())
    const poster = rendered.querySelector('.mi-brief-poster')!

    const outlook = poster.querySelector('.mi-brief-poster__outlook')?.textContent ?? ''
    expect(outlook).toContain('未来 1-3 日基准情形偏空')
    expect(poster.querySelectorAll('.mi-brief-poster__watch li')).toHaveLength(2)
    expect(poster.querySelector('.mi-brief-poster__overturn')?.textContent).toContain('BTC 收复 1.10% 跌幅')
    // The summary is stated once; the forecast block says the next part without repeating it.
    const summary = poster.querySelector('.mi-brief-poster__summary')!.textContent ?? ''
    expect(summary.match(/Stablecoin contraction pulls bids away\./g)).toHaveLength(1)
  })

  it('marks a changed call with a chip and hides the no-change sentinel', async () => {
    const changed = await render(withForecast())
    const chip = changed.querySelector('[data-regime-change="true"]')
    expect(chip?.textContent).toBe(text.conclusion.regimeChanged)
    expect(chip?.getAttribute('title')).toBe('方向由持平转为偏空')

    const unchanged = await render(withForecast({ regimeChange: '无重要变化' }))
    expect(unchanged.querySelector('[data-regime-change="true"]')).toBeNull()
  })

  it('states whether the earlier read held as one line', async () => {
    const held = await render(withForecast())
    expect(held.querySelector('[data-standing="held"]')?.textContent)
      .toContain(text.conclusion.basisHeld)
    expect(held.querySelector('[data-standing="held"]')?.textContent)
      .toContain('CPI 3.4% 高于预期后 BTC 反弹停止')

    const overturned = await render(withForecast({ confirmed: [], refuted: ['CPI 回落后 BTC 反弹没有出现'] }))
    expect(overturned.querySelector('[data-standing="overturned"]')?.textContent)
      .toContain(text.conclusion.basisOverturned)

    const partly = await render(withForecast({ refuted: ['CPI 回落后 BTC 反弹没有出现'] }))
    expect(partly.querySelector('[data-standing="partly"]')?.textContent)
      .toContain(text.conclusion.basisPartlyHeld)
  })

  it('names the basis of a forecast as its premises and falsifiers', async () => {
    const base = briefing()
    const withFalsifier: DailyBriefingDocument = {
      ...base,
      conclusion: {
        ...base.conclusion!,
        conditions: ['ETF outflows keep running for two sessions'],
        counterEvidence: [{ statement: 'Two straight days of ETF inflows.', citations: [] }]
      }
    }
    const rendered = await render(withFalsifier)
    const cards = [...rendered.querySelectorAll('.mi-brief-poster__basis-card')]

    // The basis belongs to the forecast the editor just made, so the headings say what that forecast
    // needs and what would overturn it — not "conditions" and "counter-evidence" of a past call.
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Premises', 'Falsifiers'])
    expect(cards[0]?.textContent).toContain('ETF outflows keep running for two sessions')
    expect(cards[1]?.textContent).toContain('Two straight days of ETF inflows.')

    const chinese = await renderWith(withFalsifier, zhText, 'zh-CN')
    expect([...chinese.querySelectorAll('.mi-brief-poster__basis-card h3')].map((heading) => heading.textContent))
      .toEqual(['判断前提', '证伪条件'])
  })

  it('shows only the two surprise cards and keeps the baseline out of the row', async () => {
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
    const baseline = rendered.querySelector('[data-watch-baseline]')!

    expect(grid?.getAttribute('data-watch-count')).toBe('2')
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.parentElement === grid)).toBe(true)
    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent))
      .toEqual(['Lower than expected', 'Higher than expected'])
    // The baseline is a footnote under the row, not a third card.
    expect(baseline.parentElement).not.toBe(grid)
    expect(baseline.textContent).toBe('In line with consensus: The range holds.')
  })

  it('localizes the inline condition into a Chinese footnote instead of leaking the AI phrase', async () => {
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

    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent)).toEqual(['低于预期', '高于预期'])
    expect(rendered.querySelector('[data-watch-baseline]')?.textContent).toBe('符合预期：区间维持。')
    expect(poster).not.toContain('Inline with consensus')
  })

  it('omits the baseline footnote when inline has no actionable implication', async () => {
    const rendered = await render(withFocus({
      watch: [
        { condition: 'higher than expected', implication: 'Rates rise.' },
        { condition: 'lower than expected', implication: 'Rates fall.' },
        { condition: 'inline with consensus', implication: '   ' }
      ]
    }))

    expect(rendered.querySelectorAll('[data-watch-kind]')).toHaveLength(2)
    expect(rendered.querySelector('[data-watch-baseline]')).toBeNull()
  })

  it('hides an unrecognized English watch condition instead of printing it', async () => {
    const rendered = await render(withFocus({
      watch: [{ condition: 'markets reprice around the print', implication: 'Spreads widen.' }]
    }))
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    expect(rendered.querySelector('[data-watch-kind]')).toBeNull()
    expect(rendered.querySelector('.mi-brief-poster__next-watch-grid')).toBeNull()
    expect(poster).not.toContain('markets reprice')
    expect(poster).not.toContain(text.next.watchOther)
  })

  it('hides a condition it cannot classify instead of printing it raw', async () => {
    const rendered = await renderWith(withFocus({
      watch: [{ condition: '波动放大但方向不明', implication: '等待收盘确认。' }]
    }), zhText, 'zh-CN')

    expect(rendered.textContent).not.toContain('波动放大但方向不明')
    expect(rendered.querySelector('[data-watch-kind]')).toBeNull()
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
