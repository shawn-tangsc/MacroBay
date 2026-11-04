// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { briefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import { formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { BriefingDataArea } from './BriefingDataArea'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'

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
  amplitude?: { percent: number; high: number; low: number; anchor: number },
  /** The level behind the move (schema 12) and, on the index row, whether it came from a proxy. */
  level?: Readonly<{ close: number; change: number; indexSource?: 'real' | 'proxy' }>
) {
  return {
    id, labelKey: `dailyBriefing.row.${label}`,
    importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
    state: 'available' as const,
    value: { number: value, format: 'percent' as const },
    change: level ? { value: level.change, unit: 'percent' as const, window: '24h' as const } : null,
    window: '24h' as const, observedAt: `${today}T00:00:00.000Z`,
    ...(level ? { close: { value: level.close, at: `${today}T00:00:00.000Z` } } : {}),
    ...(level?.indexSource ? { indexSource: level.indexSource } : {}),
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
        row('btc', 'btc', 1.23, { percent: 3.2, high: 72_400, low: 69_800, anchor: 70_000 }, { close: 110_432.1, change: 1.23 }),
        row('eth', 'eth', 1.59, { percent: 2.4, high: 3_620, low: 3_520, anchor: 3_540 }, { close: 3_842.5, change: 1.59 }),
        row('index', 'index', 0.82, { percent: 1.1, high: 21_300, low: 21_070, anchor: 21_100 }, { close: 19_842.5, change: 0.82, indexSource: 'real' }),
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
    changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
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
    // Two titled lines since the regrouping: money (three cells) and markets & sentiment (five), both
    // fixed three-column grids. The old one-line-six anchor is gone with the layout it described.
    expect(dom.querySelectorAll('[data-briefing-funds-row]')).toHaveLength(1)
    expect(dom.querySelectorAll('[data-briefing-market-row]')).toHaveLength(1)
    const funds = [...dom.querySelectorAll('[data-briefing-funds-row] [data-reading]')].map((node) => node.getAttribute('data-reading'))
    const market = [...dom.querySelectorAll('[data-briefing-market-row] [data-reading]')].map((node) => node.getAttribute('data-reading'))
    // Order is fixed and not by movement: the three money cells, then the five market ones.
    expect(funds).toEqual(['etf-btc', 'etf-eth', 'stablecoin'])
    expect(market).toEqual(['nasdaq', 'dxy', 'gold', 'ust10y', 'fear-greed'])
    // The market table has six cells; the sixth is a blank node, countable and never stretched.
    expect(dom.querySelectorAll('[data-briefing-market-row] .mi-brief-poster__figure-line > *')).toHaveLength(6)
    expect(dom.querySelectorAll('[data-briefing-market-row] [data-reading-empty]')).toHaveLength(1)
    expect([...funds, ...market]).toHaveLength(8)
    // The real yield stays in the document (gaps and the numeric whitelist count it) and never on a line.
    expect(dom.querySelector('[data-reading="us10y-real"]')).toBeNull()
  })

  it('keeps the gauge a single svg with no text or rect inside', async () => {
    const dom = await render()
    const card = dom.querySelector('[data-briefing-policy-card]')!
    expect(card.querySelectorAll('svg')).toHaveLength(1)
    expect(card.querySelectorAll('svg text')).toHaveLength(0)
    expect(card.querySelectorAll('svg rect')).toHaveLength(0)
    expect(dom.querySelector('[data-briefing-market-row] svg')).toBeNull()
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

  it('keeps both lines free of charts', async () => {
    const dom = await render()
    expect(dom.querySelectorAll('[data-briefing-funds-row] svg')).toHaveLength(0)
    expect(dom.querySelectorAll('[data-briefing-market-row] svg')).toHaveLength(0)
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
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
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
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
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
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
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
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    // The number is gone, the card is not: the percentage and its time still say what the row is.
    expect([...host.querySelectorAll('[data-briefing-amplitude]')].map((node) => node.getAttribute('data-briefing-amplitude')))
      .toEqual(['eth', 'nasdaq'])
    // The level is the card's figure now, and the move keeps its arrow beside it.
    const btcCard = host.querySelector('[data-briefing-price-card="btc"]')!
    expect(btcCard.querySelector('[data-briefing-price-value="btc"]')?.textContent)
      .toBe(formatBriefingValue({ number: 110_432.1, format: 'level' }, '—', 'zh-CN'))
    expect(btcCard.textContent).toContain('↑1.2%')
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

  it('puts the money line above the market line', async () => {
    const dom = await render()
    const funds = dom.querySelector('[data-briefing-funds-row]')!
    const market = dom.querySelector('[data-briefing-market-row]')!
    // `compareDocumentPosition` answers document order, which is what the sheet's order is.
    expect(funds.compareDocumentPosition(market) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
      // No instant in the cell: the block stamps its observation once at the heading.
      expect(lead.querySelector('.mi-brief-poster__price-observed')).toBeNull()
      // The plot is a sibling of the text column, never inside it; the drawing lives in the plot box.
      expect(lead.querySelector('[data-briefing-price-area]')).toBeNull()
      expect(lead.parentElement!.querySelector(':scope > [data-briefing-price-plot] [data-briefing-price-area]')).not.toBeNull()
    }
    // The left column is two elements: the label and the figure. The amplitude moved onto the plot.
    for (const lead of leads) expect(lead.children.length).toBe(2)
    const amplitudes = [...dom.querySelectorAll('[data-briefing-price-plot] [data-briefing-amplitude]')]
    expect(amplitudes.map((node) => node.getAttribute('data-briefing-amplitude'))).toEqual(['btc', 'eth'])
    for (const node of amplitudes) {
      // On the plot, never inside its drawing: the card's svg keeps zero text nodes.
      expect(node.closest('svg')).toBeNull()
      expect(node.parentElement!.hasAttribute('data-briefing-price-plot')).toBe(true)
      // Small, grey, and never toned: amplitude says how far, not which way.
      expect(node.hasAttribute('data-tone')).toBe(false)
      expect(node.getAttribute('data-side')).toBe('above')
    }
    // The cell form is different on purpose: a reading cell has one line, so its amplitude stays
    // beside the value rather than inventing a second line.
    expect(dom.querySelector('[data-reading="nasdaq"] .mi-brief-poster__amplitude')).not.toBeNull()
  })

  it('keeps the dial and the printed number together, and the copy out of that cell', async () => {
    const dom = await render()
    const dial = dom.querySelector('[data-briefing-policy-dial]')!
    expect(dial.querySelectorAll('svg')).toHaveLength(1)
    expect(dial.querySelector('.mi-brief-poster__policy-probability')).not.toBeNull()
    // The title used to be auto-placed into this very cell, on top of the gauge.
    expect(dial.querySelector('.mi-brief-poster__policy-title')).toBeNull()
    const card = dom.querySelector('[data-briefing-policy-card]')!
    // The heading spans the card, above both columns; the copy column starts with what is priced.
    expect(card.firstElementChild!.className).toContain('policy-title')
    expect(dial.querySelector('.mi-brief-poster__policy-title')).toBeNull()
    const copy = dom.querySelector('[data-briefing-policy-copy]')!
    // The shares are the card's foot, not a line of the reading column; the target range has moved up
    // into the reading column, where it belongs beside the meeting it applies to.
    expect(copy.querySelector('[data-briefing-policy-outcomes]')).toBeNull()
    expect(card.querySelectorAll('[data-briefing-policy-outcomes]')).toHaveLength(1)
    expect(copy.querySelector('[data-briefing-policy-range]')).not.toBeNull()
    expect(card.querySelector('[data-briefing-policy-outcomes]')!.textContent).not.toContain('政策区间')
    // The reading order is the sheet's: what the market prices, the move, then the meeting with its
    // countdown and the range.
    const order = [...copy.children].map((node) => node.className.replace('mi-brief-poster__', ''))
    expect(order).toEqual(['policy-outcome', 'policy-change', 'policy-range-line'])
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
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    // The move is its own line; the meeting, the countdown and the target range share the line below it.
    expect(host.querySelector('.mi-brief-poster__policy-change')!.textContent).toBe('+5.6pp')
    expect(host.querySelector('[data-briefing-policy-range]')!.textContent)
      .toBe('12-09 · 35 天 · 政策区间 3.75–4.00%')
  })
})

describe("the rate card's own lines", () => {
  it('never ends the legend on a separator, and keeps the number inside the dial', async () => {
    const dom = await render()
    const legend = dom.querySelector('[data-briefing-policy-outcomes]')!
    // A separator appended after the last item reads as a sentence that was cut off.
    expect(legend.textContent!.trim().endsWith('·')).toBe(false)
    expect(legend.textContent).toBe('维持 20.5% · 其余 2%')
    // The number belongs to the dial; a DOM cannot see where it lands, but it can see who owns it.
    const probability = dom.querySelector('[data-briefing-policy-probability]')!
    expect(probability.parentElement).toBe(dom.querySelector('[data-briefing-policy-dial]'))
  })

})

describe('the row lines', () => {
  // The separator belongs to the row: a border on a cell stops at every column gap and at a missing
  // cell, which is exactly how the lines ended at no consistent place. Structure is what a DOM without
  // layout can check — line on the row container, cells only ever inside it, nothing on the title.
  it('gives each block a row container that owns its cells', async () => {
    const dom = await render()
    for (const block of ['[data-briefing-funds-row]', '[data-briefing-market-row]']) {
      const rows = [...dom.querySelectorAll(`${block} > .mi-brief-poster__figure-line`)]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        // Every cell is a child of a row, never of the block itself.
        expect(row.querySelectorAll('.mi-brief-poster__figure').length).toBeGreaterThan(0)
      }
      // Nothing but the title and the rows: a cell placed directly on the block would sit outside any
      // line, and the line would stop before it.
      const strays = [...dom.querySelector(block)!.children]
        .filter((node) => !node.classList.contains('mi-brief-poster__figure-line') && !node.classList.contains('mi-brief-poster__block-title'))
      expect(strays).toEqual([])
    }
  })

  it('leaves the block heading out of the ruling', async () => {
    const dom = await render()
    for (const title of dom.querySelectorAll('.mi-brief-poster__block-title')) {
      // The heading groups on its own; a line under it is where the misalignment showed.
      expect(title.children).toHaveLength(0)
    }
  })
})

describe('the block headings and the positioning card say what they mean', () => {
  it('gives every block heading the heading class, and names the positioning block for its contents', async () => {
    const dom = await render()
    const titles = [...dom.querySelectorAll('.mi-brief-poster__block-title, .mi-brief-poster__leverage-title')]
      .map((node) => node.textContent)
    // Three headings, and "持仓与费率" rather than "杠杆": leverage names the instrument, not the numbers.
    expect(titles).toEqual(['资金', '行情与情绪', '持仓与费率'])
  })

  it('names the change and the rate inside each positioning card', async () => {
    const dom = await render()
    const btc = dom.querySelector('[data-briefing-leverage-card="btc"]')!
    // A bare "BTC" over a big percentage does not say whether it is open interest or a price move.
    expect(btc.textContent).toContain('BTC · 持仓名义额')
    // The small line's numbers each carry their subject: a rate without "费率" reads as another move.
    expect(btc.textContent).toContain('费率 +0.0100%')
    // The amount is the card's level, printed once and never tinted; the change sits beside it.
    expect(btc.querySelector('.mi-brief-poster__leverage-amount')!.textContent).toBe('$7.75B')
    expect(btc.querySelector('.mi-brief-poster__leverage-amount')!.hasAttribute('data-tone')).toBe(false)
    expect(btc.textContent).not.toContain('OI $')
  })
})

describe('an old number says so where it is read', () => {
  it('keeps the value and its marker in the same cell', async () => {
    // Taking the instants off the paper left one thing behind that must not go with them: a reader has
    // to see, in the cell itself, that the number is an older reading. The gaps list alone is somewhere
    // else to look, and a cell with only a marker would be saying "nothing".
    const stale = documentWithData()
    const gold = stale.data.market.find((entry) => entry.id === 'gold')!
    ;(gold as { state: string }).state = 'stale'
    ;(gold as { valueBasis?: string }).valueBasis = 'last-close'
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(stale), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))

    const cell = host.querySelector('[data-reading="gold"]')!
    expect(cell.querySelector('.mi-brief-poster__stale')).not.toBeNull()
    // The number is still there: a stale reading is old, not missing.
    expect(cell.querySelector('b')!.textContent!.trim()).not.toBe('')
    expect(cell.textContent).toContain('最近一次收盘')
  })
})

