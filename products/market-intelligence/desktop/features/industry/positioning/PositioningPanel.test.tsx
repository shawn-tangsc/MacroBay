// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { FundingRateHistoryPanel } from './FundingRateHistoryPanel'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const ScopedFundingRateHistoryPanel = (props: Parameters<typeof FundingRateHistoryPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(FundingRateHistoryPanel, props))

const text = { title: 'Funding', pairTitle: 'Funding · Binance USDT perpetual', loading: 'Loading', empty: 'Empty', unavailable: 'Unavailable', observedAt: 'Observed', assets: { btc: 'BTC', eth: 'ETH' }, paymentDirections: { 'long-pays-short': 'Long pays', 'short-pays-long': 'Short pays', neutral: 'Neutral' } }
const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/funding-rates/FundingRateHistoryPanel.css'), 'utf8')
let root: Root | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('FundingRateHistoryPanel', () => {
  it('renders independent BTC/ETH latest values and real positive, negative, zero bars only', () => {
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0, paymentDirection: 'neutral' }, { observedAt: '2026-09-03T08:00:00.000Z', ratePercent: 0.01, paymentDirection: 'long-pays-short' }], eth: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: -0.01, paymentDirection: 'short-pays-long' }] }} />)
    expect(markup).toContain('data-funding-latest="btc"'); expect(markup).toContain('Long pays'); expect(markup).toContain('Short pays'); expect(markup).toContain('data-direction="positive"'); expect(markup).toContain('data-direction="negative"'); expect(markup).toContain('data-direction="zero"')
  })

  it('colors only latest values by their payment direction while retaining asset colors for chart marks', () => {
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0.01, paymentDirection: 'long-pays-short' }], eth: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: -0.01, paymentDirection: 'short-pays-long' }] }} />)
    const neutralMarkup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0, paymentDirection: 'neutral' }], eth: [] }} />)

    expect(markup).toContain('data-funding-latest="btc" data-payment-direction="long-pays-short"')
    expect(markup).toContain('data-funding-latest="eth" data-payment-direction="short-pays-long"')
    expect(neutralMarkup).toContain('data-funding-latest="btc" data-payment-direction="neutral"')
    expect(styles).toContain('.mi-funding-rate-history__latest b { color: var(--mi-dashboard-text);')
    expect(styles).toContain(".mi-funding-rate-history__latest [data-payment-direction='long-pays-short'] b { color: var(--mi-dashboard-positive); }")
    expect(styles).toContain(".mi-funding-rate-history__latest [data-payment-direction='short-pays-long'] b { color: var(--mi-dashboard-negative); }")
    expect(styles).not.toContain(".mi-funding-rate-history__latest [data-payment-direction='neutral'] b {")
    expect(styles).toContain(".mi-funding-rate-history__day i[data-series='btc'] { background: var(--mi-dashboard-etf-btc); }")
    expect(styles).toContain(".mi-funding-rate-history__day i[data-series='eth'] { background: var(--mi-dashboard-etf-eth); }")
    expect(styles).toContain(".mi-funding-rate-history__tooltip span[data-series='btc'] { border-left: 3px solid var(--mi-dashboard-etf-btc);")
    expect(styles).toContain(".mi-funding-rate-history__tooltip span[data-series='eth'] { border-left: 3px solid var(--mi-dashboard-etf-eth);")
  })

  it('does not render synthetic bars for empty or unavailable data', () => {
    expect(renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'empty' }} />)).not.toContain('mi-funding-rate-history__day')
    expect(renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'unavailable' }} />)).toContain('Unavailable')
  })

  it('limits the chart to the latest 22 real timestamps when BTC and ETH have different observations', () => {
    const btc = points('btc', 0)
    const eth = points('eth', 22)
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc, eth }} />)

    expect([...markup.matchAll(/class="mi-funding-rate-history__day"/g)]).toHaveLength(22)
    expect(markup).not.toContain(`data-observed-at="${btc[0]!.observedAt}"`)
    expect(markup).toContain(`data-observed-at="${eth.at(-1)!.observedAt}"`)
  })

  it('uses real UTC date and time labels for cross-date 8-hour observations', () => {
    const btc = points('btc', 0)
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc, eth: [] }} />)
    const ticks = markup.match(/<div class="mi-funding-rate-history__ticks">([\s\S]*?)<\/div>/)?.[1] ?? ''

    expect(ticks).toContain('09-01 00:00')
    expect(ticks).toContain('09-04 08:00')
    expect(ticks).toContain('09-08 00:00')
    expect(ticks).not.toContain('>00:00<')
  })

  it('renders only actual tick points when the chart has one or two observations', () => {
    const one = points('btc', 0).slice(0, 1)
    const two = points('btc', 0).slice(0, 2)
    const oneMarkup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: one, eth: [] }} />)
    const twoMarkup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: two, eth: [] }} />)
    const oneTicks = oneMarkup.match(/<div class="mi-funding-rate-history__ticks">([\s\S]*?)<\/div>/)?.[1] ?? ''
    const twoTicks = twoMarkup.match(/<div class="mi-funding-rate-history__ticks">([\s\S]*?)<\/div>/)?.[1] ?? ''

    expect(oneTicks.match(/<span>/g)).toHaveLength(1)
    expect(oneTicks).toContain('09-01 00:00')
    expect(twoTicks.match(/<span>/g)).toHaveLength(2)
    expect(twoTicks).toContain('09-01 00:00')
    expect(twoTicks).toContain('09-01 08:00')
  })

  it('labels BTC and ETH bar colors above the chart', () => {
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: points('btc', 0), eth: points('eth', 0) }} />)

    expect(markup).toContain('mi-funding-rate-history__legend')
    expect(markup).toContain('<i aria-hidden="true" data-series="btc"></i>BTC')
    expect(markup).toContain('<i aria-hidden="true" data-series="eth"></i>ETH')
  })

  it('uses the full half-axis height for the largest absolute rate', () => {
    const markup = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc: points('btc', 0), eth: [] }} />)

    expect(markup).toContain('style="--mi-funding-height:100%"')
    expect(styles).toContain('height: var(--mi-funding-height);')
    expect(styles).not.toContain('height: calc(var(--mi-funding-height) * .5);')
  })

  it('keeps same-time asset bars in one group with a named gap between groups', () => {
    const btc = points('btc', 0).slice(0, 2)
    const eth = points('eth', 0).slice(0, 1)
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<FundingRateHistoryPanel text={text} state={{ state: 'available', btc, eth }} />)
    const groups = [...container.querySelectorAll<HTMLElement>('[data-observed-at]')]

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.querySelectorAll("i[data-series='btc'], i[data-series='eth']").length)).toEqual([2, 1])
    expect(styles).toContain('--mi-funding-history-time-group-bar-width: 7px;')
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, var(--mi-funding-history-time-group-bar-width)));')
    expect(styles).toContain('width: 100%;')
    expect(styles).toContain('column-gap: var(--mi-funding-history-time-group-gap);')
  })

  it('keeps latest funding summaries narrow beside a chart-dominant history pane', () => {
    expect(styles).toContain('--mi-funding-history-summary-width: 1fr;')
    expect(styles).toContain('--mi-funding-history-summary-min-width: 260px;')
    expect(styles).toContain('--mi-funding-history-chart-width: 4fr;')
    expect(styles).toContain('grid-template-columns: minmax(var(--mi-funding-history-summary-min-width), var(--mi-funding-history-summary-width)) minmax(0, var(--mi-funding-history-chart-width));')
    expect(styles).toContain('border-right: 1px solid var(--mi-dashboard-line);')
    expect(styles).toContain('white-space: nowrap;')
  })

  it('opens the hover tooltip left at the right edge and right at the left edge', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const btc = points('btc', 0)
    const eth = points('eth', 0)

    await act(async () => root?.render(createElement(ScopedFundingRateHistoryPanel, { text, state: { state: 'available', btc, eth } })))
    const chart = container.querySelector<HTMLElement>('.mi-funding-rate-history__chart')!
    Object.defineProperty(chart, 'getBoundingClientRect', { value: () => ({ left: 100, top: 200, right: 700, bottom: 356, width: 600, height: 156 }) })
    const days = container.querySelectorAll<HTMLElement>('[data-observed-at]')

    await act(async () => days[days.length - 1]?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 690, clientY: 260 })))
    const rightTooltip = container.querySelector<HTMLElement>('[data-funding-tooltip]')!
    expect(rightTooltip.dataset.placement).toBe('left')
    expect(rightTooltip.textContent).toContain('2026-09-08 00:00 GMT')
    expect(rightTooltip.textContent).toContain('BTC -0.0100%')
    expect(rightTooltip.textContent).toContain('ETH -0.0100%')
    expect(rightTooltip.querySelector('[data-series="btc"]')).not.toBeNull()
    expect(rightTooltip.querySelector('[data-series="eth"]')).not.toBeNull()

    await act(async () => days[0]?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 110, clientY: 260 })))
    expect(container.querySelector<HTMLElement>('[data-funding-tooltip]')?.dataset.placement).toBe('right')
  })

  it('keeps a narrow middle hover tooltip fully inside the chart', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedFundingRateHistoryPanel, { text, state: { state: 'available', btc: points('btc', 0), eth: [] } })))
    const chart = container.querySelector<HTMLElement>('.mi-funding-rate-history__chart')!
    let bounds = { left: 100, top: 200, right: 500, bottom: 356, width: 400, height: 156 }
    Object.defineProperty(chart, 'getBoundingClientRect', { configurable: true, value: () => bounds })
    const middle = container.querySelector<HTMLElement>('[data-observed-at]')!

    await act(async () => middle.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 285, clientY: 260 })))
    const tooltip = container.querySelector<HTMLElement>('[data-funding-tooltip]')!
    const crosshair = container.querySelector<HTMLElement>('.mi-funding-rate-history__crosshair--vertical')!
    expect(tooltip.dataset.placement).toBe('right')
    expect(crosshair.style.left).toBe('185px')
    expect(tooltip.style.left).toBe('192px')

    bounds = { left: 100, top: 200, right: 400, bottom: 356, width: 300, height: 156 }
    await act(async () => middle.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250, clientY: 260 })))
    expect(container.querySelector<HTMLElement>('.mi-funding-rate-history__crosshair--vertical')?.style.left).toBe('150px')
    expect(container.querySelector<HTMLElement>('[data-funding-tooltip]')?.style.left).toBe('92px')
    expect(styles).toContain('box-sizing: content-box;')
    expect(styles).toContain('max-width: calc(100% - var(--mi-funding-history-tooltip-inset) - var(--mi-funding-history-tooltip-inset) - var(--mi-funding-history-tooltip-horizontal-chrome));')
    expect(styles).toContain('transform: translate(0, var(--mi-funding-history-tooltip-offset));')
  })

  it('anchors positive bars above and negative bars below the zero axis', () => {
    expect(styles).toContain(".mi-funding-rate-history__day i[data-direction='positive'] { grid-row: 1; align-self: end; }")
    expect(styles).toContain(".mi-funding-rate-history__day i[data-direction='negative'] { grid-row: 2; align-self: start;")
    expect(styles).toContain(".mi-funding-rate-history__day i[data-direction='zero'] { height: 0; }")
  })
})

function points(asset: 'btc' | 'eth', start: number) {
  return Array.from({ length: 22 }, (_, index) => ({
    observedAt: new Date(Date.parse('2026-09-01T00:00:00.000Z') + (start + index) * 8 * 60 * 60 * 1000).toISOString(),
    ratePercent: index % 2 === 0 ? 0.01 : -0.01,
    paymentDirection: index % 2 === 0 ? 'long-pays-short' as const : 'short-pays-long' as const
  }))
}
