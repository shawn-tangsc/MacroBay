// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { briefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { BriefingDataArea } from './BriefingDataArea'
import { briefingChangeArrows, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'

/**
 * What the data region actually renders.
 *
 * The source contains one `data-reading`, because it is a `map`; the page renders six. That gap is
 * why the counts are asserted here and not in a grep: every criterion about anchors is about what
 * comes out, not about what is typed.
 */
const today = '2026-11-04'
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

function row(
  id: 'btc' | 'eth' | 'index' | 'dxy' | 'gold' | 'us10y' | 'us10y-real' | 'stablecoin' | 'fear-greed' | 'etf-btc' | 'etf-eth',
  label: string,
  value: number,
  amplitude?: { percent: number; high: number; low: number; anchor: number }
) {
  return {
    id, labelKey: `dailyBriefing.row.${label}`,
    importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
    state: 'available' as const,
    value: { number: value, format: 'percent' as const },
    change: null, window: '24h' as const, observedAt: `${today}T00:00:00.000Z`,
    ...(amplitude ? { amplitude } : {})
  }
}

function documentWithData(overrides: Readonly<{ distribution?: boolean }> = {}): DailyBriefingDocument {
  const withDistribution = overrides.distribution !== false
  return {
    schemaVersion: 9,
    policyVersion: 'v1',
    edition: { date: today, locale: 'zh-CN', generatedAt: `${today}T00:30:00.000Z`, windowStart: `${today}T00:00:00.000Z`, windowEnd: `${today}T00:00:00.000Z`, timeZone: 'Asia/Shanghai' },
    lede: { text: 'lede' },
    news: { items: [], macro: [], notes: {} },
    data: {
      market: [
        row('btc', 'btc', 1.23, { percent: 3.2, high: 72_400, low: 69_800, anchor: 70_000 }),
        row('eth', 'eth', 1.59, { percent: 2.4, high: 3_620, low: 3_520, anchor: 3_540 }),
        row('index', 'index', 0.82, { percent: 1.1, high: 21_300, low: 21_070, anchor: 21_100 }),
        row('dxy', 'dxy', 0.43), row('gold', 'gold', -0.54), row('us10y', 'us10y', 4.12), row('us10y-real', 'us10yReal', 2.62)
      ],
      funds: [row('stablecoin', 'stablecoin', 2530), row('etf-btc', 'etfBtc', 110_300_000), row('etf-eth', 'etfEth', -88_600_000)],
      sentiment: { fearGreed: row('fear-greed', 'fearGreed', 26) as never },
      leverage: {
        state: 'available',
        btc: { fundingRate: 0.01, openInterestUsd: 7_750_000_000, change1hPct: -0.3, change24hPct: 0 },
        eth: { fundingRate: 0.01, openInterestUsd: 5_510_000_000, change1hPct: 0.2, change24hPct: 3.5 }
      },
      policyPath: {
        state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 77.5,
        observedAt: `${today}T00:10:00.000Z`, targetLower: 3.75, targetUpper: 4,
        ...(withDistribution
          ? { distribution: { 'no-change': 0.205, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.004, 'cut-50-plus': 0.001 } }
          : {})
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

async function render(overrides: Readonly<{ distribution?: boolean }> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const groups = briefingDataGroups(documentWithData(overrides))
  await act(async () => root!.render(createElement(BriefingDataArea, {
    groups, text, locale: 'zh-CN', formatTime: () => '07:00',
    paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
    changeArrows: briefingChangeArrows('zh-CN')
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
    // The probability is HTML over the dial, printed once, outside the svg — and the ring holds the
    // number alone: "3.4% · 加息 25bp" is wider than the dial and wraps across it.
    const matches = (card.textContent ?? '').split('77.5%').length - 1
    expect(matches).toBe(1)
    expect(card.querySelector('[data-briefing-policy-probability]')!.textContent).toBe('77.5%')
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

describe('the drawings the data arrived for', () => {
  const at = (minutes: number) => new Date(Date.parse(`${today}T00:00:00.000Z`) + minutes * 60_000).toISOString()

  it('draws three arcs from the distribution, and no "residual" once there is one', async () => {
    const dom = await render()
    const gauge = dom.querySelector('[data-briefing-policy-gauge]')!
    const outcomes = [...gauge.querySelectorAll('[data-outcome]')].map((node) => node.getAttribute('data-outcome'))
    // Non-zero shares only, and the role names are the three-segment ones.
    expect(outcomes).toEqual(['event', 'hold', 'other'])
    expect(gauge.querySelectorAll('[data-outcome="residual"]')).toHaveLength(0)
    // The arcs sweep the whole half dial: three starts and three ends laid end to end.
    expect(gauge.querySelectorAll('path[data-outcome]')).toHaveLength(3)
  })

  it('prints the same share the arcs are drawn from', async () => {
    const dom = await render()
    const card = dom.querySelector('[data-briefing-policy-card]')!
    // 77.5% is the normalized lead bucket, which is also the event arc — one number, two carriers.
    expect((card.textContent ?? '').split('77.5%').length - 1).toBe(1)
    const bottom = [...card.querySelectorAll('[data-briefing-policy-outcomes] [data-outcome]')]
      .map((node) => node.getAttribute('data-outcome'))
    expect(bottom).toEqual(['hold', 'other'])
    expect(card.querySelector('[data-briefing-policy-outcomes]')!.textContent).toContain('20.5%')
    expect(card.querySelector('[data-briefing-policy-outcomes]')!.textContent).toContain('2%')
  })

  it('renders no legend at all when there is no distribution to list', async () => {
    const dom = await render({ distribution: false })
    // Two segments have no non-event item to name: the event is the number in the ring, and "the rest"
    // is already the other arc. A lone "其余 22.5%" would be a second name for the same fact.
    expect(dom.querySelector('[data-briefing-policy-outcomes]')).toBeNull()
    const gauge = dom.querySelector('[data-briefing-policy-gauge]')!
    expect([...gauge.querySelectorAll('[data-outcome]')].map((node) => node.getAttribute('data-outcome')))
      .toEqual(['event', 'residual'])
  })

  it('keeps the ETF row free of charts', async () => {
    const dom = await render()
    expect(dom.querySelector('[data-briefing-etf-line]')).not.toBeNull()
    expect(dom.querySelectorAll('[data-briefing-etf-line] svg')).toHaveLength(0)
  })

  it('draws the stored curve, and nothing where there is none', async () => {
    const withCurves = documentWithData()
    const btc = withCurves.data.market.find((entry) => entry.id === 'btc')!
    ;(btc as { curve?: unknown }).curve = [[
      { at: at(0), returnPercent: 0 }, { at: at(60), returnPercent: 1.4 }, { at: at(120), returnPercent: 0.6 }
    ]]
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(withCurves), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN')
    })))
    const areas = host.querySelectorAll('[data-briefing-price-area="btc"]')
    expect(areas).toHaveLength(1)
    expect(areas[0]!.querySelectorAll('polyline')).toHaveLength(1)
    expect(areas[0]!.querySelectorAll('path')).toHaveLength(1)
    // The other card has no curve in the document, so it draws its zero line and nothing else.
    expect(host.querySelector('[data-briefing-price-area="eth"]')!.querySelectorAll('polyline')).toHaveLength(0)
  })

  it('draws one sparkline per card that has a series, and none for a card without one', async () => {
    const withSeries = documentWithData()
    const leverage = withSeries.data.leverage!
    ;(leverage.btc as { series?: unknown }).series = [
      { at: at(0), value: 7_000_000_000 }, { at: at(60), value: 7_500_000_000 }, { at: at(120), value: 7_750_000_000 }
    ]
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(withSeries), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN')
    })))
    // One card has a series, so one spark exists: `= 1` is the state the criterion calls red, and
    // this fixture is the half-data case that must still draw the one it has.
    const sparks = host.querySelectorAll('[data-briefing-oi-spark]')
    expect([...sparks].map((node) => node.getAttribute('data-briefing-oi-spark'))).toEqual(['btc'])
    expect(sparks[0]!.querySelectorAll('polyline')).toHaveLength(1)
    expect(sparks[0]!.querySelectorAll('circle').length).toBeLessThanOrEqual(1)
  })
})

describe('the positioning card points at its change', () => {
  it('makes the 24-hour change the card number, with the arrow and the tone on it', async () => {
    const dom = await render()
    const change = dom.querySelectorAll('[data-briefing-oi-change]')
    expect([...change].map((node) => node.getAttribute('data-briefing-oi-change'))).toEqual(['btc', 'eth'])
    // The fixture's BTC change is 0: no arrow, no tone — a zero is not "up".
    expect(change[0]!.textContent).toBe('+0.0%')
    expect(change[1]!.textContent).toBe('↑3.5%')
    // The tone belongs to the change, so it must agree with it rather than with the funding rate.
    const btc = dom.querySelector('[data-briefing-leverage-card="btc"]')!
    expect(btc.getAttribute('data-tone')).toBeNull()
    expect(dom.querySelector('[data-briefing-leverage-card="eth"]')!.getAttribute('data-tone')).toBe('up')
    // The funding rate is still on the card exactly once, now inside the small line.
    expect((btc.textContent ?? '').split('0.0100%').length - 1).toBe(1)
  })

  it('draws a down card in the down tone, and never a green one on a negative change', async () => {
    const falling = documentWithData()
    ;(falling.data.leverage!.btc as { change24hPct?: number; fundingRate?: number }).change24hPct = -3.5
    ;(falling.data.leverage!.btc as { fundingRate?: number }).fundingRate = 0.02
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(falling), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN')
    })))
    const btc = host.querySelector('[data-briefing-leverage-card="btc"]')!
    expect(btc.getAttribute('data-tone')).toBe('down')
    expect(btc.querySelector('[data-briefing-oi-change="btc"]')!.textContent).toBe('↓3.5%')
  })
})

