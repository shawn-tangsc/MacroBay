// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { PositioningPanel } from './PositioningPanel'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/positioning/PositioningPanel.css'), 'utf8')

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

// Four 8-hour points: the state read compares the newest with the one three points back.
const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? 0.0062 : 0.0121, paymentDirection: 'long-pays-short' as const })),
  eth: [24, 16, 8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: hours === 0 ? -0.0031 : 0.0002, paymentDirection: 'short-pays-long' as const }))
}

const positioning: DashboardPositioningViewState = {
  state: 'available',
  window: '7d',
  btc: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 8.9e9 - index * 1e7 })),
  eth: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 2.4e9 + index * 1e7 })),
  changeBtc: { h1Pct: -0.4, h24Pct: -6.5 },
  changeEth: { h1Pct: 0.2, h24Pct: 2.7 },
  signal: { state: 'hidden' }
}

const render = (props: Partial<Parameters<typeof PositioningPanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
    funding, positioning, window: '7d', onWindowChange: () => undefined, text, ...props
  })))

afterEach(() => { document.body.innerHTML = '' })


/** Renders the panel and opens the help popover, which is where the prose lives now. */
async function mountAndOpenHelp(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
      funding, positioning, window: '7d', onWindowChange: () => undefined, text
    })))
  })
  const trigger = container.querySelector(`button[aria-label="${text.helpLabel}"]`)!
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  })
  // The overlay mounts on the next tick after the trigger reports itself.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  return container
}

describe('positioning panel', () => {
  it('prints the funding rate and the notional reading side by side, one asset per row', () => {
    const markup = render()
    expect(markup).toContain(text.pairTitle)
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain(text.paymentDirections['long-pays-short'])
    expect(markup).toContain(text.notional)
    expect(markup).toMatch(/\$8\.8\dB/)
    expect(markup).toContain(text.states.deleveraging)
  })

  it('draws the notional line and the funding bars on one time axis', () => {
    const markup = render()
    expect(markup).toContain('data-series="btc"')
    expect(markup).toContain('data-series="eth"')
    expect(markup).toContain('mi-positioning-panel__bar')
    expect(markup).toContain('mi-positioning-panel__line')
  })

  it('names the window it is showing and switches through the callback', () => {
    const markup = render()
    // One group, one Tab stop, and the chosen window carries aria-pressed rather than only a colour.
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('7 天')
    const onWindowChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => { root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
      funding, positioning, window: '7d', onWindowChange, text
    }))) })
    const options = [...container.querySelectorAll('[role="group"] button')] as HTMLButtonElement[]
    expect(options).toHaveLength(2)
    act(() => { options[1]!.click() })
    expect(onWindowChange).toHaveBeenCalledWith('24h')
    act(() => root.unmount())
  })

  it('marks the bucket the rule reported and names it once, on the chip', () => {
    const markup = render({
      positioning: {
        ...positioning,
        signal: { state: 'alert', asset: 'btc', dropPct: -1.9, volumeMultiple: 3.4, ruleId: 'oi-liquidation-proxy', observedAt: at(0) }
      }
    })
    // One mark, pinned to the signal's own bucket, and one chip naming it.
    expect(markup).toContain('data-signal-mark')
    expect(markup).toContain('疑似强平 BTC -1.9% · 量 3.4×')
    // The query's own hint list is no longer drawn: one reading, one mark, one sentence.
    expect(markup).not.toContain('data-hint-list')
  })

  it('says the data is insufficient instead of implying nothing happened', () => {
    const markup = render({ positioning: { ...positioning, signal: { state: 'insufficient' } } })
    expect(markup).toContain(text.signalInsufficient)
  })

  it('keeps the funding half when the positioning half is missing, and marks which half failed', () => {
    const markup = render({ positioning: { state: 'empty' } })
    expect(markup).toContain('data-state="empty"')
    expect(markup).toContain(text.empty)
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain('—')
  })

  it('shows the loading state through the shared component', () => {
    const markup = render({ positioning: { state: 'loading' } })
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('class="mi-positioning-panel__chart"')
  })

  it('flags a stale reading without dropping it', () => {
    const markup = render({ positioning: { ...positioning, staleSince: at(120) } })
    expect(markup).toContain('data-stale="true"')
    expect(markup).toContain(text.stale)
    expect(markup).toMatch(/\$8\.8\dB/)
  })

  it('keeps every class it renders in its own stylesheet', () => {
    const classes = new Set([...render().matchAll(/class="([^"]+)"/g)].flatMap(match => match[1]!.split(/\s+/)))
    for (const name of classes) {
      if (!name.startsWith('mi-positioning-panel')) continue
      expect(styles, name).toContain(`.${name}`)
    }
  })
})

