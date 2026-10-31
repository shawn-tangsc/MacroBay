import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { DivergencePanel } from './DivergencePanel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.divergence
const render = (state: Parameters<typeof DivergencePanel>[0]['state']) =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, { state, text })))

const row = {
  pairId: 'liquidity-leverage' as const,
  direction: 'bearish' as const,
  judgedBy: 'ai' as const,
  mechanism: '可动用稳定币在减少，永续空头却仍在加仓；价格一旦反弹，空头回补会放大涨幅。',
  invalidation: '稳定币 7 天转正，或持仓 24 小时内回落 3% 以上。',
  legs: [
    { id: 'stablecoin' as const, text: '−1.21%' },
    { id: 'open-interest' as const, text: '+3.40%' },
    { id: 'funding' as const, text: '−0.0032% / 8h' }
  ]
}

describe('divergence panel', () => {
  it('puts the explanation behind the help icon before the title, and names who judged', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup.indexOf('mi-divergence__help')).toBeLessThan(markup.indexOf('<h2'))
    expect(markup).toContain(`aria-label="${text.helpLabel}"`)
    // The prose is not on the card; the badge is.
    expect(markup).not.toContain(text.helpLines[0])
  })

  it('shows a row with both readings, the mechanism and the invalidation', () => {
    const markup = render({ state: 'available', rows: [row], withheld: [] })
    expect(markup).toContain('偏空')
    expect(markup).toContain('−1.21%')
    expect(markup).toContain('+3.40%')
    expect(markup).toContain(row.mechanism)
    // The invalidation is one hover away, not another paragraph.
    expect(markup).toContain(`title="${text.invalidationLabel}：${row.invalidation}"`)
    expect(markup).toContain(text.judgedBy.ai)
  })

  it('says plainly when nothing diverged instead of showing an empty card', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup).toContain(text.empty)
    expect(markup).not.toContain('mi-divergence__row"')
  })

  it('names every pair it refused and why, so "no divergence" cannot be confused with "not compared"', () => {
    const markup = render({
      state: 'empty',
      withheld: [
        { pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf', observedAt: '2026-10-30T21:00:00.000Z' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' }
      ]
    })
    expect(markup).toContain(text.withheldTitle)
    expect(markup).toContain('ETF 3 日净流')
    expect(markup).toContain('窗口不重叠')
    expect(markup).toContain(text.legs.sentiment)
  })
})
