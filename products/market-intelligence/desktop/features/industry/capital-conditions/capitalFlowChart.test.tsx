// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CapitalFlowChart } from './CapitalFlowChart'
import type { FlowChartRow } from './capitalFlowRows'

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

const chartCss = read('products/market-intelligence/desktop/features/industry/capital-conditions/capitalFlowChart.css')
const pageCss = read('products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css')
const chartSource = read('products/market-intelligence/desktop/features/industry/capital-conditions/CapitalFlowChart.tsx')

const rows: FlowChartRow[] = [{ tradingDate: '2026-10-26', funds: -883_700_000, btc: 110_300_000, eth: -88_600_000 }]

const text = {
  etfFlow: '市场资金流', chartWindow: '最近 7 个交易日 · 单位：百万美元',
  fundsColumn: '稳定币净流入', fundsScope: '全部美元稳定币', btc: 'BTC ETF', eth: 'ETH ETF',
  flowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' },
  a11yAmountYi: '{value} 亿美元', a11yAmountWan: '{value} 万', a11yNoFlow: '没有净流入',
  a11yLabel: '{direction} {amount}', a11yCell: '{amount}，{scope}'
}

describe('the chart carries its own box', () => {
  it('defines its geometry in its own stylesheet, not on the page', () => {
    // The dialog portals to <body>; an ancestor-scoped variable does not survive that trip, and
    // the bars collapsed to their 2px floor. The geometry now belongs to the chart.
    expect(chartCss).toContain('--mi-dashboard-etf-flow-chart-height: 108px')
    expect(chartCss).toContain('--mi-dashboard-etf-flow-axis-width: 42px')
    expect(pageCss).not.toContain('--mi-dashboard-etf-flow-chart-height:')
    expect(pageCss).not.toContain('--mi-dashboard-etf-flow-axis-width:')
    expect(chartSource).toContain("import './capitalFlowChart.css'")
  })

  it('colours direction values inside the dialog, whose root is not the card root', () => {
    // The dialog deliberately avoids `.mi-capital-conditions` (that class brings the card's grid),
    // so a rule scoped only to the card left the dialog's numbers in the default colour.
    expect(pageCss).toContain(":is(.mi-capital-conditions, .mi-capital-conditions__dialog) [data-flow-direction='inflow']")
    expect(pageCss).toContain(":is(.mi-capital-conditions, .mi-capital-conditions__dialog) [data-flow-direction='outflow']")
  })

  it('renders its plot and tick line outside any dashboard scope', () => {
    const markup = renderToStaticMarkup(createElement(CapitalFlowChart, { rows, text }))
    expect(markup).toContain('class="mi-capital-conditions__chart"')
    expect(markup).toContain('class="mi-capital-conditions__chart-ticks"')
  })
})