describe('funding bars per settlement period', () => {
  it('draws one bar per asset per 8-hour period even when the two settle seconds apart', () => {
    // Binance settles each symbol on its own clock; a timestamp-keyed bar drew both plus the
    // overlap, which read as three bars in one band.
    const skewed: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [{ observedAt: '2026-10-28T23:59:58.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' }],
      eth: [{ observedAt: '2026-10-29T00:00:02.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    const markup = render({ funding: skewed })
    const bars = [...markup.matchAll(/<rect[^>]*mi-positioning-panel__bar[^>]*>/g)]
    expect(bars).toHaveLength(2)
    // Both bars belong to the same period; flooring put one of them a day later.
    const periods = new Set(bars.map(bar => /data-settles-at="([^"]+)"/.exec(bar[0])?.[1]))
    expect([...periods]).toEqual(['2026-10-29T00:00:00.000Z'])
  })

  it('still draws one bar when a symbol reports twice inside the same period', () => {
    const duplicate: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [
        { observedAt: '2026-10-28T23:59:58.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' },
        { observedAt: '2026-10-29T00:00:02.000Z', ratePercent: 0.0071, paymentDirection: 'long-pays-short' }
      ],
      eth: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    expect([...render({ funding: duplicate }).matchAll(/class="mi-positioning-panel__bar"/g)].length).toBe(2)
  })
})

describe('hover readout', () => {
  it('names both series for both assets, so the pointer answers four numbers, not three', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
        funding, positioning, window: '7d', onWindowChange: () => undefined, text
      })))
    })
    // The help trigger is an SVG icon too; pick the chart, not the glyph.
    const svg = container.querySelector('.mi-positioning-panel__chart svg')!
    act(() => {
      svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 40 }))
    })
    const tooltip = container.querySelector('.mi-positioning-panel__tooltip')!
    expect(tooltip.textContent).toContain(text.assets.btc)
    expect(tooltip.textContent).toContain(text.assets.eth)
    expect(tooltip.textContent).toContain(text.oiShort)
    expect(tooltip.textContent).toContain(text.rateShort)
    // Two assets, each with two readings.
    expect(tooltip.querySelectorAll('span[data-series]')).toHaveLength(2)
    act(() => root.unmount())
  })
})

describe('bars at the axis edge', () => {
  it('keeps the newest pair apart instead of clamping both onto the same x', () => {
    // The last period settles at the window end, so both bars wanted to sit on the right edge.
    const edge: DashboardFundingRateHistoryState = {
      state: 'available',
      btc: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: 0.0062, paymentDirection: 'long-pays-short' }],
      eth: [{ observedAt: '2026-10-29T00:00:00.000Z', ratePercent: -0.0031, paymentDirection: 'short-pays-long' }]
    }
    const markup = render({ funding: edge })
    const xs = [...markup.matchAll(/<rect[^>]*mi-positioning-panel__bar[^>]*>/g)]
      .map(match => Number(/ x="([\d.]+)"/.exec(match[0])?.[1]))
    expect(xs).toHaveLength(2)
    expect(Math.abs(xs[0]! - xs[1]!)).toBeGreaterThan(1)
  })
})

describe('combined readout', () => {
  it('shows the state and the two numbers behind it', () => {
    const markup = render()
    expect(markup).toContain(text.states.deleveraging)
    expect(markup).toContain('mi-positioning-panel__state-tip')
    // The tooltip quotes the open interest change and both funding readings, so the label can be
    // checked instead of taken on trust.
    expect(markup).toContain('24h')
    expect(markup).toContain('+0.0062%')
    expect(markup).toContain('+0.0121%')
  })

  it('explains the six states in the help popover', async () => {
    // The help is a paragraph in a popover now: it opens on hover/focus and pins on click, so the
    // sentence exists only once the reader asks for it.
    await mountAndOpenHelp()
    // The overlay mounts in a portal, so the sentence lands on the document, not inside the panel.
    expect(document.body.textContent).toContain('六档判定')
  })
})

describe('time axis', () => {
  it('labels five instants across the window so a dip can be placed in time', () => {
    const markup = render()
    const ticks = [...markup.matchAll(/class="mi-positioning-panel__tick">([^<]*)</g)].map(match => match[1])
    expect(ticks).toHaveLength(5)
    expect(ticks[0]).not.toBe(ticks.at(-1))
  })
})