describe("a cell does not repeat the block's window", () => {
  it('leaves the stablecoin cell with its level and one comparison', async () => {
    const doc = documentWithData()
    const stablecoin = doc.data.funds.find((entry) => entry.id === 'stablecoin')!
    ;(stablecoin as { value?: unknown }).value = { number: 249_100_000_000, format: 'usd' }
    ;(stablecoin as { auxiliaryChanges?: unknown }).auxiliaryChanges = [
      { value: -1_700_000_000, unit: 'usd', window: '1d' },
      { value: -1.57, unit: 'percent', window: '7d' },
      { value: -3.44, unit: 'percent', window: '30d' }
    ]
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    const cell = host.querySelector('[data-reading="stablecoin"]')!
    // The block is "过去 24 小时数据": a day is its own window, so a `1d` inside a cell says nothing.
    expect(cell.textContent).not.toContain('1d')
    // The longer windows are detail; a cell carries one comparison.
    expect(cell.textContent).not.toContain('7d')
    expect(cell.textContent).not.toContain('30d')
    // The level is still printed, and it is *this* value: "not empty" would pass on any string.
    expect(cell.querySelector('b')!.textContent).toBe('249.1B USD')
    // The arrow says which way; the number is the magnitude.
    expect(cell.textContent).toContain('↓1.7B USD')
  })
})

