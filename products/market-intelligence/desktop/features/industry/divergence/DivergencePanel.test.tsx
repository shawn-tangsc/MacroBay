import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { DivergencePanel } from './DivergencePanel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.divergence
const render = (state: Parameters<typeof DivergencePanel>[0]['state'], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
    state, text: productText[locale].pages.intelligence.portal.dashboard.divergence
  })))

const row = {
  pairId: 'liquidity-leverage' as const,
  direction: 'bearish' as const,
  mechanism: '可动用稳定币在减少，永续空头却仍在加仓；价格一旦反弹，空头回补会放大涨幅。',
  invalidation: '稳定币 7 天转正，或持仓 24 小时内回落 3% 以上。',
  legs: [
    { id: 'stablecoin' as const, text: '−1.21%' },
    { id: 'open-interest' as const, text: '+3.40%' },
    { id: 'funding' as const, text: '−0.0032% / 8h' }
  ]
}

describe('divergence panel', () => {
  it('puts the explanation behind the help icon and leaves no judge badge behind', () => {
    const markup = render({ state: 'empty', withheld: [] })
    // No panel name and no pair list: the `?` leads the content and the badge names the judge.
    expect(markup).not.toContain('<h2')
    expect(markup.indexOf('mi-divergence__help')).toBeLessThan(markup.indexOf('mi-divergence__content'))
    expect(markup).not.toContain('mi-divergence__judge')
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
    expect(markup).not.toContain('mi-divergence__judge')
  })

  it('says plainly when nothing diverged instead of showing an empty card', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup).toContain(text.empty)
    expect(markup).not.toContain('mi-divergence__row"')
  })

  it('names every pair it refused and why, so "no divergence" cannot be confused with "not compared"', () => {
    const markup = render({
      state: 'available', rows: [row],
      withheld: [
        { pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf', observedAt: '2026-10-30T21:00:00.000Z' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' }
      ]
    })
    expect(markup).toContain(text.withheldTitle)
    expect(markup).toContain('ETF 3 日净流')
    expect(markup).toContain('的时间对不上')
    expect(markup).toContain(text.legs.sentiment)
  })

  it('never prints Chinese punctuation on an English card', () => {
    // The joiners are punctuation, not layout: a fullwidth colon on an English screen is a typo,
    // and it used to be written straight into the component.
    const markup = render({
      state: 'available', rows: [row],
      withheld: [
        { pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'funding' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'price' }
      ]
    }, 'en-US')
    expect(markup).not.toContain('：')
    expect(markup).not.toContain('、')
  })

  it('never puts a space between a Chinese leg name and the particle after it', () => {
    // The placeholder is substituted with a label such as 费率; a space in the template then reads
    // 费率 太旧了, which is a typo in Chinese even though the English template needs the space.
    const markup = render({
      state: 'available', rows: [row],
      withheld: [
        { pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'funding' },
        { pairId: 'narrative-price', reason: 'leg-unavailable', leg: 'price' }
      ]
    })
    expect(markup).not.toContain('费率 太旧了')
    expect(markup).not.toContain('价格 24 小时 读取失败')
    for (const sentence of Object.values(text.withheldReasons)) {
      expect(/^\{leg\}\s/.test(sentence) && /[\u4e00-\u9fff]/.test(sentence)).toBe(false)
    }
  })

  it('reads a quiet news day and a failed read as two different sentences', () => {
    const quiet = render({
      state: 'available', rows: [row],
      withheld: [{ pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' }]
    })
    const failed = render({
      state: 'available', rows: [row],
      withheld: [{ pairId: 'narrative-price', reason: 'leg-unavailable', leg: 'sentiment' }]
    })
    // "No headline took a side" is a fact about the day; "the read failed" is a fault. A reader
    // acts differently on each, so the card must not print one sentence for both.
    expect(quiet).toContain(text.sentimentNoScoredItems.replace('{leg}', text.legs.sentiment))
    expect(quiet).not.toContain(text.withheldReasons['leg-unavailable'].replace('{leg}', text.legs.sentiment))
    expect(failed).toContain(text.withheldReasons['leg-unavailable'].replace('{leg}', text.legs.sentiment))
    expect(failed).not.toContain(text.sentimentNoScoredItems.replace('{leg}', text.legs.sentiment))
  })
})

describe('withheld grouping', () => {
  it('reports one missing leg once, however many pairs it held back', () => {
    const markup = render({
      state: 'available', rows: [row],
      withheld: [
        { pairId: 'flows-price', reason: 'leg-missing', leg: 'price' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'price' }
      ]
    })
    const occurrences = markup.split('没有取到价格 24 小时').length - 1
    expect(occurrences).toBe(1)
    expect(markup).toContain('（2 对）')
  })
})

describe('states that must not be confused', () => {
  it('says nothing was compared, in the error tone, when every pair was withheld', () => {
    const markup = render({
      state: 'empty',
      withheld: [
        { pairId: 'flows-price', reason: 'leg-missing', leg: 'price' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'price' },
        { pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'stablecoin' }
      ]
    })
    expect(markup).toContain(text.nothingCompared)
    expect(markup).toContain('data-tone="error"')
    expect(markup).not.toContain(text.empty)
  })

  it('keeps the quiet sentence when the pairs were compared and simply agreed', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup).toContain(text.empty)
    expect(markup).not.toContain('data-tone="error"')
  })
})