describe('the window amplitude', () => {
  it('appears on the three readings that have continuous bars, and nowhere else', async () => {
    const dom = await render()
    const anchors = [...dom.querySelectorAll('[data-briefing-amplitude]')]
      .map((node) => node.getAttribute('data-briefing-amplitude'))
    // Exactly three, and the Nasdaq one sits on the same element as its reading.
    expect(anchors).toEqual(['btc', 'eth', 'nasdaq'])
    expect(dom.querySelector('[data-reading="nasdaq"]')!.getAttribute('data-briefing-amplitude')).toBe('nasdaq')
    // DXY, gold and the ten-year carry no field in the document, so nothing renders one there.
    for (const id of ['dxy', 'gold', 'ust10y']) {
      expect(dom.querySelector(`[data-reading="${id}"]`)!.hasAttribute('data-briefing-amplitude')).toBe(false)
    }
    // Amplitude is volatility, not a direction: neither the price cards' own amplitude element nor the
    // Nasdaq one inside the readings line carries a tone. The reading entry around it may, for its value.
    for (const id of ['btc', 'eth']) {
      expect(dom.querySelector(`[data-briefing-price-card="${id}"] [data-briefing-amplitude]`)!.hasAttribute('data-tone')).toBe(false)
    }
    expect(dom.querySelector('[data-reading="nasdaq"] .mi-brief-poster__amplitude')!.hasAttribute('data-tone')).toBe(false)
    expect(dom.querySelector('[data-briefing-price-card="btc"]')!.textContent).toContain('振幅 3.2%')
  })

  it('shows nothing where the document withheld the number', async () => {
    const withheld = documentWithData()
    const btc = withheld.data.market.find((entry) => entry.id === 'btc')!
    ;(btc as { amplitude?: unknown; amplitudeReason?: string }).amplitude = undefined
    ;(btc as { amplitudeReason?: string }).amplitudeReason = 'partial-bars'
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(withheld), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN')
    })))
    // The number is gone, the card is not: the percentage and its time still say what the row is.
    expect([...host.querySelectorAll('[data-briefing-amplitude]')].map((node) => node.getAttribute('data-briefing-amplitude')))
      .toEqual(['eth', 'nasdaq'])
    expect(host.querySelector('[data-briefing-price-card="btc"]')!.textContent).toContain('+1.23%')
  })
})

