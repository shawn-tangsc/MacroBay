// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react-dom/test-utils'
import { describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { DivergencePanel } from './DivergencePanel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.divergence
const render = (state: Parameters<typeof DivergencePanel>[0]['state'], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderToStaticMarkup(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
    state, onRetry: () => undefined, text: productText[locale].pages.intelligence.portal.dashboard.divergence
  })))

const row = {
  pairId: 'liquidity-leverage' as const,
  direction: 'bearish' as const,
  mechanism: '可动用稳定币在减少，永续空头却仍在加仓；价格一旦反弹，空头回补会放大涨幅。',
  invalidation: '稳定币 7 天转正，或持仓 24 小时内回落 3% 以上。',
  legs: [
    { id: 'stablecoin' as const, text: '−1.21%', observedAt: '2026-10-30T10:00:00.000Z' },
    { id: 'open-interest' as const, text: '+3.40%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'funding' as const, text: '−0.0032% / 8h', observedAt: '2026-10-30T11:00:00.000Z' }
  ]
}

/** Another pair in the same answer: it keeps its row and must never get a chip of its own. */
const otherRow = {
  pairId: 'flows-price' as const,
  direction: 'bullish' as const,
  legs: [
    { id: 'etf' as const, text: '−$150M', observedAt: '2026-10-29T21:00:00.000Z' },
    { id: 'open-interest' as const, text: '−3.20%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'price' as const, text: '+0.20%', observedAt: '2026-10-30T11:00:00.000Z' }
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
    expect(markup).not.toContain(text.helpBullets[0])
  })

  it('shows a row with both readings, the mechanism and the invalidation', () => {
    const markup = render({ state: 'available', rows: [row], withheld: [] })
    expect(markup).toContain('偏空')
    expect(markup).toContain('−1.21%')
    expect(markup).toContain('+3.40%')
    expect(markup).toContain(row.mechanism)
    // The invalidation is one hover away, not another paragraph.
    // The invalidation is one hover or one Tab away, not a `title` the keyboard cannot reach.
    expect(markup).not.toContain(`title="${text.invalidationLabel}：${row.invalidation}"`)
    expect(markup).toContain('tabindex="0"')
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
  it('waits without drawing a failure or a verdict before the first read returns', () => {
    // First paint: the read has not returned. Neither "could not read" nor "nothing diverged"
    // is true yet, and both are claims the card would have to take back a moment later.
    const markup = render({ state: 'loading' })
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('class="state-view')
    expect(markup).not.toContain('data-state="error"')
    expect(markup).not.toContain(text.empty)
    expect(markup).not.toContain(text.nothingCompared)
  })

  it('says nothing was compared, in the error tone, when every pair was withheld', () => {
    const markup = render({
      state: 'empty',
      withheld: [
        { pairId: 'flows-price', reason: 'leg-missing', leg: 'price' },
        { pairId: 'narrative-price', reason: 'leg-missing', leg: 'price' },
        { pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'stablecoin' }
      ]
    })
    // The state surface is the shared one now: it owns the title, the icon and the announcement,
    // and the product still supplies the sentence naming which pairs were withheld.
    expect(markup).toContain('data-state="error"')
    expect(markup).toContain(text.nothingCompared)
    expect(markup).not.toContain(text.empty)
  })

  it('keeps the quiet sentence when the pairs were compared and simply agreed', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup).toContain(text.empty)
    expect(markup).not.toContain('data-state="error"')
  })
})

describe('invalidation on focus', () => {
  it('opens the same sentence for a keyboard reader as for a pointer', async () => {
    // A `title` was invisible to both the keyboard and the screen reader; the sentence now comes
    // from the shared tooltip, and focusing the row must be enough to get it.
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
        state: { state: 'available', rows: [{ pairId: 'liquidity-leverage', direction: 'bearish', legs: row.legs }], withheld: [] },
        onRetry: () => undefined, text
      })))
    })
    const line = container.querySelector('[data-pair="liquidity-leverage"]') as HTMLElement
    expect(line.tabIndex).toBe(0)
    await act(async () => { line.focus() })
    const described = line.getAttribute('aria-describedby')
    expect(described).toBeTruthy()
    expect(document.getElementById(described!)?.textContent).toContain(row.invalidation)
    await act(async () => { root.unmount() })
  })
})

