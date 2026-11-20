// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'

const dates = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
const rows = dates.map((tradingDate, index) => ({
  tradingDate,
  netFlowUsd: (index + 1) * 1_000_000,
  direction: 'outflow' as const,
  magnitudePercent: index + 1
}))
const cumulative = [
  { windowDays: 5, coveredDays: 5, netFlowUsd: '-$5M', complete: true },
  { windowDays: 20, coveredDays: 20, netFlowUsd: '-$20M', complete: true }
]
const state = {
  state: 'available' as const,
  conclusion: 'partial' as const,
  observedAt: '2026-08-28T07:00:00.000Z',
  currentUsd: '$244.7B', change1dUsd: '+$58.2M', change1dPercent: '+0.02%',
  change7dUsd: '-$2.7B', change7dPercent: '-1.10%',
  change30dUsd: '-$11.6B', change30dPercent: '-4.50%',
  flowHistory: { state: 'available' as const, rows: dates.map((tradingDate) => ({ tradingDate, funds: -1_000_000, btc: -2_000_000, eth: 1_000_000 })) },
  etfReading: {
    state: 'available' as const,
    comparison: { state: 'aligned' as const },
    coverage: [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }],
    verifiedAt: '2026-08-28T07:00:00.000Z',
    btc: { asset: 'BTC' as const, latestNetFlowUsd: '-$185.4M', observedAt: '2026-08-28T07:00:00.000Z', cumulative, rows },
    eth: { asset: 'ETH' as const, latestNetFlowUsd: '+$2.3M', observedAt: '2026-08-28T07:00:00.000Z', cumulative, rows }
  }
}

function render(locale: 'zh-CN' | 'en-US'): string {
  const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: locale,
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, { text, state, onRefresh: () => undefined })
    })
  }))
}

function etfRows(markup: string): readonly string[] {
  const table = markup.match(/<table class="mi-capital-conditions__etf-table">[\s\S]*?<\/table>/)?.[0] ?? ''
  const body = table.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? ''
  return body.split('<tr>').slice(1)
}

describe('the ETF row names its as-of day under the row label', () => {
  it.each(['zh-CN', 'en-US'] as const)('renders the last trading day of that row in %s', (locale) => {
    const text = productText[locale].pages.intelligence.portal.dashboard.capitalConditions
    const expected = text.rowAsOf.replace('{day}', '08-28')
    const rendered = etfRows(render(locale))
    expect(rendered).toHaveLength(2)
    for (const row of rendered) {
      expect(row).toContain('mi-capital-conditions__etf-row-as-of')
      expect(row).toContain(expected)
    }
  })

  it('keeps the day out of the latest figure cell and out of any flow-direction subtree', () => {
    const [btcRow] = etfRows(render('zh-CN'))
    const header = btcRow!.match(/<th scope="row">[\s\S]*?<\/th>/)?.[0] ?? ''
    expect(header).toContain('截至 08-28')
    expect(header).not.toContain('data-flow-direction')
    const latestCell = btcRow!.match(/<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? ''
    expect(latestCell).toBe('-$185.4M')
  })
})