describe('every card wears the shell', () => {
  // A card that is only a pile of numbers has no background, no border and no padding — the paper shows
  // it immediately, a DOM without styles cannot. So the shell's presence is asserted as a class: the
  // three card roots must carry it beside their own name, and the tone that colours them must be theirs.
  const shell = 'mi-brief-poster__card'

  it('puts the shell on all three card roots', async () => {
    const dom = await render()
    const roots = [
      ...dom.querySelectorAll('[data-briefing-price-card]'),
      ...dom.querySelectorAll('[data-briefing-policy-card]'),
      ...dom.querySelectorAll('[data-briefing-leverage-card]')
    ]
    // Two price cards, one rate card, two positioning cards.
    expect(roots).toHaveLength(5)
    for (const root of roots) expect(root.classList.contains(shell)).toBe(true)
    // The tone that drives the shell's colour is on the card row, not on some inner element.
    expect(dom.querySelector('[data-briefing-price-card="btc"]')!.getAttribute('data-tone')).toBe('up')
    expect(dom.querySelector('[data-briefing-price-card="eth"]')!.getAttribute('data-tone')).toBe('up')
  })

  it("keeps the positioning card's text and its spark in separate columns", async () => {
    const dom = await render()
    for (const card of dom.querySelectorAll('[data-briefing-leverage-card]')) {
      const copy = card.querySelector('[data-briefing-leverage-copy]')!
      expect(copy).not.toBeNull()
      // The spark is the second column, never a sixth line under the text (which overflowed 87px).
      expect(copy.querySelector('[data-briefing-oi-spark]')).toBeNull()
    }
  })
})

