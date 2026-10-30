// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'

const text = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
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

const render = async (): Promise<HTMLDivElement> => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const formatTime = (value: string): string => value.slice(0, 16).replace('T', ' ')
  await act(async () => root!.render(createElement(DailyBriefingShareCard, { document: briefing(), text, locale: 'en-US', formatTime })))
  return host
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

  it('separates the invalidation label with the locale separator', async () => {
    const rendered = await render()
    expect(rendered.textContent).toContain(`${text.conclusion.invalidation}: Stablecoins turn positive.`)
  })
})