describe('help on the shared popover', () => {
  it('pins on a click and closes on the second one', async () => {
    // The reason the shared button pair exists: the popover's handlers reach the trigger, so a
    // click pins the layer and the next click lets it go. A hand-built button used to swallow them.
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
        state: { state: 'empty', withheld: [] }, onRetry: () => undefined, text
      })))
    })
    const trigger = container.querySelector(`[aria-label="${text.helpLabel}"]`) as HTMLElement
    // A closing layer keeps its node while it animates out, so "open" is read from its classes.
    const layerState = (): 'none' | 'open' | 'closing' => {
      const layer = document.querySelector('.ant-popover')
      if (layer === null) return 'none'
      return /leave|hidden/.test(layer.className) ? 'closing' : 'open'
    }
    await act(async () => { trigger.click() })
    expect(layerState()).toBe('open')
    // Pinned stays open with the pointer nowhere near it.
    await act(async () => { trigger.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true })) })
    expect(layerState()).toBe('open')
    await act(async () => { trigger.click() })
    expect(layerState()).toBe('closing')
    await act(async () => { root.unmount() })
  })

  it('opens the four one-look bullets a keyboard reader can reach', async () => {
    // The bubble used to carry five lines; the longest moved behind the entry below the card. Four
    // is also the popover's cap, so this asserts the count as well as every key resolving in order.
    expect(text.helpBullets).toHaveLength(4)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
        state: { state: 'empty', withheld: [] }, onRetry: () => undefined, text
      })))
    })
    const trigger = container.querySelector(`button[aria-label="${text.helpLabel}"]`) as HTMLElement
    await act(async () => { trigger.focus() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    for (const line of text.helpBullets) expect(document.body.textContent).toContain(line)
    await act(async () => { root.unmount() })
  })
})

describe('the divergence chip', () => {
  const answer = (...rows: readonly (typeof row | typeof otherRow)[]) => ({ state: 'available' as const, rows, withheld: [] })

  it('gives the intraday pair one chip and leaves every pair its row', () => {
    const markup = render(answer(row, otherRow))
    expect(markup).toContain(text.chip)
    expect(markup.match(/class="mi-divergence__chip"/g)).toHaveLength(1)
    // The readings stay on the rows, once: the chip itself carries no number.
    const chip = markup.slice(markup.indexOf('mi-divergence__chip"'), markup.indexOf('</button>', markup.indexOf('mi-divergence__chip"')))
    expect(chip).not.toMatch(/\d/)
    expect(markup).toContain(row.legs[0]!.text)
    expect(markup).toContain(otherRow.legs[0]!.text)
  })

  it('draws no chip when only another pair diverged', () => {
    expect(render(answer(otherRow))).not.toContain(text.chip)
  })

  it('opens each leg freshness and the reason, and closes again on the same chip', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(DivergencePanel, {
        state: answer(row), onRetry: () => undefined, text
      })))
    })
    const chip = container.querySelector('button.mi-divergence__chip') as HTMLButtonElement
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { chip.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector('#mi-divergence-chip-detail')!
    // What the reader came for: which two legs, how fresh each is, and why the pair counts.
    expect(detail.textContent).toContain(text.legs.stablecoin)
    expect(detail.textContent).toContain(text.legs['open-interest'])
    expect(detail.textContent).toContain(text.chipFresh)
    expect(detail.textContent).toContain(text.chipWhy)
    expect(detail.textContent).toContain('截至')
    // Internal identifiers are not readings.
    expect(detail.textContent).not.toContain('liquidity-leverage')
    expect(detail.textContent).not.toContain('ruleId')
    await act(async () => { chip.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('#mi-divergence-chip-detail')).toBeNull()
    await act(async () => { root.unmount() })
  })
})