describe('line-end readings', () => {
  it('labels the last point of each line so the curve can be matched to the summary', () => {
    const markup = render()
    const ends = [...markup.matchAll(/data-line-end="(\w+)"[^>]*>([^<]*)</g)]
    expect(ends).toHaveLength(2)
    expect(ends.map(match => match[1]).sort()).toEqual(['btc', 'eth'])
    for (const [, , label] of ends) expect(label).toMatch(/^\$[\d.]+[BM]$/)
  })

  it('says in the help that the two lines are scaled to their own ranges', () => {
    expect(text.helpLines.some(line => line.includes('不能直接比较'))).toBe(true)
  })
})

describe('what the mark does not cover', () => {
  it('says that only a 15-minute collapse is marked, not a slow decline', () => {
    expect(text.helpLines.some(line => line.includes('只标 15 分钟内的骤降'))).toBe(true)
  })
})

describe('the liquidation multiple', () => {
  it('names what the multiple measures, in the help the reader can open', async () => {
    // A bare "3.4×" said nothing about what was multiplied; the sentence lives in the help.
    await mountAndOpenHelp()
    expect(document.body.textContent).toContain('相对过去 24 小时同长度桶均量的倍数')
  })
})

describe('the module rule chip', () => {
  const alert = (overrides: Record<string, unknown> = {}) => ({
    state: 'available' as const,
    window: '7d' as const,
    btc: positioning.state === 'available' ? positioning.btc : [],
    eth: positioning.state === 'available' ? positioning.eth : [],
    signal: { state: 'alert' as const, asset: 'btc' as const, dropPct: -1.9, volumeMultiple: 3.4, ruleId: 'oi-liquidation-proxy', observedAt: at(15) },
    ...overrides
  })

  it('draws the rule\'s own words and numbers when it fires', () => {
    const markup = render({ positioning: alert() })
    expect(markup).toContain('疑似强平')
    expect(markup).toContain('-1.9%')
    expect(markup).toContain('3.4×')
    // Severity never reaches the reader.
    expect(markup).not.toContain('严重')
    expect(markup).not.toContain('high')
  })

  it('renders nothing at all on a normal market, not an empty container', () => {
    const markup = render({ positioning: alert({ signal: { state: 'hidden' } }) })
    expect(markup).not.toContain('mi-positioning-panel__signal')
  })

  it('says data is insufficient without a digit or a direction', () => {
    const markup = render({ positioning: alert({ signal: { state: 'insufficient' } }) })
    expect(markup).toContain('数据不齐')
    const chip = markup.slice(markup.indexOf('mi-positioning-panel__signal'))
    const chipText = chip.slice(0, chip.indexOf('</span>'))
    expect(chipText).not.toMatch(/\d/)
    expect(chipText).not.toContain('强平')
  })

  it('names the rule, the window and that the reading is inferred, on hover', () => {
    const markup = render({ positioning: alert() })
    expect(markup).toContain('oi-liquidation-proxy')
    expect(markup).toContain('15 分钟')
    expect(markup).toContain('推断值')
  })
})

describe('opening the reading', () => {
  const alerting: DashboardPositioningViewState = {
    state: 'available', window: '7d',
    btc: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 8.9e9 - index * 1e7 })),
    eth: [at(180), at(120), at(60), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 2.4e9 + index * 1e7 })),
    signal: { state: 'alert', asset: 'btc', dropPct: -1.9, volumeMultiple: 3.4, ruleId: 'oi-liquidation-proxy', observedAt: at(0) }
  }

  async function mount() {
    const invoke = vi.fn(async () => { throw new Error('the panel must not reach the bridge') })
    vi.stubGlobal('window', { platform: { products: { invoke } } })
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
        funding, positioning: alerting, window: '7d', onWindowChange: () => undefined, text
      })))
    })
    return { container, root, invoke }
  }

  it('opens the numbers behind the chip, and the chip is a keyboard-reachable button', async () => {
    const { container, root, invoke } = await mount()
    const chip = container.querySelector('button.mi-positioning-panel__signal')!
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    // A native button: Tab reaches it and Enter/Space activate it, no key handler to invent.
    await act(async () => { chip.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector('#mi-positioning-signal-detail')!
    expect(detail.textContent).toContain('oi-liquidation-proxy')
    expect(detail.textContent).toContain('-1.9%')
    expect(detail.textContent).toContain('3.4×')
    // Opening the numbers is free: nothing reaches the bridge, so no analysis or budget is spent.
    expect(invoke).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
  })
})