describe('the fear-and-greed cell colours the judgement, never the score', () => {
  const renderBand = async (score: number) => {
    const doc = documentWithData()
    const sentiment = doc.data.sentiment as { fearGreed?: unknown }
    sentiment.fearGreed = {
        id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed',
        importance: { tier: 'must', source: 'rule', reasonCode: 'reading' },
        state: 'available', value: { number: score, format: 'score' },
        change: null, window: 'latest', observedAt: `${today}T00:00:00.000Z`
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    return host.querySelector('[data-reading="fear-greed"]')!
  }

  it('tints the band word and leaves the number alone', async () => {
    const cell = await renderBand(26)
    // 26 is 恐惧: the word is tinted, the score keeps the body ink — a tinted score reads as "falling".
    expect(cell.querySelector('.mi-brief-poster__figure-band')!.getAttribute('data-tone')).toBe('down')
    expect(cell.querySelector('.mi-brief-poster__figure-band')!.textContent).toBe('（恐惧）')
    const score = cell.querySelector('b')!
    expect(score.textContent).toBe('26')
    expect(score.hasAttribute('data-tone')).toBe(false)
  })

  it('moves the band and its tone together at the boundary', async () => {
    // 24 / 25 is the boundary in the one table that owns it: both bands are "down", but the words differ —
    // and a second table for the colour would let one move without the other.
    expect((await renderBand(24)).querySelector('.mi-brief-poster__figure-band')!.textContent).toBe('（极度恐惧）')
    expect((await renderBand(25)).querySelector('.mi-brief-poster__figure-band')!.textContent).toBe('（恐惧）')
    // 贪婪 is up, 中性 has no tone at all.
    expect((await renderBand(60)).querySelector('.mi-brief-poster__figure-band')!.getAttribute('data-tone')).toBe('up')
    expect((await renderBand(50)).querySelector('.mi-brief-poster__figure-band')!.hasAttribute('data-tone')).toBe(false)
  })
})

describe('a level the document does not carry is a dash with a reason, never a move in disguise', () => {
  async function render(mutate: (doc: DailyBriefingDocument) => void): Promise<HTMLElement> {
    const doc = documentWithData()
    mutate(doc)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    return host
  }

  it('prints the dash and the reason when the close is missing, not the move', async () => {
    const host = await render((doc) => {
      const btc = doc.data.market.find((entry) => entry.id === 'btc') as { close?: unknown }
      delete btc.close
    })
    const card = host.querySelector('[data-briefing-price-card="btc"]')!
    // All three survive: the dash stands in the level's place, the reason explains it, and the move is
    // still printed — a missing level does not make the move missing.
    expect(card.querySelector('[data-briefing-price-value="btc"]')?.textContent).toBe(text.noValue)
    expect(card.textContent).toContain(text.closeMissing)
    expect(card.querySelector('.mi-brief-poster__price-change')?.textContent).toBe('↑1.2%')
    // The move is not moved into the level's slot: one dash, one level position.
    expect(card.querySelectorAll('[data-briefing-price-value="btc"]')).toHaveLength(1)
  })

  it('marks the index as a proxy, once, and leaves a real one unmarked', async () => {
    const proxy = await render((doc) => {
      const index = doc.data.market.find((entry) => entry.id === 'index') as { indexSource?: string }
      index.indexSource = 'proxy'
    })
    const proxyCell = proxy.querySelector('[data-reading="nasdaq"]')!
    expect((proxyCell.textContent?.match(/QQQ 永续代理/g) ?? [])).toHaveLength(1)
    // The block already says "past 24 hours": repeating the window on the row is noise, but "proxy" is
    // not — it says the number is not the Nasdaq's own.
    expect(proxyCell.textContent).not.toContain('24h')
    expect(proxyCell.textContent).not.toContain('涨跌')

    await act(async () => root?.unmount())
    root = undefined
    const real = await render(() => undefined)
    expect(real.querySelector('[data-reading="nasdaq"]')?.textContent).not.toContain('QQQ 永续代理')
  })

  it('never puts the dash on the stablecoin cell, which does have a value', async () => {
    const host = await render(() => undefined)
    const stable = host.querySelector('[data-briefing-funds-row] [data-reading="stablecoin"]')
    // It has a level of its own, so the "size not collected" dash would be a lie here.
    expect(stable?.querySelector('b')?.textContent).toBeTruthy()
    expect(stable?.textContent).not.toContain(text.noValue)
  })

  it('prints the net flow as the ETF cell\'s only number, with no dash and no explanation', async () => {
    const host = await render((doc) => {
      const etf = doc.data.funds.find((entry) => entry.id === 'etf-btc') as { value: { number: number; format: string } }
      etf.value = { number: -398_600_000, format: 'flow-usd' }
    })
    const cell = host.querySelector('[data-reading="etf-btc"]')!
    // The row's one real number takes the primary slot; the size this version does not collect stays a
    // dash with its reason underneath, so "no size" no longer hides "there was an outflow".
    expect(cell.querySelector('b')?.textContent)
      .toBe(formatBriefingValue({ number: -398_600_000, format: 'flow-usd' }, text.noValue, 'zh-CN'))
    expect(cell.querySelector('b')?.getAttribute('data-tone')).toBe('down')
    // The size this version does not collect is our gap, not the reader's: it takes no slot and no line.
    expect(cell.textContent).not.toContain(text.noValue)
    expect(cell.querySelectorAll('small')).toHaveLength(0)
  })
})

describe('the dial has four colours and at most three arcs', () => {
  async function renderPolicy(mutate: (doc: DailyBriefingDocument) => void): Promise<HTMLElement> {
    const doc = documentWithData()
    mutate(doc)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    return host
  }

  it('takes the event arc into the lead’s colour, never a fixed orange', async () => {
    const hike = await renderPolicy(() => undefined)
    expect([...hike.querySelectorAll('path[data-outcome]')].map((node) => node.getAttribute('class')))
      .toEqual(['mi-brief-poster__gauge-hike', 'mi-brief-poster__gauge-hold', 'mi-brief-poster__gauge-other'])

    await act(async () => root?.unmount())
    root = undefined
    // A priced cut swaps the event's colour to the cut green; the palette has four, the dial never more.
    const cut = await renderPolicy((doc) => {
      const policy = doc.data.policyPath as { outcome: string; distribution?: Record<string, number> }
      policy.outcome = 'cut-25'
      policy.distribution = { 'no-change': 0.3, 'cut-25': 0.6, 'cut-50-plus': 0.05, 'hike-25': 0.03, 'hike-50-plus': 0.02 }
    })
    const arcs = [...cut.querySelectorAll('path[data-outcome]')]
    expect(arcs).toHaveLength(3)
    expect(arcs[0]?.getAttribute('class')).toBe('mi-brief-poster__gauge-cut')
  })

  it('keys the foot with the same colours as the arcs it labels', async () => {
    const host = await renderPolicy(() => undefined)
    // One swatch per foot item, and each carries the class of the arc it names — the colour cannot drift
    // between the drawing and its key, because both read the same function.
    const swatches = [...host.querySelectorAll('.mi-brief-poster__policy-swatch')]
    const arcs = [...host.querySelectorAll('path[data-outcome]')].map((node) => node.getAttribute('class'))
    expect(swatches.map((node) => node.getAttribute('class')?.split(' ').at(-1))).toEqual(['mi-brief-poster__gauge-hold', 'mi-brief-poster__gauge-other'])
    expect(arcs.slice(1)).toEqual(swatches.map((node) => node.getAttribute('class')?.split(' ').at(-1)))
  })
})


describe('row labels name the row, not the window', () => {
  it('drops "24h change" from the three price rows and keeps the asset names', async () => {
    const dom = await render()
    const labels = ['btc', 'eth'].map((id) =>
      dom.querySelector(`[data-briefing-price-card="${id}"] .mi-brief-poster__price-label`)?.textContent ?? '')
    // The block heading already says "past 24 hours"; the arrow and its colour already say "change".
    for (const label of labels) {
      expect(label).not.toContain('24h')
      expect(label).not.toContain('涨跌')
    }
    // The asset name must survive — dropping it would name nothing at all.
    expect(labels[0]).toContain('BTC')
    expect(labels[1]).toContain('ETH')
    const index = dom.querySelector('[data-reading="nasdaq"] .mi-brief-poster__figure-label')?.textContent ?? ''
    expect(index).toContain('纳指')
    expect(index).not.toContain('24h')
    expect(index).not.toContain('涨跌')
  })
})

describe('two kinds of missing, two rules', () => {
  async function renderRow(mutate: (doc: DailyBriefingDocument) => void): Promise<HTMLElement> {
    const doc = documentWithData()
    mutate(doc)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    return host
  }

  it('says one short line when this run got nothing, and no more than that', async () => {
    const host = await renderRow((doc) => {
      const gold = doc.data.market.find((entry) => entry.id === 'gold') as { state: string; value: unknown }
      gold.state = 'unavailable'
      gold.value = null
    })
    const cell = host.querySelector('[data-reading="gold"]')!
    expect(cell.textContent).toContain(text.notAvailableThisRun)
    // The sentence is the whole cell: no dash (that reads as "the number is missing"), no amount, and no
    // second explanation of what the product decided not to collect.
    expect(cell.textContent).not.toContain(text.noValue)
    expect(cell.querySelector('b')).toBeNull()
  })

  it('stays silent when the reading arrived, stale or fresh', async () => {
    const fresh = await renderRow(() => undefined)
    expect(fresh.querySelector('[data-reading="gold"]')!.textContent).not.toContain(text.notAvailableThisRun)

    await act(async () => root?.unmount())
    root = undefined
    const stale = await renderRow((doc) => {
      const gold = doc.data.market.find((entry) => entry.id === 'gold') as { state: string; valueBasis?: string }
      gold.state = 'stale'
      gold.valueBasis = 'last-close'
    })
    expect(stale.querySelector('[data-reading="gold"]')!.textContent).not.toContain(text.notAvailableThisRun)
  })
})

describe('a hold edition draws two arcs, not three', () => {
  it('drops the hold segment when the meeting itself is priced to hold', async () => {
    const doc = documentWithData()
    const policy = doc.data.policyPath as { outcome: string; distribution?: Record<string, number> }
    // The third way to get two segments: a distribution is present, but the event *is* holding, so a
    // separate hold arc would draw the same bucket twice. This path is separate from "no distribution".
    policy.outcome = 'no-change'
    policy.distribution = { 'no-change': 0.7, 'hike-25': 0.2, 'hike-50-plus': 0.05, 'cut-25': 0.03, 'cut-50-plus': 0.02 }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BriefingDataArea, {
      groups: briefingDataGroups(doc), text, locale: 'zh-CN', formatTime: () => '07:00',
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'),
      changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
    })))
    const gauge = host.querySelector('[data-briefing-policy-gauge]')!
    expect([...gauge.querySelectorAll('[data-outcome]')].map((node) => node.getAttribute('data-outcome')))
      .toEqual(['event', 'other'])
    expect(gauge.querySelectorAll('[data-outcome="hold"]')).toHaveLength(0)
    // The event of a hold edition takes the hold blue, since that is what it is pricing.
    expect(gauge.querySelector('[data-outcome="event"]')?.getAttribute('class')).toBe('mi-brief-poster__gauge-hold')
  })
})