describe("the data region's own order", () => {
  it("puts the three cards under one parent, in the sheet's order", async () => {
    const dom = await render()
    const btc = dom.querySelector('[data-briefing-price-card="btc"]')!
    const eth = dom.querySelector('[data-briefing-price-card="eth"]')!
    const rate = dom.querySelector('[data-briefing-policy-card]')!
    // Same parent, and BTC → ETH → rate: what a DOM without layout CAN prove. "One row" it cannot —
    // that is the exported image's business, not a test's.
    expect(eth.parentElement).toBe(btc.parentElement)
    expect(rate.parentElement).toBe(btc.parentElement)
    expect([...btc.parentElement!.children]).toEqual([btc, eth, rate])
  })

  it('puts the fund rows before the readings line', async () => {
    const dom = await render()
    const etf = dom.querySelector('[data-briefing-etf-line]')!
    const readings = dom.querySelector('[data-briefing-readings-line]')!
    // `compareDocumentPosition` answers document order, which is what the sheet's order is.
    expect(etf.compareDocumentPosition(readings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the cards place their parts in their own columns', () => {
  // A DOM without layout cannot measure where a box lands, so the placement is asserted as structure:
  // which container holds which part. Auto-placement once put the number and its amplitude into the
  // 100px plot column and the policy title on top of the dial — every attribute right, the paper wrong.
  it('keeps the number, its amplitude and the time in the lead column, with the plot beside it', async () => {
    const dom = await render()
    const leads = [...dom.querySelectorAll('[data-briefing-price-lead]')]
    expect(leads).toHaveLength(2)
    for (const lead of leads) {
      expect(lead.querySelector('.mi-brief-poster__price-value')).not.toBeNull()
      expect(lead.querySelector('.mi-brief-poster__price-observed')).not.toBeNull()
      // The plot is a sibling of the text column, never inside it.
      expect(lead.querySelector('[data-briefing-price-area]')).toBeNull()
      expect(lead.parentElement!.querySelector(':scope > [data-briefing-price-area]')).not.toBeNull()
    }
    // Both amplitudes live in the lead column, on the same figures row as the number.
    const amplitudes = [...dom.querySelectorAll('[data-briefing-price-lead] [data-briefing-amplitude]')]
    expect(amplitudes.map((node) => node.getAttribute('data-briefing-amplitude'))).toEqual(['btc', 'eth'])
    for (const node of amplitudes) expect(node.closest('.mi-brief-poster__price-figures')).not.toBeNull()
  })

  it('keeps the dial and the printed number together, and the copy out of that cell', async () => {
    const dom = await render()
    const dial = dom.querySelector('[data-briefing-policy-dial]')!
    expect(dial.querySelectorAll('svg')).toHaveLength(1)
    expect(dial.querySelector('.mi-brief-poster__policy-probability')).not.toBeNull()
    // The title used to be auto-placed into this very cell, on top of the gauge.
    expect(dial.querySelector('.mi-brief-poster__policy-title')).toBeNull()
    const copy = dom.querySelector('[data-briefing-policy-copy]')!
    expect(copy.querySelector('.mi-brief-poster__policy-title')).not.toBeNull()
    expect(copy.querySelectorAll('[data-briefing-policy-outcomes]')).toHaveLength(1)
    // The reading order is the sheet's: title, what the market prices, the move and the meeting, then
    // the bottom row of shares and the range — the range never floats above the outcome.
    const order = [...copy.children].map((node) => node.className.replace('mi-brief-poster__', ''))
    expect(order.slice(0, 3)).toEqual(['policy-title', 'policy-outcome', 'policy-change'])
    expect(order.at(-1)).toBe('policy-bottom')
  })
})

describe('the rate card says one thing per line', () => {
  it('prints the target range with two decimals, as the sheet does', async () => {
    const dom = await render()
    // `3.75–4.00%`, not `3.75–4%`: the range is a price band, and a band is quoted in full.
    expect(dom.querySelector('[data-briefing-policy-card]')!.textContent).toContain('3.75–4.00%')
  })

  it('carries the move in points beside the meeting, when the edition has a previous one', async () => {
    const shifted = documentWithData()
    ;(shifted.data.policyPath as { probabilityChangePp?: number }).probabilityChangePp = 5.6
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(shifted), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN')
    })))
    expect(host.querySelector('.mi-brief-poster__policy-change')!.textContent).toBe('+5.6pp · 2026-12-09')
  })
})
