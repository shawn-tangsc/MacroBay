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
  hints: [],
  hintsTruncated: false,
  hintsState: 'available'
}

const render = (props: Partial<Parameters<typeof PositioningPanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
    funding, positioning, window: '7d', onWindowChange: () => undefined, text, ...props
  })))

afterEach(() => { document.body.innerHTML = '' })

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
    expect(render()).toContain(`aria-pressed="true" data-window="7d"`)
    const onWindowChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => { root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(PositioningPanel, {
      funding, positioning, window: '7d', onWindowChange, text
    }))) })
    const buttons = [...container.querySelectorAll('button[data-window]')]
    expect(buttons).toHaveLength(2)
    act(() => { (buttons[1] as HTMLButtonElement).click() })
    expect(onWindowChange).toHaveBeenCalledWith('24h')
    act(() => root.unmount())
  })

  it('marks a suspected liquidation row and always carries the inferred-not-exchange note', () => {
    const markup = render({
      positioning: { ...positioning, hints: [{ observedAt: at(30), asset: 'btc', dropPct: -1.9, volumeMultiple: 3.4, notionalUsd: 8.8e9 }] }
    })
    // The mark names itself on the chart: asset and size, no timestamp (the axis already says
    // when) and no single header badge (it could only ever name one of several marks).
    expect(markup).toContain('data-hint="btc"')
    expect(markup).toContain('疑似强平 BTC -1.9% · 3.4×')
    expect(markup).not.toContain('mi-positioning-panel__badge')
    // The caveat is no longer a permanent line: it lives in the help popover, which also says
    // what the two series mean together — the part a reader cannot infer from the numbers.
    expect(markup).toContain('data-help')
    expect(markup).toContain(text.helpLines[0])
    expect(markup).toContain(text.helpLines[1])
  })

  it('says the marks are unavailable instead of implying there were none', () => {
    const markup = render({ positioning: { ...positioning, hintsState: 'unavailable' } })
    expect(markup).toContain(text.liquidationUnavailable)
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
    const svg = container.querySelector('svg')!
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

  it('explains the six states in the help popover', () => {
    expect(render()).toContain('六档判定')
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
