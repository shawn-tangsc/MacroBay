// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const ScopedCapitalConditionsPanel = (props: Parameters<typeof CapitalConditionsPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CapitalConditionsPanel, props))

const dashboardStyles = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'),
  'utf8'
)

let root: Root | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

describe('CapitalConditionsPanel', () => {
  it.each(['zh-CN', 'en-US'] as const)('renders %s stock and ETF tables without a panel title', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const state = fullState()
    state.currentUsd = '$254.9B'
    state.change1dUsd = '+$42M'
    state.change1dPercent = '+0.17%'
    state.change7dUsd = '+$82.4M'
    state.change7dPercent = '+0.03%'
    state.change30dUsd = '-$500M'
    state.change30dPercent = '-0.21%'
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))

    expect(markup).toContain('class="mi-capital-conditions__header-band"')
    expect(markup).toContain('class="mi-capital-conditions__observed-at"')
    expect(markup).not.toContain('<h2>')
    expect(markup).toContain('2026-08-18 07:00 GMT')
    expect(markup).toContain('mi-capital-conditions__stable-table')
    expect(markup).toContain(`<th scope="col">${text.asset}</th>`)
    expect(markup).toContain(`<th scope="col">${text.totalSupply}</th>`)
    for (const label of [text.change1d, text.change7d, text.change30d]) expect(markup).toContain(`<th scope="col">${label}<span`)
    expect(markup).toContain(`<th scope="row">${text.stablecoin}</th>`)
    expect(markup).toContain('$254.9B')
    for (const value of ['+$42M', '+0.17%', '+$82.4M', '+0.03%', '-$500M', '-0.21%']) expect(markup).toContain(value)
    expect(markup).toContain('class="mi-capital-conditions__etf-table"')
    expect(markup).toContain(`<th scope="col">${text.latest}</th>`)
    expect(markup).toContain(`<th scope="col">${text.latest}</th>`)
    expect(markup).toContain(format(text.windowDays, { days: 5 }))
    expect(markup).toContain(format(text.windowDays, { days: 20 }))
    expect(markup).toContain(`<th scope="col">${text.streakColumn}</th>`)
    expect(markup).toContain(text.btc)
    expect(markup).toContain(text.eth)
    expect(markup).toContain('data-flow-direction="inflow"')
    expect(markup).toContain('data-flow-direction="outflow"')
    expect(markup).not.toMatch(/static sample|静态样例/i)
    expect(markup).not.toContain('mi-crypto-dashboard__state-card')
  })

  it('stacks the stablecoin table above the ETF table beside the chart', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))

    expect(markup.indexOf('mi-capital-conditions__header-band')).toBeLessThan(markup.indexOf('mi-capital-conditions__stable-table'))
    expect(markup.indexOf('mi-capital-conditions__stable-table')).toBeLessThan(markup.indexOf(text.btc))
    expect(markup.indexOf('mi-capital-conditions__summary')).toBeLessThan(markup.indexOf('mi-capital-conditions__etf-flow'))
    expect(markup).toContain('class="mi-capital-conditions__content-row"')
  })

  it('renders the consecutive direction and day count in the table streak column', () => {
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: streakState() }))
    const body = etfTableBody(markup)

    expect(body).toContain(format(text.streak, { flow: text.flowDirections.inflow, count: 3 }))
    expect(body).toContain(format(text.streak, { flow: text.flowDirections.outflow, count: 5 }))
    expect(markup).toContain('mi-capital-conditions__streak')
  })

  it.each(['zh-CN', 'en-US'] as const)('puts the real %s 20-day coverage in the column header', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: degradedState() }))
    const twentyHeader = markup.match(new RegExp(`<th scope="col">${format(text.windowDays, { days: 20 })}.*?</th>`))?.[0] ?? ''
    const fiveHeader = markup.match(new RegExp(`<th scope="col">${format(text.windowDays, { days: 5 })}.*?</th>`))?.[0] ?? ''

    expect(twentyHeader).toContain(format(text.coverage, { days: 12 }))
    expect(fiveHeader).not.toContain(format(text.coverage, { days: 12 }))
    expect(markup).not.toContain('20 日窗口仅覆盖')
    expect(markup).toContain('12')
  })

  it.each(['zh-CN', 'en-US'] as const)('shows the %s ETF table as unavailable without inventing numbers', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const state = { ...fullState(), etf: 'unavailable' as const }
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))
    const body = etfTableBody(markup)

    const bodyText = body.replace(/<[^>]*>/g, '')
    expect(bodyText).toContain(text.etfTableUnavailable)
    expect(bodyText).not.toMatch(/\d/)
    expect(markup).toContain(text.etfUnavailable)
    expect(markup).toContain('$1B')
    expect(markup).toContain('data-etf-flow="unavailable"')
  })

  it('renders one shared zero-axis chart with exactly three series per day', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, {
      text,
      state: {
        state: 'available', conclusion: 'partial', observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
        flowHistory: { state: 'available', rows: [{ tradingDate: '2026-08-17', funds: 1, btc: 2, eth: -3 }, { tradingDate: '2026-08-18', funds: 0, btc: 0, eth: 0 }] },
        etf: {
          state: 'available',
          coverage: [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }],
          btc: { asset: 'BTC', latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: [{ tradingDate: '2026-08-17', direction: 'inflow', magnitudePercent: 100 }, { tradingDate: '2026-08-18', direction: 'zero', magnitudePercent: 0 }] },
          eth: { asset: 'ETH', latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: [{ tradingDate: '2026-08-18', direction: 'outflow', magnitudePercent: 100 }] }
        }
      } as never
    }))

    expect(markup).toContain('data-etf-flow="available"')
    expect(markup).toContain('data-series="funds"')
    expect(markup).toContain('data-series="btc"')
    expect(markup).toContain('data-series="eth"')
    expect(markup).toContain('data-flow-half="inflow"')
    expect(markup).toContain('data-flow-half="outflow"')
    expect(markup).toContain('data-flow="zero"')
    expect(markup).not.toContain('data-etf-flow-window=')
  })

  it('defaults the shared chart to the latest seven complete days without a window control', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() }))
    expect(markup).not.toContain('<button')
    expect((markup.match(/class="mi-capital-conditions__chart-day"/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="funds" data-flow/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="btc" data-flow/g) ?? []).length).toBe(7)
    expect((markup.match(/data-series="eth" data-flow/g) ?? []).length).toBe(7)
    expect(markup).not.toContain('data-trading-date="2026-08-01"')
    expect(markup).toContain('data-trading-date="2026-08-30"')
  })

  it('uses the latest seven days and all three series to share the maximum axis magnitude', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const rows = [
      { tradingDate: '2026-08-01', funds: 999, btc: 0, eth: 0 },
      ...Array.from({ length: 7 }, (_, index) => ({
        tradingDate: `2026-08-${String(index + 2).padStart(2, '0')}`,
        funds: index,
        btc: index * 2,
        eth: index === 6 ? -24 : -index
      }))
    ]
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))

    expect(markup).toContain('+$24')
    expect(markup).toContain('$0')
    expect(markup).toContain('-$24')
    expect(markup).not.toContain('$999')
    expect(markup).toContain('data-series="eth" data-flow="outflow" style="--mi-flow-height:100%"')
  })

  it('scales a short flow history from only its actual rows', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const rows = [
      { tradingDate: '2026-08-17', funds: 3, btc: -4, eth: 5 },
      { tradingDate: '2026-08-18', funds: -12, btc: 2, eth: 0 }
    ]
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))

    expect(markup).toContain('+$12')
    expect(markup).toContain('-$12')
    expect(markup).not.toContain('2026-08-01')
    expect((markup.match(/class="mi-capital-conditions__chart-day"/g) ?? []).length).toBe(2)
  })

  it('renders a single safe zero axis and zero-height bars when all visible flows are zero', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const rows = [
      { tradingDate: '2026-08-17', funds: 0, btc: 0, eth: 0 },
      { tradingDate: '2026-08-18', funds: 0, btc: 0, eth: 0 }
    ]
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: flowState(rows) }))
    const axisMarkup = markup.match(/<div class="mi-capital-conditions__chart-axis"[^>]*>(.*?)<\/div>/)?.[1] ?? ''

    expect(markup).toContain('data-zero-axis="true"')
    expect(axisMarkup.match(/<span>/g) ?? []).toHaveLength(1)
    expect(axisMarkup).toContain('$0')
    expect(axisMarkup).not.toContain('+$0')
    expect(axisMarkup).not.toContain('-$0')
    expect((markup.match(/data-flow="zero" style="--mi-flow-height:0%"/g) ?? []).length).toBe(6)
  })

  it('keeps the shared-axis maximum at full half-axis height without a second CSS scale', () => {
    expect(dashboardStyles).toContain('height: var(--mi-flow-height);')
    expect(dashboardStyles).not.toContain('height: calc(var(--mi-flow-height) * .5);')
  })

  it('shows the selected day in a three-series flow legend when a chart day is hovered', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))
    const day = container.querySelector<HTMLElement>('[data-trading-date="2026-08-24"]')!
    await act(async () => day.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))

    const legend = container.querySelector<HTMLElement>('[data-flow-tooltip]')!
    expect(legend.textContent).toContain('2026-08-24')
    expect(legend.textContent).toContain(text.funds)
    expect(legend.textContent).toContain(text.btc)
    expect(legend.textContent).toContain(text.eth)
    expect(legend.textContent).toContain('+$13')
    expect(legend.textContent).toContain('+$24')
    expect(legend.textContent).toContain('-$24')
  })

  it('moves the flow tooltip and crosshair with the pointer inside the chart', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))
    const chart = container.querySelector<HTMLElement>('.mi-capital-conditions__chart')!
    Object.defineProperty(chart, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 700, bottom: 324, width: 600, height: 124 })
    })
    const day = container.querySelector<HTMLElement>('[data-trading-date="2026-08-24"]')!

    await act(async () => day.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 202 })))
    const tooltip = container.querySelector<HTMLElement>('[data-flow-tooltip]')!
    const vertical = container.querySelector<HTMLElement>('[data-flow-crosshair="vertical"]')!
    const horizontal = container.querySelector<HTMLElement>('[data-flow-crosshair="horizontal"]')!
    const firstPlacement = { left: tooltip.style.left, top: tooltip.style.top, vertical: vertical.style.left, horizontal: horizontal.style.top }

    await act(async () => day.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 450, clientY: 318 })))

    expect(tooltip.style.left).not.toBe(firstPlacement.left)
    expect(tooltip.style.top).not.toBe(firstPlacement.top)
    expect(vertical.style.left).not.toBe(firstPlacement.vertical)
    expect(horizontal.style.top).not.toBe(firstPlacement.horizontal)

    await act(async () => day.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(container.querySelector('[data-flow-tooltip]')).toBeNull()
    expect(container.querySelector('[data-flow-crosshair="vertical"]')).toBeNull()
    expect(container.querySelector('[data-flow-crosshair="horizontal"]')).toBeNull()
  })

  it('can transition from an unavailable ETF to an interactive chart', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, {
      text,
      state: { state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%' }
    })))
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: fullState() })))

    expect(container.querySelector('[data-etf-flow="available"]')).not.toBeNull()
  })

  it.each(['zh-CN', 'en-US'] as const)('does not fabricate an observation time for the %s non-available states', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    for (const state of [{ state: 'loading' as const }, { state: 'empty' as const }, { state: 'unavailable' as const }]) {
      const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))
      expect(markup).not.toContain(text.observedAt)
      expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT/)
    }
  })

  it('keeps empty and unavailable as short safe states', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    for (const [state, expected] of [[{ state: 'empty' as const }, text.empty], [{ state: 'unavailable' as const }, text.unavailable]]) {
      const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state }))
      expect(markup).toContain(expected)
      expect(markup).not.toMatch(/https?:|raw|payload|proxy|error/i)
    }
  })

  it('keeps the initial loading state short and free of diagnostic data', () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const markup = renderToStaticMarkup(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'loading' } }))
    expect(markup).toContain(text.loading)
    expect(markup).not.toMatch(/https?:|raw|payload|proxy|error/i)
  })

  it.each(['zh-CN', 'en-US'] as const)('offers %s readers a re-collection action instead of another read while unavailable', async (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const onRefresh = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' }, onRefresh })))
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__refresh')!
    expect(button.textContent).toBe(text.refresh)
    await act(async () => button.click())
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain(text.refreshFailed)
  })

  it('reports a failed re-collection and blocks a second request while it runs', async () => {
    const text = productText['en-US'].pages.intelligence.portal.dashboard.capitalConditions
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'unavailable' }, onRefresh: () => undefined, refreshFailed: true })))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(text.refreshFailed)

    // `loading` already means a read is in flight, so the control must not start a second one.
    await act(async () => root?.render(createElement(ScopedCapitalConditionsPanel, { text, state: { state: 'loading' }, onRefresh: () => undefined, refreshing: true })))
    expect(container.querySelector<HTMLButtonElement>('.mi-capital-conditions__refresh')!.disabled).toBe(true)
  })
})

