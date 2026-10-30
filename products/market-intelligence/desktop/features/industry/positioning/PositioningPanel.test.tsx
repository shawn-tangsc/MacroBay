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
      positioning: { ...positioning, hints: [{ observedAt: at(30), asset: 'btc', dropPct: -1.9, volumeMultiple: 3.4 }] }
    })
    expect(markup).toContain('mi-positioning-panel__badge')
    expect(markup).toContain(text.liquidationFoot)
    expect(markup).toContain('▲')
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
