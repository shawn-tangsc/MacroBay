// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { briefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { BriefingDataArea } from './BriefingDataArea'
import { briefingPaymentDirections } from './dailyBriefingPaymentDirections'

/**
 * What the data region actually renders.
 *
 * The source contains one `data-reading`, because it is a `map`; the page renders six. That gap is
 * why the counts are asserted here and not in a grep: every criterion about anchors is about what
 * comes out, not about what is typed.
 */
const today = '2026-11-04'
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

function row(id: 'btc' | 'eth' | 'index' | 'dxy' | 'gold' | 'us10y' | 'us10y-real' | 'stablecoin' | 'fear-greed', label: string, value: number) {
  return {
    id, labelKey: `dailyBriefing.row.${label}`,
    importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
    state: 'available' as const,
    value: { number: value, format: 'percent' as const },
    change: null, window: '24h' as const, observedAt: `${today}T00:00:00.000Z`
  }
}

function documentWithData(): DailyBriefingDocument {
  return {
    schemaVersion: 9,
    policyVersion: 'v1',
    edition: { date: today, locale: 'zh-CN', generatedAt: `${today}T00:30:00.000Z`, windowStart: `${today}T00:00:00.000Z`, windowEnd: `${today}T00:00:00.000Z`, timeZone: 'Asia/Shanghai' },
    lede: { text: 'lede' },
    news: { items: [], macro: [], notes: {} },
    data: {
      market: [row('btc', 'btc', 1.23), row('eth', 'eth', 1.59), row('index', 'index', 0.82), row('dxy', 'dxy', 0.43), row('gold', 'gold', -0.54), row('us10y', 'us10y', 4.12), row('us10y-real', 'us10yReal', 2.62)],
      funds: [row('stablecoin', 'stablecoin', 2530)],
      sentiment: { fearGreed: row('fear-greed', 'fearGreed', 26) as never },
      leverage: {
        state: 'available',
        btc: { fundingRate: 0.01, openInterestUsd: 7_750_000_000, change1hPct: -0.3, change24hPct: 0 },
        eth: { fundingRate: 0.01, openInterestUsd: 5_510_000_000, change1hPct: 0.2, change24hPct: 3.5 }
      },
      policyPath: {
        state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 77.5,
        observedAt: `${today}T00:10:00.000Z`, targetLower: 3.75, targetUpper: 4
      }
    } as never,
    conclusion: null,
    next: { items: [] },
    citations: [],
    provenance: { summaryId: 's', readAt: `${today}T00:30:00.000Z` }
  } as unknown as DailyBriefingDocument
}

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const groups = briefingDataGroups(documentWithData())
  await act(async () => root!.render(createElement(BriefingDataArea, {
    groups, text, locale: 'zh-CN', formatTime: () => '07:00', paymentDirectionsCompact: briefingPaymentDirections('zh-CN')
  })))
  return host
}

describe('the data region', () => {
  it('renders the anchors the criteria count at runtime, not in source', async () => {
    const dom = await render()
    expect(dom.querySelectorAll('[data-briefing-policy-card]')).toHaveLength(1)
    expect(dom.querySelectorAll('[data-briefing-price-area]')).toHaveLength(2)
    expect(dom.querySelectorAll('[data-briefing-leverage-block]')).toHaveLength(1)
    expect(dom.querySelectorAll('[data-briefing-leverage-card]')).toHaveLength(2)
    expect(dom.querySelectorAll('[data-briefing-readings-line]')).toHaveLength(1)
    // Six, in this order. The real yield is in the document but not on this line: it appears in the
    // watch list as a sentence, and the approved layout has one yield there.
    const readings = [...dom.querySelectorAll('[data-reading]')].map((node) => node.getAttribute('data-reading'))
    expect(readings).toEqual(['nasdaq', 'dxy', 'gold', 'ust10y', 'stablecoin', 'fear-greed'])
    // Exactly six: the real yield stays in the document (gaps and the numeric whitelist count it)
    // but never on this line.
    expect(readings).toHaveLength(6)
    expect(dom.querySelector('[data-reading="us10y-real"]')).toBeNull()
  })

  it('keeps the gauge a single svg with no text or rect inside', async () => {
    const dom = await render()
    const card = dom.querySelector('[data-briefing-policy-card]')!
    expect(card.querySelectorAll('svg')).toHaveLength(1)
    expect(card.querySelectorAll('svg text')).toHaveLength(0)
    expect(card.querySelectorAll('svg rect')).toHaveLength(0)
    expect(dom.querySelector('[data-briefing-readings-line] svg')).toBeNull()
    // The probability is HTML over the dial, printed once, outside the svg.
    const matches = (card.textContent ?? '').split('77.5%').length - 1
    expect(matches).toBe(1)
    expect(card.querySelector('svg')!.textContent).toBe('')
  })
})

describe('the partition keeps the excluded row in the document', () => {
  it('excludes the real yield from the line, not from the edition', async () => {
    const doc = documentWithData()
    expect(doc.data.market.some((entry) => entry.id === 'us10y-real')).toBe(true)
    const groups = briefingDataGroups(doc)
    expect(groups.readings.some((entry) => entry.id === 'us10y-real')).toBe(false)
  })
})