function flowState(rows: readonly { tradingDate: string; funds: number; btc: number; eth: number }[]) {
  return {
    state: 'available' as const,
    conclusion: 'partial' as const,
    observedAt: '2026-08-18T07:00:00.000Z',
    currentUsd: '$1B',
    change1dUsd: '$0',
    change1dPercent: '0.00%',
    change7dUsd: '$0',
    change7dPercent: '0.00%',
    change30dUsd: '$0',
    change30dPercent: '0.00%',
    flowHistory: { state: 'available' as const, rows },
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(),
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: [] },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: [] }
    }
  }
}

function fullState() {
  const rows = Array.from({ length: 30 }, (_, index) => ({ tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`, direction: index === 29 ? 'zero' as const : 'inflow' as const, magnitudePercent: index === 29 ? 0 : index + 1 }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    flowHistory: { state: 'available' as const, rows: Array.from({ length: 30 }, (_, index) => ({ tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`, funds: index - 10, btc: index + 1, eth: -(index + 1) })) },
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(),
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: rows.map((row) => ({ ...row, direction: row.direction === 'zero' ? 'zero' as const : 'outflow' as const })) }
    }
  }
}

function streakState() {
  const btcRows = Array.from({ length: 5 }, (_, index) => ({
    tradingDate: `2026-08-${String(index + 26).padStart(2, '0')}`,
    direction: index < 2 ? 'outflow' as const : 'inflow' as const,
    magnitudePercent: index + 1
  }))
  const ethRows = btcRows.map((row) => ({ ...row, direction: 'outflow' as const }))
  return {
    state: 'available' as const, conclusion: 'partial' as const, observedAt: '2026-08-18T07:00:00.000Z', currentUsd: '$1B', change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%',
    etf: {
      state: 'available' as const,
      coverage: completeCoverage(),
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$3', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('+$3'), rows: btcRows },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '-$2', observedAt: '2026-08-18T07:00:00.000Z', cumulative: cumulativeWindows('-$2'), rows: ethRows }
    }
  }
}

function degradedState() {
  const state = fullState()
  state.etf.coverage = [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 12, complete: false }]
  state.etf.btc.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
  ]
  state.etf.eth.cumulative = [
    { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
    { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
  ]
  return state
}

function completeCoverage() {
  return [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }]
}

function cumulativeWindows(amount: string) {
  return [
    { windowDays: 5, coveredDays: 5, netFlowUsd: amount, complete: true },
    { windowDays: 20, coveredDays: 20, netFlowUsd: amount, complete: true }
  ]
}

function etfTableBody(markup: string): string {
  const table = markup.match(/<table class="mi-capital-conditions__etf-table">([\s\S]*?)<\/table>/)?.[1] ?? ''
  return table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? ''
}

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''))
}
